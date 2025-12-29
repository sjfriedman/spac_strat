"""
Script to scrape De-SPAC list data from listingtrack.io
Uses the OData API endpoint to fetch all De-SPAC company data
"""

import json
import os
from datetime import datetime
from typing import Dict, List, Optional
from urllib.parse import quote

import pandas as pd
import requests


# ========= Constants =========

# Get project root directory (parent of scrape folder)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'data', 'despac_listings')

# API endpoint
API_BASE_URL = "https://api.listingtrack.io/odata/spacs"

# OData query parameters
ODATA_FILTER = "ipo/listingMethod eq 'DeSpac' and ipo/listingDate ge 2019-01-01"
ODATA_SELECT = "symbol,name,spacPercentSharesRedeemedLifetime,cik,id"
ODATA_ORDERBY = "extendedCompanyInfo/deSpacClosingDate desc"
ODATA_EXPAND = (
    "companyProfile(select=logo,marketCap,region,sector,industry),"
    "extendedCompanyInfo(select=deSpacClosingDate,investmentTheme),"
    "ipo(select=symbol,ipoName,ipoSymbol,listingDate,adjustedPercentReturnFromIpoPrice,ipoMarketCap,adjustedPercentReturnFromIpoPrice),"
    "financialMetrics(select=marketCap),"
    "stats(select=marketCap),"
    "commonQuote(select=latestPrice,dailyPercentChange),"
    "unitQuote(select=latestPrice,dailyPercentChange),"
    "warrantQuote(select=latestPrice,dailyPercentChange),"
    "extendedSpacInfo(select=estSharesRemainingPostClose)"
)

# Request settings
REQUEST_TIMEOUT = 60
MAX_RETRIES = 3


# ========= Helpers =========

def build_api_url(top: int = 50000, skip: int = 0) -> str:
    """Build the OData API URL with query parameters"""
    params = {
        '$top': top,
        '$skip': skip,
        'filter': ODATA_FILTER,
        'select': ODATA_SELECT,
        'inclAll': 'false',
        '$orderby': ODATA_ORDERBY,
        '$count': 'true',
        '$expand': ODATA_EXPAND
    }
    
    # Build query string
    query_parts = []
    for key, value in params.items():
        if key.startswith('$'):
            query_parts.append(f"{key}={quote(str(value))}")
        else:
            query_parts.append(f"{key}={quote(str(value))}")
    
    return f"{API_BASE_URL}?{'&'.join(query_parts)}"


def fetch_despac_data() -> Dict:
    """
    Fetch all De-SPAC data from the API
    Returns the full API response as a dictionary
    """
    url = build_api_url(top=50000, skip=0)
    
    print(f"Fetching De-SPAC data from API...")
    print(f"URL: {url[:100]}...")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            
            data = response.json()
            total_count = data.get('@odata.count', len(data.get('value', [])))
            
            print(f"✓ Successfully fetched {total_count} records")
            return data
            
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                print(f"  Attempt {attempt + 1} failed: {e}. Retrying...")
                continue
            else:
                print(f"✗ Failed after {MAX_RETRIES} attempts: {e}")
                raise


def flatten_record(record: Dict) -> Dict:
    """
    Flatten a nested API record into a flat dictionary for CSV export
    """
    flat = {
        'symbol': record.get('symbol'),
        'name': record.get('name'),
        'cik': record.get('cik'),
        'id': record.get('id'),
        'spacPercentSharesRedeemedLifetime': record.get('spacPercentSharesRedeemedLifetime'),
    }
    
    # Company Profile
    company_profile = record.get('companyProfile') or {}
    flat['company_logo'] = company_profile.get('logo')
    flat['company_marketCap'] = company_profile.get('marketCap')
    flat['company_region'] = company_profile.get('region')
    flat['company_sector'] = company_profile.get('sector')
    flat['company_industry'] = company_profile.get('industry')
    
    # Extended Company Info
    extended_info = record.get('extendedCompanyInfo') or {}
    flat['deSpacClosingDate'] = extended_info.get('deSpacClosingDate')
    flat['investmentTheme'] = extended_info.get('investmentTheme')
    
    # IPO Info
    ipo = record.get('ipo') or {}
    flat['ipo_symbol'] = ipo.get('symbol')
    flat['ipo_name'] = ipo.get('ipoName')
    flat['ipo_symbol_original'] = ipo.get('ipoSymbol')
    flat['ipo_listingDate'] = ipo.get('listingDate')
    flat['ipo_adjustedPercentReturnFromIpoPrice'] = ipo.get('adjustedPercentReturnFromIpoPrice')
    flat['ipo_marketCap'] = ipo.get('ipoMarketCap')
    flat['ipo_adjustedPercentReturnFromIpoPrice_alt'] = ipo.get('adjustedPercentReturnFromIpoPrice')
    
    # Financial Metrics
    financial_metrics = record.get('financialMetrics') or {}
    flat['financial_marketCap'] = financial_metrics.get('marketCap')
    
    # Stats
    stats = record.get('stats') or {}
    flat['stats_marketCap'] = stats.get('marketCap')
    
    # Common Quote
    common_quote = record.get('commonQuote') or {}
    flat['commonQuote_latestPrice'] = common_quote.get('latestPrice')
    flat['commonQuote_dailyPercentChange'] = common_quote.get('dailyPercentChange')
    
    # Unit Quote
    unit_quote = record.get('unitQuote') or {}
    flat['unitQuote_latestPrice'] = unit_quote.get('latestPrice')
    flat['unitQuote_dailyPercentChange'] = unit_quote.get('dailyPercentChange')
    
    # Warrant Quote
    warrant_quote = record.get('warrantQuote') or {}
    flat['warrantQuote_latestPrice'] = warrant_quote.get('latestPrice')
    flat['warrantQuote_dailyPercentChange'] = warrant_quote.get('dailyPercentChange')
    
    # Extended SPAC Info
    extended_spac = record.get('extendedSpacInfo') or {}
    flat['estSharesRemainingPostClose'] = extended_spac.get('estSharesRemainingPostClose')
    
    return flat


def save_data(data: Dict) -> None:
    """
    Save the fetched data to JSON and CSV files
    """
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    records = data.get('value', [])
    total_count = data.get('@odata.count', len(records))
    
    if not records:
        print("No records to save.")
        return
    
    # Save raw JSON
    json_path = os.path.join(OUTPUT_DIR, 'despac_listings.json')
    with open(json_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"✓ Saved raw JSON to {json_path}")
    
    # Flatten records for CSV
    flattened_records = [flatten_record(record) for record in records]
    
    # Create DataFrame
    df = pd.DataFrame(flattened_records)
    
    # Convert date columns to datetime
    date_columns = ['deSpacClosingDate', 'ipo_listingDate']
    for col in date_columns:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
    
    # Save CSV
    csv_path = os.path.join(OUTPUT_DIR, 'despac_listings.csv')
    df.to_csv(csv_path, index=False)
    print(f"✓ Saved CSV to {csv_path}")
    
    # Save summary
    summary = {
        'total_count': total_count,
        'records_fetched': len(records),
        'scrape_date': datetime.now().isoformat(),
        'columns': list(df.columns),
        'sample_record': flattened_records[0] if flattened_records else None
    }
    
    summary_path = os.path.join(OUTPUT_DIR, 'summary.json')
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)
    print(f"✓ Saved summary to {summary_path}")
    
    print(f"\nData saved successfully!")
    print(f"  Total records: {total_count}")
    print(f"  Records in file: {len(records)}")
    print(f"  Columns: {len(df.columns)}")


# ========= Main =========

def main():
    """Main entry point"""
    print("="*60)
    print("De-SPAC List Scraper")
    print("="*60)
    print()
    
    try:
        # Fetch data from API
        data = fetch_despac_data()
        
        # Save data
        save_data(data)
        
        print("\n" + "="*60)
        print("Scraping complete!")
        print("="*60)
        
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()

