"""
Fetch adjusted close data from Alpha Vantage API
Uses TIME_SERIES_DAILY_ADJUSTED endpoint to get all available data for each ticker
Queries one ticker at a time (no bulk API available)
"""

import json
import os
import sys
import time
import random
from datetime import datetime
from typing import Dict, List, Optional

import pandas as pd
import requests

# Try to load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv not installed, will use environment variables only


# ========= Constants =========

# Get project root directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Alpha Vantage API settings
# Try multiple environment variable names for flexibility
ALPHA_VANTAGE_API_KEY = (
    os.getenv('ALPHAVANTAGE_KEY') or 
    os.getenv('ALPHA_VANTAGE_API_KEY') or
    os.getenv('ALPHAVANTAGE_API_KEY')
)
ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query'
API_FUNCTION = 'TIME_SERIES_DAILY_ADJUSTED'
OUTPUT_SIZE = 'full'  # Get all available data

# Rate limiting
# Alpha Vantage limits:
#   - 5 requests per second max
#   - 75 requests per minute max (premium tier)
# Using 0.85 seconds (about 70 requests/minute) to satisfy both limits
# Adding small jitter to spread requests evenly and avoid burst patterns
API_CALL_DELAY = 0.85  # seconds between API calls (satisfies both 5/sec and 75/min limits)
API_CALL_JITTER = 0.05  # random jitter in seconds to spread requests
MAX_RETRIES = 3
RETRY_DELAY = 5

# Data directories
DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'stock_data')
RAW_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'raw_stock_data')


# ========= Helpers =========

def load_tickers(data_type: str) -> Dict[str, str]:
    """
    Load tickers and their reference dates (IPO date for SPAC, closing date for De-SPAC)
    Returns dict: {ticker: date_string}
    """
    dates_path = os.path.join(DATA_DIR, data_type, 'dates.json')
    
    if not os.path.exists(dates_path):
        raise FileNotFoundError(f"Dates file not found: {dates_path}")
    
    with open(dates_path, 'r') as f:
        data = json.load(f)
    
    return data.get('ticker_to_date', {})


def fetch_ticker_data(ticker: str, api_key: str) -> Optional[Dict]:
    """
    Fetch TIME_SERIES_DAILY_ADJUSTED data for a single ticker
    Returns the full API response or None if failed
    """
    params = {
        'function': API_FUNCTION,
        'symbol': ticker,
        'outputsize': OUTPUT_SIZE,
        'apikey': api_key,
        'datatype': 'json'
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            
            # Check for API errors
            if 'Error Message' in data:
                print(f"  ✗ API Error for {ticker}: {data['Error Message']}")
                return None
            
            if 'Note' in data:
                print(f"  ⚠ Rate limit hit for {ticker}, waiting {RETRY_DELAY * (attempt + 1)}s...")
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            
            if 'Information' in data:
                print(f"  ⚠ Info for {ticker}: {data['Information']}")
                return None
            
            # Check if we have time series data
            time_series_key = 'Time Series (Daily)'
            if time_series_key not in data:
                print(f"  ✗ No time series data for {ticker}")
                return None
            
            return data
            
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                print(f"  ⚠ Attempt {attempt + 1} failed for {ticker}: {e}. Retrying...")
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
                print(f"  ✗ Failed to fetch {ticker} after {MAX_RETRIES} attempts: {e}")
                return None
    
    return None


def parse_ticker_data(api_response: Dict, ticker: str) -> pd.DataFrame:
    """
    Parse Alpha Vantage API response into a DataFrame
    Returns DataFrame with columns: date, ticker, open, high, low, close, adjusted_close, volume, dividend, split_coefficient
    """
    time_series = api_response.get('Time Series (Daily)', {})
    
    rows = []
    for date_str, values in time_series.items():
        rows.append({
            'date': date_str,
            'ticker': ticker,
            'open': float(values.get('1. open', 0)),
            'high': float(values.get('2. high', 0)),
            'low': float(values.get('3. low', 0)),
            'close': float(values.get('4. close', 0)),
            'adjusted_close': float(values.get('5. adjusted close', 0)),
            'volume': int(float(values.get('6. volume', 0))),
            'dividend': float(values.get('7. dividend amount', 0)),
            'split_coefficient': float(values.get('8. split coefficient', 1.0)),
        })
    
    df = pd.DataFrame(rows)
    if not df.empty:
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values('date')
    
    return df


def save_ticker_data(df: pd.DataFrame, ticker: str, data_type: str):
    """Save ticker data to CSV file"""
    output_dir = os.path.join(RAW_DATA_DIR, data_type)
    os.makedirs(output_dir, exist_ok=True)
    
    csv_path = os.path.join(output_dir, f'{ticker}.csv')
    df.to_csv(csv_path, index=False)
    return csv_path


# ========= Main =========

def fetch_all_tickers(data_type: str, api_key: str, tickers: Optional[List[str]] = None):
    """
    Fetch adjusted close data for all tickers
    Args:
        data_type: 'spac' or 'despac'
        api_key: Alpha Vantage API key
        tickers: Optional list of specific tickers to fetch. If None, fetches all from dates.json
    """
    print("="*60)
    print(f"Alpha Vantage Adjusted Close Data Fetcher - {data_type.upper()}")
    print("="*60)
    print()
    
    if not api_key:
        print("❌ Error: Alpha Vantage API key not found")
        print("   Set it in one of these ways:")
        print("   1. Environment variable: export ALPHAVANTAGE_KEY='your_key_here'")
        print("   2. .env file: Create .env in project root with ALPHAVANTAGE_KEY=your_key_here")
        print("   3. Or use: ALPHA_VANTAGE_API_KEY or ALPHAVANTAGE_API_KEY")
        sys.exit(1)
    
    # Load tickers
    if tickers is None:
        ticker_to_date = load_tickers(data_type)
        tickers = list(ticker_to_date.keys())
    
    print(f"Found {len(tickers)} tickers to fetch")
    estimated_minutes = len(tickers) * API_CALL_DELAY / 60
    print(f"Estimated time: ~{estimated_minutes:.1f} minutes ({estimated_minutes * 60:.0f} seconds)")
    print(f"Rate limit: {1 / API_CALL_DELAY:.1f} calls/second (max 5/sec), {60 / API_CALL_DELAY:.0f} calls/minute (max 75/min)")
    print()
    
    # Create output directory
    os.makedirs(os.path.join(RAW_DATA_DIR, data_type), exist_ok=True)
    
    successful = []
    failed = []
    skipped = []
    
    for i, ticker in enumerate(tickers, 1):
        print(f"[{i}/{len(tickers)}] Fetching {ticker}...", end=' ', flush=True)
        
        # Check if already exists
        existing_file = os.path.join(RAW_DATA_DIR, data_type, f'{ticker}.csv')
        if os.path.exists(existing_file):
            print("⏭ Already exists, skipping")
            skipped.append(ticker)
            continue
        
        # Fetch data
        api_response = fetch_ticker_data(ticker, api_key)
        
        if api_response is None:
            failed.append(ticker)
            print()
            continue
        
        # Parse and save
        try:
            df = parse_ticker_data(api_response, ticker)
            
            if df.empty:
                print("✗ No data")
                failed.append(ticker)
                continue
            
            csv_path = save_ticker_data(df, ticker, data_type)
            successful.append(ticker)
            print(f"✓ {len(df)} days of data saved")
            
        except Exception as e:
            print(f"✗ Error processing: {e}")
            failed.append(ticker)
        
        # Rate limiting - ALWAYS wait between API calls with jitter to avoid burst patterns
        # This ensures we stay under both 5 requests/second and 75 requests/minute limits
        if i < len(tickers):
            delay = API_CALL_DELAY + random.uniform(0, API_CALL_JITTER)
            time.sleep(delay)
    
    print()
    print("="*60)
    print("Summary")
    print("="*60)
    print(f"  Successful: {len(successful)}")
    print(f"  Failed: {len(failed)}")
    print(f"  Skipped (already exists): {len(skipped)}")
    print()
    
    if successful:
        print(f"✓ Data saved to: {os.path.join(RAW_DATA_DIR, data_type)}")
    
    if failed:
        print(f"\n⚠ Failed tickers: {', '.join(failed)}")
        print("  You can retry by running the script again (it will skip successful ones)")


def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print("Usage: python adjusted_close.py [spac|despac] [ticker1 ticker2 ...]")
        print()
        print("Options:")
        print("  spac   - Fetch data for SPAC tickers")
        print("  despac - Fetch data for De-SPAC tickers")
        print()
        print("Optional: Provide specific tickers as additional arguments")
        print("  Example: python adjusted_close.py spac AAPL TSLA")
        print()
        print("Environment:")
        print("  Set API key in one of these ways:")
        print("  1. Environment variable: export ALPHAVANTAGE_KEY='your_key_here'")
        print("  2. .env file: Create .env in project root with ALPHAVANTAGE_KEY=your_key_here")
        print("  3. Or use: ALPHA_VANTAGE_API_KEY or ALPHAVANTAGE_API_KEY")
        sys.exit(1)
    
    data_type = sys.argv[1].lower()
    
    if data_type not in ['spac', 'despac']:
        print(f"Error: Unknown data type '{data_type}'")
        print("Usage: python adjusted_close.py [spac|despac]")
        sys.exit(1)
    
    # Get optional ticker list
    tickers = sys.argv[2:] if len(sys.argv) > 2 else None
    
    api_key = ALPHA_VANTAGE_API_KEY
    if not api_key:
        print("❌ Error: Alpha Vantage API key not found")
        print("   Set it in one of these ways:")
        print("   1. Environment variable: export ALPHAVANTAGE_KEY='your_key_here'")
        print("   2. .env file: Create .env in project root with ALPHAVANTAGE_KEY=your_key_here")
        print("   3. Or use: ALPHA_VANTAGE_API_KEY or ALPHAVANTAGE_API_KEY")
        sys.exit(1)
    
    fetch_all_tickers(data_type, api_key, tickers)


if __name__ == '__main__':
    main()

