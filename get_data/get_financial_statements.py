"""
Fetch financial statements data from Alpha Vantage API
Uses BALANCE_SHEET, CASH_FLOW, and INCOME_STATEMENT endpoints to get financial data for each ticker
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


def fetch_financial_statement(ticker: str, statement_type: str, api_key: str) -> Optional[Dict]:
    """
    Fetch financial statement data for a single ticker and statement type
    statement_type: 'BALANCE_SHEET', 'CASH_FLOW', or 'INCOME_STATEMENT'
    Returns the full API response or None if failed
    """
    params = {
        'function': statement_type,
        'symbol': ticker,
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
                print(f"    ✗ API Error for {ticker} {statement_type}: {data['Error Message']}")
                return None
            
            if 'Note' in data:
                print(f"    ⚠ Rate limit hit for {ticker} {statement_type}, waiting {RETRY_DELAY * (attempt + 1)}s...")
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            
            if 'Information' in data:
                print(f"    ⚠ Info for {ticker} {statement_type}: {data['Information']}")
                return None
            
            # Check if we have the expected data structure
            # Alpha Vantage returns different keys for different statement types
            has_data = False
            if statement_type == 'BALANCE_SHEET':
                has_data = 'quarterlyReports' in data or 'annualReports' in data
            elif statement_type == 'CASH_FLOW':
                has_data = 'quarterlyReports' in data or 'annualReports' in data
            elif statement_type == 'INCOME_STATEMENT':
                has_data = 'quarterlyReports' in data or 'annualReports' in data
            
            if not has_data:
                print(f"    ✗ No financial data structure for {ticker} {statement_type}")
                return None
            
            return data
            
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                print(f"    ⚠ Attempt {attempt + 1} failed for {ticker} {statement_type}: {e}. Retrying...")
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
                print(f"    ✗ Failed to fetch {ticker} {statement_type} after {MAX_RETRIES} attempts: {e}")
                return None
    
    return None


def save_ticker_financial_statements(balance_sheet: Optional[Dict], cash_flow: Optional[Dict], 
                                     income_statement: Optional[Dict], ticker: str, data_type: str):
    """Save ticker financial statements data to JSON file"""
    output_dir = os.path.join(RAW_DATA_DIR, data_type, 'financial_statements')
    os.makedirs(output_dir, exist_ok=True)
    
    # Combine all three statements into one structure
    financial_data = {
        'ticker': ticker,
        'balanceSheet': balance_sheet,
        'cashFlow': cash_flow,
        'incomeStatement': income_statement
    }
    
    json_path = os.path.join(output_dir, f'{ticker}.json')
    with open(json_path, 'w') as f:
        json.dump(financial_data, f, indent=2)
    
    return json_path


# ========= Main =========

def fetch_all_tickers(data_type: str, api_key: str, tickers: Optional[List[str]] = None):
    """
    Fetch financial statements data for all tickers
    Args:
        data_type: 'spac' or 'despac'
        api_key: Alpha Vantage API key
        tickers: Optional list of specific tickers to fetch. If None, fetches all from dates.json
    """
    print("="*60)
    print(f"Alpha Vantage Financial Statements Fetcher - {data_type.upper()}")
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
    # Each ticker requires 3 API calls (balance sheet, cash flow, income statement)
    total_calls = len(tickers) * 3
    estimated_minutes = total_calls * API_CALL_DELAY / 60
    print(f"Total API calls: {total_calls} (3 per ticker)")
    print(f"Estimated time: ~{estimated_minutes:.1f} minutes ({estimated_minutes * 60:.0f} seconds)")
    print(f"Rate limit: {1 / API_CALL_DELAY:.1f} calls/second (max 5/sec), {60 / API_CALL_DELAY:.0f} calls/minute (max 75/min)")
    print()
    
    # Create output directory
    financial_statements_dir = os.path.join(RAW_DATA_DIR, data_type, 'financial_statements')
    os.makedirs(financial_statements_dir, exist_ok=True)
    
    successful = []
    failed = []
    skipped = []
    partial = []  # Tickers with some but not all statements
    
    statement_types = ['BALANCE_SHEET', 'CASH_FLOW', 'INCOME_STATEMENT']
    
    for i, ticker in enumerate(tickers, 1):
        print(f"[{i}/{len(tickers)}] Fetching {ticker}...")
        
        # Check if already exists
        existing_file = os.path.join(financial_statements_dir, f'{ticker}.json')
        if os.path.exists(existing_file):
            print("  ⏭ Already exists, skipping")
            skipped.append(ticker)
            continue
        
        # Fetch all three statement types
        balance_sheet = None
        cash_flow = None
        income_statement = None
        
        call_count = 0
        for statement_type in statement_types:
            call_count += 1
            print(f"  [{call_count}/3] Fetching {statement_type}...", end=' ', flush=True)
            
            result = fetch_financial_statement(ticker, statement_type, api_key)
            
            if statement_type == 'BALANCE_SHEET':
                balance_sheet = result
            elif statement_type == 'CASH_FLOW':
                cash_flow = result
            elif statement_type == 'INCOME_STATEMENT':
                income_statement = result
            
            if result:
                print("✓")
            else:
                print("✗")
            
            # Rate limiting - ALWAYS wait between API calls with jitter to avoid burst patterns
            # This ensures we stay under both 5 requests/second and 75 requests/minute limits
            if call_count < 3 or i < len(tickers):
                delay = API_CALL_DELAY + random.uniform(0, API_CALL_JITTER)
                time.sleep(delay)
        
        # Check if we got at least one statement
        statements_received = sum([
            1 if balance_sheet else 0,
            1 if cash_flow else 0,
            1 if income_statement else 0
        ])
        
        if statements_received == 0:
            print(f"  ✗ No financial statements received for {ticker}")
            failed.append(ticker)
            continue
        
        # Save data (even if partial)
        try:
            json_path = save_ticker_financial_statements(
                balance_sheet, cash_flow, income_statement, ticker, data_type
            )
            
            if statements_received == 3:
                successful.append(ticker)
                print(f"  ✓ All 3 statements saved")
            else:
                partial.append(ticker)
                print(f"  ⚠ Partial data saved ({statements_received}/3 statements)")
        except Exception as e:
            print(f"  ✗ Error saving: {e}")
            failed.append(ticker)
    
    print()
    print("="*60)
    print("Summary")
    print("="*60)
    print(f"  Successful (all 3 statements): {len(successful)}")
    print(f"  Partial (some statements): {len(partial)}")
    print(f"  Failed: {len(failed)}")
    print(f"  Skipped (already exists): {len(skipped)}")
    print()
    
    if successful:
        print(f"✓ Data saved to: {financial_statements_dir}")
    
    if partial:
        print(f"\n⚠ Tickers with partial data: {len(partial)}")
        print(f"  {', '.join(partial)}")
        print("  (Some statements may be missing)")
    
    if failed:
        print(f"\n⚠ Failed tickers: {', '.join(failed)}")
        print("  You can retry by running the script again (it will skip successful ones)")


def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print("Usage: python get_financial_statements.py [spac|despac] [ticker1 ticker2 ...]")
        print()
        print("Options:")
        print("  spac   - Fetch financial statements for SPAC tickers")
        print("  despac - Fetch financial statements for De-SPAC tickers")
        print()
        print("Optional: Provide specific tickers as additional arguments")
        print("  Example: python get_financial_statements.py spac AAPL TSLA")
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
        print("Usage: python get_financial_statements.py [spac|despac]")
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

