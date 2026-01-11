import os
import re
import time
import requests
import pandas as pd
from bs4 import BeautifulSoup
from tqdm import tqdm

# -----------------------------
# SEC configuration
# -----------------------------
# SEC requires proper User-Agent identification per their Internet Security Policy
# Format: "CompanyName ContactEmail@example.com" or browser-like string
SEC_HEADERS = {
    "User-Agent": "spac_strat research@example.com",
    "Accept-Encoding": "gzip, deflate",
    "Accept": "application/json",
}

# SEC API endpoints
COMPANY_FILINGS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
TICKER_CIK_URL = "https://www.sec.gov/files/company_tickers.json"


# -----------------------------
# Helpers
# -----------------------------
def get_cik_from_ticker(ticker: str) -> str:
    r = requests.get(TICKER_CIK_URL, headers=SEC_HEADERS)
    r.raise_for_status()

    ticker = ticker.upper()
    for v in r.json().values():
        if v["ticker"] == ticker:
            return str(v["cik_str"]).zfill(10)

    raise ValueError(f"CIK not found for ticker: {ticker}")


def get_item_201_8k_for_ticker(ticker: str, start_year=1900, debug=False):
    """
    Get ALL 8-K filings with "Completion of Acquisition or Disposition of Assets" 
    (Item 2.01) for a ticker using the company filings JSON API.
    Returns a list of all matching filings.
    """
    if debug:
        tqdm.write(f"🔍 [{ticker}] Step 1: Getting CIK...")
    cik = get_cik_from_ticker(ticker)
    cik_int = int(cik)
    if debug:
        tqdm.write(f"🔍 [{ticker}] Step 1: Got CIK = {cik}")
    
    # Get company filings
    filings_url = COMPANY_FILINGS_URL.format(cik=cik)
    if debug:
        tqdm.write(f"🔍 [{ticker}] Step 2: Fetching filings from {filings_url}")
    time.sleep(0.15)  # Rate limiting
    r = requests.get(filings_url, headers=SEC_HEADERS, timeout=30)
    r.raise_for_status()
    
    filings_data = r.json()
    filings = filings_data.get("filings", {}).get("recent", {})
    
    if not filings or "form" not in filings:
        if debug:
            tqdm.write(f"🔍 [{ticker}] Step 2: No filings found or no 'form' key")
        return None
    
    forms = filings["form"]
    filing_dates = filings.get("filingDate", [])
    accession_numbers = filings.get("accessionNumber", [])
    items_list = filings.get("items", [])  # Array of items strings like "2.01,9.01" or "2.02,7.01,9.01"
    
    if debug:
        tqdm.write(f"🔍 [{ticker}] Step 2: Found {len(forms)} total filings")
        tqdm.write(f"🔍 [{ticker}] Step 2: Items array length = {len(items_list)}")
        eight_k_count = sum(1 for f in forms if f and f.startswith("8-K"))
        tqdm.write(f"🔍 [{ticker}] Step 2: Found {eight_k_count} 8-K filings (including 8-K/A)")
        
        # Show first few 8-K filings with their items for debugging
        eight_k_shown = 0
        for idx, f in enumerate(forms):
            if f and f.startswith("8-K") and eight_k_shown < 5:
                items_val = items_list[idx] if idx < len(items_list) else "MISSING"
                date_val = filing_dates[idx] if idx < len(filing_dates) else "MISSING"
                tqdm.write(f"🔍 [{ticker}] Sample {f} #{idx}: date={date_val}, items='{items_val}'")
                eight_k_shown += 1
    
    # Filter for 8-K filings from start_year onwards
    start_date = f"{start_year}-01-01"
    
    # Collect all matching 8-K filings with Item 2.01
    results = []
    
    # Process filings in order (most recent first) and collect all matches
    for i, form in enumerate(forms):
        # Include both 8-K and 8-K/A (amended) filings
        if not form or not form.startswith("8-K"):
            continue
        
        if i >= len(filing_dates) or i >= len(accession_numbers):
            if debug:
                tqdm.write(f"🔍 [{ticker}] Step 3: Index {i} out of bounds (dates={len(filing_dates)}, accessions={len(accession_numbers)})")
            continue
        
        filing_date = filing_dates[i]
        if debug:
            tqdm.write(f"🔍 [{ticker}] Step 3: Checking {form} #{i} filed on {filing_date}")
        if filing_date < start_date:
            if debug:
                tqdm.write(f"🔍 [{ticker}] Step 3: Skipping (before {start_date})")
            continue
        
        # Check if this filing has Item 2.01 in the items array
        items_str = items_list[i] if i < len(items_list) else ""
        if debug:
            tqdm.write(f"🔍 [{ticker}] Step 4: Items string = '{items_str}' (type: {type(items_str)})")
        if not items_str or "2.01" not in items_str:
            if debug:
                tqdm.write(f"🔍 [{ticker}] Step 4: No Item 2.01 found (items_str='{items_str}', empty={not items_str}, contains_2.01={'2.01' in items_str if items_str else False})")
            continue
        
        accession_raw = accession_numbers[i]
        accession = accession_raw.replace("-", "")
        
        if debug:
            tqdm.write(f"🔍 [{ticker}] Step 5: Found Item 2.01! Accession = {accession_raw}")
        
        # Get filing index headers page to find Document 1
        # Format: https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{accession}-index-headers.html
        index_url = (
            f"https://www.sec.gov/Archives/edgar/data/"
            f"{cik_int}/{accession}/{accession_raw}-index-headers.html"
        )
        
        if debug:
            tqdm.write(f"🔍 [{ticker}] Step 6: Fetching index page: {index_url}")
        time.sleep(0.15)
        try:
            idx = requests.get(index_url, headers=SEC_HEADERS, timeout=30)
            idx.raise_for_status()
            
            # Parse the index page to find Document 1
            soup = BeautifulSoup(idx.text, "html.parser")
            doc1_link = None
            
            if debug:
                tqdm.write(f"🔍 [{ticker}] Step 7: Parsing index page for Document 1...")
            
            # Look for Document 1: check link text for "Document 1" or "d1", or href for "d1" patterns
            for link in soup.find_all('a', href=True):
                link_text = link.get_text(strip=True).lower()
                href = link.get('href', '').lower()
                
                # Check if this is Document 1
                if ("document 1" in link_text or "d1" in link_text or 
                    "/d1" in href or href.endswith("d1.htm") or href.endswith("d1a1.htm")):
                    doc1_link = link['href']
                    if debug:
                        tqdm.write(f"🔍 [{ticker}] Step 7: Found Document 1: {doc1_link}")
                    
                    # Make absolute URL if relative
                    if doc1_link.startswith('/'):
                        doc1_link = f"https://www.sec.gov{doc1_link}"
                    elif not doc1_link.startswith('http'):
                        doc1_link = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession}/{doc1_link}"
                    break
            
            if not doc1_link:
                if debug:
                    tqdm.write(f"🔍 [{ticker}] Step 7: Document 1 link not found!")
                continue
            
            # Found a matching 8-K with Item 2.01, check Document 1 for PIPE and extract 2.01 section
            if debug:
                tqdm.write(f"🔍 [{ticker}] Step 8: Checking Document 1 for PIPE and extracting 2.01 section...")
            time.sleep(0.15)
            try:
                contains_PIPE = filing_contains_PIPE(doc1_link)
                com_acq_text = extract_item_201_section(doc1_link)
                
                if debug:
                    tqdm.write(f"🔍 [{ticker}] Step 8: PIPE check result = {contains_PIPE}")
                    tqdm.write(f"🔍 [{ticker}] Step 8: Extracted {len(com_acq_text)} chars from 2.01 section")
                
                results.append({
                    "ticker": ticker.upper(),
                    "cik": cik,
                    "filing_date": filing_date,
                    "accession": accession_raw,
                    "primary_document": index_url,
                    "8k_link": doc1_link,
                    "contains_PIPE": contains_PIPE,
                    "com_acq": com_acq_text,
                })
            except Exception as e:
                tqdm.write(f"⚠️ {ticker} - Error processing Document 1: {e}")
                if debug:
                    import traceback
                    tqdm.write(traceback.format_exc())
                continue
        except Exception as e:
            tqdm.write(f"⚠️ {ticker} - Error parsing index page: {e}")
            if debug:
                import traceback
                tqdm.write(traceback.format_exc())
            continue
    
    if debug:
        tqdm.write(f"🔍 [{ticker}] Found {len(results)} matching 8-K filings with Item 2.01")
    
    return results if results else None


def filing_contains_PIPE(doc_url: str) -> bool:
    """Check if filing contains 'PIPE' (case-sensitive)"""
    r = requests.get(doc_url, headers=SEC_HEADERS, timeout=30)
    r.raise_for_status()
    
    soup = BeautifulSoup(r.text, "html.parser")
    text = soup.get_text(separator=" ")
    
    return "PIPE" in text


def extract_item_201_section(doc_url: str) -> str:
    """
    Extract the Item 2.01 section text from an 8-K filing.
    Returns the raw text of the section, or empty string if not found.
    """
    try:
        r = requests.get(doc_url, headers=SEC_HEADERS, timeout=30)
        r.raise_for_status()
        
        soup = BeautifulSoup(r.text, "html.parser")
        text = soup.get_text(separator="\n")
        
        # Look for Item 2.01 section markers
        # Common patterns: "Item 2.01", "ITEM 2.01", "Item 2.01.", etc.
        patterns = [
            "Item 2.01",
            "ITEM 2.01",
            "Item 2.01.",
            "ITEM 2.01.",
            "Completion of Acquisition or Disposition of Assets",
            "COMPLETION OF ACQUISITION OR DISPOSITION OF ASSETS"
        ]
        
        # Find the start of Item 2.01 section
        start_idx = -1
        for pattern in patterns:
            idx = text.find(pattern)
            if idx != -1:
                start_idx = idx
                break
        
        if start_idx == -1:
            return ""
        
        # Find the end of the section (next Item or end of document)
        # Use regex to find any "Item X.XX" pattern (but not "Item 2.01" itself)
        remaining_text = text[start_idx:]
        
        # Pattern to match "Item" or "ITEM" followed by optional whitespace and digits.digits
        # Matches: "Item 2.02", "ITEM 3.01", "Item 4.01", etc.
        # Look for the first item that is NOT 2.01
        next_item_pattern = re.compile(r'(?:\n|^)(?:Item|ITEM)\s+(\d+)\.(\d+)', re.IGNORECASE | re.MULTILINE)
        
        end_idx = len(remaining_text)
        # Skip the first match (which should be Item 2.01 itself)
        matches = list(next_item_pattern.finditer(remaining_text))
        for match in matches[1:]:  # Skip first match (Item 2.01)
            item_num = f"{match.group(1)}.{match.group(2)}"
            if item_num != "2.01":
                end_idx = match.start()
                break
        
        # Extract the section text
        section_text = remaining_text[:end_idx].strip()
        return section_text
        
    except Exception as e:
        return f"Error extracting section: {str(e)}"


# -----------------------------
# MAIN ENTRY POINT
# -----------------------------
def run_pipeline(tickers, start_year=1990) -> pd.DataFrame:
    all_rows = []
    debug = len(tickers) < 5  # Enable debug for small test sets

    for t in tqdm(tickers, desc="Processing tickers", unit="ticker", total=len(tickers), 
                  ncols=100, mininterval=0.1):
        try:
            rows = get_item_201_8k_for_ticker(t, start_year=start_year, debug=debug)
            if rows:
                all_rows.extend(rows)  # Extend with list of results
        except Exception as e:
            tqdm.write(f"⚠️ {t} failed: {e}")
            if debug:
                import traceback
                tqdm.write(traceback.format_exc())

    df = pd.DataFrame(all_rows)

    if not df.empty:
        df = df.sort_values(["ticker", "filing_date"], ascending=[True, False])

    return df


# -----------------------------
# Example usage
# -----------------------------
if __name__ == "__main__":
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    tickers_path = os.path.join(PROJECT_ROOT, 'data', 'unadjusted_stock_data', 'despac', 'stock_data.csv')
    tickers_df = pd.read_csv(tickers_path)

    # Real mode
    TICKERS = sorted(tickers_df['ticker'].unique(), key=lambda x: x != "CLVT")

    # debug mode
    # TICKERS = ['KDK']


    df = run_pipeline(TICKERS, start_year=1900)
    print(df)

    # Optional: save for downstream agents
    out_path = os.path.join(PROJECT_ROOT, 'data', 'pipe_8k_info.csv')
    df.to_csv(out_path, index=False)
