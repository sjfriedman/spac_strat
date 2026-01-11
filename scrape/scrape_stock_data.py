"""
Script to scrape stock data using yfinance for tickers with "Priced Spac IPO" action
Reads SPAC calendar data from data/spac_calendar/ folder and fetches stock data starting from IPO date
"""

import json
import os
import glob
from datetime import datetime
from typing import Dict, List, Set
from collections import defaultdict

import pandas as pd
import yfinance as yf


# Constants
# Get project root directory (parent of scrape folder)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
SPAC_CALENDAR_DIR = os.path.join(PROJECT_ROOT, 'data', 'spac_calendar')
STOCK_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'stock_data')
OUTPUT_FILE = os.path.join(STOCK_DATA_DIR, 'stock_data.json')
IPO_ACTION_KEYWORDS = ['priced spac ipo', 'priced ipo']  # Case-insensitive matching


def load_spac_data() -> pd.DataFrame:
    """Load all SPAC calendar CSV files and combine into a single DataFrame"""
    csv_files = glob.glob(os.path.join(SPAC_CALENDAR_DIR, 'spac_calendar_*.csv'))
    
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found in {SPAC_CALENDAR_DIR}")
    
    print(f"Found {len(csv_files)} CSV files to process...")
    
    all_data = []
    for csv_file in csv_files:
        try:
            df = pd.read_csv(csv_file, index_col='date', parse_dates=True)
            all_data.append(df)
        except Exception as e:
            print(f"Warning: Could not read {csv_file}: {e}")
    
    if not all_data:
        raise ValueError("No valid data found in CSV files")
    
    combined_df = pd.concat(all_data, ignore_index=False)
    # Reset index to include date in deduplication
    combined_df = combined_df.reset_index()
    combined_df = combined_df.drop_duplicates(subset=['date', 'ticker', 'action'], keep='first')
    combined_df = combined_df.set_index('date')
    
    return combined_df


def filter_ipo_tickers(df: pd.DataFrame) -> Dict[str, List[Dict]]:
    """
    Filter for tickers with IPO action and group by date
    Returns dict: {date_str: [{'ticker': str, 'action': str}, ...]}
    """
    # Filter for IPO actions (case-insensitive)
    ipo_mask = df['action'].str.lower().str.contains('|'.join(IPO_ACTION_KEYWORDS), na=False, regex=True)
    ipo_df = df[ipo_mask].copy()
    
    if ipo_df.empty:
        print("No IPO entries found in the data")
        return {}
    
    # Group by date
    ipo_by_date = defaultdict(list)
    for idx, row in ipo_df.iterrows():
        date_str = idx.strftime('%Y-%m-%d') if isinstance(idx, pd.Timestamp) else str(idx)
        ipo_by_date[date_str].append({
            'ticker': row['ticker'],
            'action': row['action']
        })
    
    print(f"Found IPO entries for {len(ipo_by_date)} unique dates")
    return dict(ipo_by_date)


def fetch_ticker_data(ticker: str, start_date: str, end_date: str = None) -> Dict:
    """
    Fetch stock data for a ticker using yfinance
    Returns dict with data or None if failed
    """
    try:
        # Convert start_date string to datetime
        start_dt = datetime.strptime(start_date, '%Y-%m-%d')
        
        # Use today as end_date if not provided
        if end_date:
            end_dt = datetime.strptime(end_date, '%Y-%m-%d')
        else:
            end_dt = datetime.now()
        
        # Fetch data
        stock = yf.Ticker(ticker)
        hist = stock.history(start=start_dt, end=end_dt)
        
        if hist.empty:
            return None
        
        # Convert to dict format (date -> row data)
        data_dict = {}
        for date, row in hist.iterrows():
            date_str = date.strftime('%Y-%m-%d')
            data_dict[date_str] = {
                'Open': float(row['Open']),
                'High': float(row['High']),
                'Low': float(row['Low']),
                'Close': float(row['Close']),
                'Volume': int(row['Volume']),
                'Dividends': float(row['Dividends']),
                'Stock Splits': float(row['Stock Splits'])
            }
        
        return data_dict 
    except Exception as e:
        print(f"  Error fetching {ticker}: {e}")
        return None


def scrape_stock_data() -> Dict:
    """
    Main function to scrape stock data for IPO tickers
    Returns dict in the specified format
    """
    print("Loading SPAC calendar data...")
    df = load_spac_data()
    
    print("Filtering for IPO entries...")
    ipo_by_date = filter_ipo_tickers(df)
    
    if not ipo_by_date:
        return {}
    
    print("\nFetching stock data from yfinance...")
    result = {}
    
    for date_str in sorted(ipo_by_date.keys()):
        print(f"\nProcessing date: {date_str}")
        tickers_info = ipo_by_date[date_str]
        
        # Get unique tickers for this date
        tickers = list(set([t['ticker'] for t in tickers_info]))
        print(f"  Found {len(tickers)} unique ticker(s): {', '.join(tickers)}")
        
        success_tickers = []
        fail_tickers = []
        ticker_data = {}
        
        for ticker in tickers:
            print(f"  Fetching data for {ticker}...", end=' ', flush=True)
            data = fetch_ticker_data(ticker, date_str)
            
            if data:
                ticker_data[ticker] = data
                success_tickers.append(ticker)
                print(f"✓ ({len(data)} days of data)")
            else:
                fail_tickers.append(ticker)
                print("✗ Failed")
        
        result[date_str] = {
            'success_tickers': success_tickers,
            'fail_tickers': fail_tickers,
            'data': ticker_data
        }
    
    return result


def main():
    """Main entry point"""
    # Create output directory if it doesn't exist
    os.makedirs(STOCK_DATA_DIR, exist_ok=True)
    
    print("="*60)
    print("SPAC Stock Data Scraper")
    print("="*60)
    
    try:
        result = scrape_stock_data()
        
        if not result:
            print("\nNo data to save.")
            return
        
        # Save to JSON
        output_path = OUTPUT_FILE
        with open(output_path, 'w') as f:
            json.dump(result, f, indent=2)
        
        print("\n" + "="*60)
        print(f"Stock data saved to: {output_path}")
        print("="*60)
        
        # Print summary
        total_dates = len(result)
        total_success = sum(len(r['success_tickers']) for r in result.values())
        total_fail = sum(len(r['fail_tickers']) for r in result.values())
        
        print(f"\nSummary:")
        print(f"  Dates processed: {total_dates}")
        print(f"  Successful tickers: {total_success}")
        print(f"  Failed tickers: {total_fail}")
        
        for date_str in sorted(result.keys()):
            r = result[date_str]
            print(f"\n  {date_str}:")
            print(f"    Success: {len(r['success_tickers'])} ({', '.join(r['success_tickers'])})")
            if r['fail_tickers']:
                print(f"    Failed: {len(r['fail_tickers'])} ({', '.join(r['fail_tickers'])})")
        
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()

