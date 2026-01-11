"""
Fetch insider transactions data from Alpha Vantage API
Uses INSIDER_TRANSACTIONS endpoint to get all available historical insider trading data for each ticker
Queries one ticker at a time (no bulk API available)
"""

import json
import os
import sys
import time
import random
from datetime import datetime
from typing import Dict, List, Optional

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


def fetch_insider_transactions(ticker: str, api_key: str) -> Optional[Dict]:
    """
    Fetch insider transactions data for a single ticker using INSIDER_TRANSACTIONS endpoint
    Returns the full API response or None if failed
    """
    params = {
        'function': 'INSIDER_TRANSACTIONS',
        'symbol': ticker,
        'apikey': api_key
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            
            # Check for API errors
            if 'Error Message' in data:
                print(f"    ✗ API Error for {ticker}: {data['Error Message']}")
                return None
            
            if 'Note' in data:
                print(f"    ⚠ Rate limit hit for {ticker}, waiting {RETRY_DELAY * (attempt + 1)}s...")
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            
            if 'Information' in data:
                print(f"    ⚠ Info for {ticker}: {data['Information']}")
                return None
            
            # Check if we have insider transaction data
            # The actual key name might vary - could be 'data', 'transactions', or similar
            # We'll check for common keys and also accept any non-metadata keys
            metadata_keys = {'Meta Data', 'Information', 'Note', 'Error Message'}
            data_keys = [k for k in data.keys() if k not in metadata_keys]
            
            if not data_keys:
                print(f"    ✗ No insider transactions data structure for {ticker}")
                return None
            
            return data
            
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                print(f"    ⚠ Attempt {attempt + 1} failed for {ticker}: {e}. Retrying...")
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
                print(f"    ✗ Failed to fetch {ticker} after {MAX_RETRIES} attempts: {e}")
                return None
    
    return None


def save_ticker_insider_transactions(transactions_data: Optional[Dict], ticker: str, data_type: str):
    """Save ticker insider transactions data to JSON file"""
    output_dir = os.path.join(RAW_DATA_DIR, data_type, 'insider_transactions')
    os.makedirs(output_dir, exist_ok=True)
    
    # Save full API response
    insider_file_data = {
        'ticker': ticker,
        'insider_transactions': transactions_data  # Full INSIDER_TRANSACTIONS endpoint response
    }
    
    json_path = os.path.join(output_dir, f'{ticker}.json')
    with open(json_path, 'w') as f:
        json.dump(insider_file_data, f, indent=2)
    
    return json_path


# ========= Main =========

def fetch_all_tickers(data_type: str, api_key: str, tickers: Optional[List[str]] = None):
    """
    Fetch insider transactions data for all tickers
    Args:
        data_type: 'spac' or 'despac'
        api_key: Alpha Vantage API key
        tickers: Optional list of specific tickers to fetch. If None, fetches all from dates.json
    """
    print("="*60)
    print(f"Alpha Vantage Insider Transactions Fetcher - {data_type.upper()}")
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
    # Each ticker requires 1 API call
    total_calls = len(tickers)
    estimated_minutes = total_calls * API_CALL_DELAY / 60
    print(f"Total API calls: {total_calls} (1 per ticker)")
    print(f"Estimated time: ~{estimated_minutes:.1f} minutes ({estimated_minutes * 60:.0f} seconds)")
    print(f"Rate limit: {1 / API_CALL_DELAY:.1f} calls/second (max 5/sec), {60 / API_CALL_DELAY:.0f} calls/minute (max 75/min)")
    print()
    
    # Create output directory
    insider_dir = os.path.join(RAW_DATA_DIR, data_type, 'insider_transactions')
    os.makedirs(insider_dir, exist_ok=True)
    
    successful = []
    failed = []
    skipped = []
    
    for i, ticker in enumerate(tickers, 1):
        print(f"[{i}/{len(tickers)}] Fetching {ticker}...")
        
        # Check if already exists
        existing_file = os.path.join(insider_dir, f'{ticker}.json')
        if os.path.exists(existing_file):
            print("  ⏭ Already exists, skipping")
            skipped.append(ticker)
            continue
        
        # Fetch insider transactions data
        print("  Fetching INSIDER_TRANSACTIONS...", end=' ', flush=True)
        transactions_data = fetch_insider_transactions(ticker, api_key)
        
        if transactions_data:
            print("✓")
        else:
            print("✗")
        
        if not transactions_data:
            print(f"  ✗ No insider transactions data received for {ticker}")
            failed.append(ticker)
            # Still wait before next ticker to respect rate limits
            if i < len(tickers):
                delay = API_CALL_DELAY + random.uniform(0, API_CALL_JITTER)
                time.sleep(delay)
            continue
        
        # Save data
        try:
            json_path = save_ticker_insider_transactions(transactions_data, ticker, data_type)
            successful.append(ticker)
            print(f"  ✓ Insider transactions data saved")
        except Exception as e:
            print(f"  ✗ Error saving: {e}")
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
        print(f"✓ Data saved to: {insider_dir}")
    
    if failed:
        print(f"\n⚠ Failed tickers: {', '.join(failed)}")
        print("  You can retry by running the script again (it will skip successful ones)")


def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print("Usage: python get_insider_transactions.py [spac|despac] [ticker1 ticker2 ...]")
        print()
        print("Options:")
        print("  spac   - Fetch insider transactions data for SPAC tickers")
        print("  despac - Fetch insider transactions data for De-SPAC tickers")
        print()
        print("Optional: Provide specific tickers as additional arguments")
        print("  Example: python get_insider_transactions.py spac AAPL TSLA")
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
        print("Usage: python get_insider_transactions.py [spac|despac]")
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

