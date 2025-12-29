"""
Fetch active ticker listings from Alpha Vantage API
Uses LISTING_STATUS endpoint to get active tickers on the first market day of each month
Stores deltas (additions/removals) between consecutive months
"""

import csv
import json
import os
import sys
import time
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple
from io import StringIO

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
API_FUNCTION = 'LISTING_STATUS'

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
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'data', 'active_tickers')


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


def get_earliest_date(data_type: str) -> datetime:
    """
    Load dates.json and find the earliest date from ticker_to_date values
    Returns datetime object
    """
    ticker_to_date = load_tickers(data_type)
    
    if not ticker_to_date:
        raise ValueError(f"No dates found in dates.json for {data_type}")
    
    dates = [datetime.strptime(date_str, '%Y-%m-%d') for date_str in ticker_to_date.values()]
    return min(dates)


def get_earliest_date_both() -> datetime:
    """
    Load dates.json for both SPAC and deSPAC and find the earliest date across both
    Returns datetime object
    """
    spac_date = None
    despac_date = None
    
    try:
        spac_date = get_earliest_date('spac')
        print(f"Earliest SPAC date: {spac_date.strftime('%Y-%m-%d')}")
    except Exception as e:
        print(f"⚠ Warning: Could not load SPAC dates: {e}")
    
    try:
        despac_date = get_earliest_date('despac')
        print(f"Earliest deSPAC date: {despac_date.strftime('%Y-%m-%d')}")
    except Exception as e:
        print(f"⚠ Warning: Could not load deSPAC dates: {e}")
    
    if spac_date is None and despac_date is None:
        raise ValueError("Could not load dates from either SPAC or deSPAC")
    
    dates = [d for d in [spac_date, despac_date] if d is not None]
    earliest = min(dates)
    print(f"Earliest date across both: {earliest.strftime('%Y-%m-%d')}")
    return earliest


def get_first_market_day(year: int, month: int) -> datetime:
    """
    Returns the first market day (Monday-Friday) of the given month
    Skips weekends
    """
    # Start with the first day of the month
    first_day = datetime(year, month, 1)
    
    # Find first weekday (Monday=0, Sunday=6)
    # If Saturday (5), move to Monday (add 2 days)
    # If Sunday (6), move to Monday (add 1 day)
    weekday = first_day.weekday()
    if weekday == 5:  # Saturday
        first_day += timedelta(days=2)
    elif weekday == 6:  # Sunday
        first_day += timedelta(days=1)
    
    return first_day


def generate_monthly_dates(start_date: datetime, end_date: datetime) -> List[datetime]:
    """
    Generate list of first market days for each month from start_date to end_date (inclusive)
    """
    dates = []
    current = datetime(start_date.year, start_date.month, 1)
    
    while current <= end_date:
        market_day = get_first_market_day(current.year, current.month)
        
        # Only include if market day is >= start_date
        if market_day >= start_date:
            dates.append(market_day)
        
        # Move to next month
        if current.month == 12:
            current = datetime(current.year + 1, 1, 1)
        else:
            current = datetime(current.year, current.month + 1, 1)
    
    return dates


def fetch_active_tickers(date: datetime, api_key: str) -> Optional[Set[str]]:
    """
    Fetch LISTING_STATUS data for active tickers on a given date
    Returns set of ticker symbols or None if failed
    """
    # Format date as YYYY-MM-DD for API
    date_str = date.strftime('%Y-%m-%d')
    
    params = {
        'function': API_FUNCTION,
        'date': date_str,
        'state': 'active',
        'apikey': api_key,
        'datatype': 'csv'  # Request CSV format for easier parsing
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=30)
            response.raise_for_status()
            
            # Check if response is CSV or JSON
            content_type = response.headers.get('content-type', '').lower()
            
            if 'json' in content_type or response.text.strip().startswith('{'):
                # JSON response - might be an error
                try:
                    data = response.json()
                    if 'Error Message' in data:
                        print(f"  ✗ API Error for {date_str}: {data['Error Message']}")
                        return None
                    if 'Note' in data:
                        print(f"  ⚠ Rate limit hit for {date_str}, waiting {RETRY_DELAY * (attempt + 1)}s...")
                        time.sleep(RETRY_DELAY * (attempt + 1))
                        continue
                    if 'Information' in data:
                        print(f"  ⚠ Info for {date_str}: {data['Information']}")
                        return None
                except:
                    pass
            
            # Try to parse as CSV first (preferred format)
            try:
                # Read CSV from response text
                csv_data = StringIO(response.text)
                df = pd.read_csv(csv_data)
                
                # Check if we have a 'symbol' column (case-insensitive)
                symbol_col = None
                for col in df.columns:
                    if col.lower() == 'symbol':
                        symbol_col = col
                        break
                
                if symbol_col:
                    tickers = set(df[symbol_col].dropna().astype(str).str.strip())
                    # Filter out empty strings
                    tickers = {t for t in tickers if t}
                    return tickers
                else:
                    print(f"  ✗ No 'symbol' column in response for {date_str}")
                    print(f"    Columns: {list(df.columns)}")
                    # Try to see if there's any data at all
                    if len(df) > 0:
                        print(f"    First row: {df.iloc[0].to_dict()}")
                    return None
                    
            except Exception as e:
                # If CSV parsing fails, try JSON
                if response.text.strip().startswith('{'):
                    try:
                        data = response.json()
                        if 'Error Message' in data:
                            print(f"  ✗ API Error: {data['Error Message']}")
                            return None
                        if 'Note' in data:
                            print(f"  ⚠ Rate limit: {data['Note']}")
                            time.sleep(RETRY_DELAY * (attempt + 1))
                            continue
                        if 'Information' in data:
                            print(f"  ⚠ Info: {data['Information']}")
                            return None
                        # Check if JSON has listing data in a different format
                        # Some APIs return data in nested structures
                        if 'data' in data or 'listings' in data:
                            print(f"  ⚠ Unexpected JSON format, may need different parsing")
                            return None
                    except json.JSONDecodeError:
                        pass
                
                print(f"  ✗ Failed to parse response for {date_str}: {e}")
                return None
            
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                print(f"  ⚠ Attempt {attempt + 1} failed for {date_str}: {e}. Retrying...")
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
                print(f"  ✗ Failed to fetch {date_str} after {MAX_RETRIES} attempts: {e}")
                return None
    
    return None


def compute_deltas(ticker_snapshots: List[Tuple[datetime, Set[str]]]) -> List[Dict[str, str]]:
    """
    Compute deltas between consecutive ticker snapshots
    Returns list of dicts with keys: date, action, ticker
    """
    deltas = []
    
    if not ticker_snapshots:
        return deltas
    
    # First snapshot: all tickers are 'add' actions
    first_date, first_tickers = ticker_snapshots[0]
    for ticker in sorted(first_tickers):
        deltas.append({
            'date': first_date.strftime('%Y-%m-%d'),
            'action': 'add',
            'ticker': ticker
        })
    
    # Subsequent snapshots: compute differences
    for i in range(1, len(ticker_snapshots)):
        prev_date, prev_tickers = ticker_snapshots[i - 1]
        curr_date, curr_tickers = ticker_snapshots[i]
        
        added = curr_tickers - prev_tickers
        removed = prev_tickers - curr_tickers
        
        # Add new tickers
        for ticker in sorted(added):
            deltas.append({
                'date': curr_date.strftime('%Y-%m-%d'),
                'action': 'add',
                'ticker': ticker
            })
        
        # Remove delisted tickers
        for ticker in sorted(removed):
            deltas.append({
                'date': curr_date.strftime('%Y-%m-%d'),
                'action': 'remove',
                'ticker': ticker
            })
    
    return deltas


def save_deltas(deltas: List[Dict[str, str]], data_type: str):
    """
    Save deltas to CSV file
    Format: date,action,ticker
    Sorted by date, then action, then ticker
    """
    output_path = os.path.join(OUTPUT_DIR, data_type, 'ticker_deltas.csv')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    # Sort deltas: date, then action (add before remove), then ticker
    sorted_deltas = sorted(deltas, key=lambda x: (x['date'], x['action'] == 'remove', x['ticker']))
    
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'action', 'ticker'])
        writer.writeheader()
        writer.writerows(sorted_deltas)
    
    return output_path


def load_existing_deltas(data_type: str) -> Tuple[Optional[datetime], List[Dict[str, str]]]:
    """
    Load existing deltas file and return the last processed date and all deltas
    Returns (last_date, deltas) or (None, []) if file doesn't exist
    """
    output_path = os.path.join(OUTPUT_DIR, data_type, 'ticker_deltas.csv')
    
    if not os.path.exists(output_path):
        return None, []
    
    deltas = []
    last_date = None
    
    with open(output_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            deltas.append(row)
            date_obj = datetime.strptime(row['date'], '%Y-%m-%d')
            if last_date is None or date_obj > last_date:
                last_date = date_obj
    
    return last_date, deltas


def reconstruct_ticker_set(deltas: List[Dict[str, str]], up_to_date: Optional[datetime] = None) -> Set[str]:
    """
    Reconstruct ticker set by applying deltas up to a given date
    If up_to_date is None, applies all deltas
    """
    active_tickers = set()
    
    for delta in deltas:
        if up_to_date:
            delta_date = datetime.strptime(delta['date'], '%Y-%m-%d')
            if delta_date > up_to_date:
                break
        
        if delta['action'] == 'add':
            active_tickers.add(delta['ticker'])
        elif delta['action'] == 'remove':
            active_tickers.discard(delta['ticker'])
    
    return active_tickers


# ========= Main =========

def fetch_active_tickers_for_months(api_key: str, resume: bool = True):
    """
    Fetch active tickers for each month and compute deltas
    Uses the minimum date from both SPAC and deSPAC date ranges
    Args:
        api_key: Alpha Vantage API key
        resume: If True, resume from last processed date in existing deltas file
    """
    print("="*60)
    print("Alpha Vantage Active Tickers Fetcher - SPAC & deSPAC")
    print("="*60)
    print()
    
    if not api_key:
        print("❌ Error: Alpha Vantage API key not found")
        print("   Set it in one of these ways:")
        print("   1. Environment variable: export ALPHAVANTAGE_KEY='your_key_here'")
        print("   2. .env file: Create .env in project root with ALPHAVANTAGE_KEY=your_key_here")
        print("   3. Or use: ALPHA_VANTAGE_API_KEY or ALPHAVANTAGE_API_KEY")
        sys.exit(1)
    
    # Get date range from both SPAC and deSPAC
    try:
        earliest_date = get_earliest_date_both()
        print()
    except Exception as e:
        print(f"❌ Error loading dates: {e}")
        sys.exit(1)
    
    # Generate monthly dates
    end_date = datetime.now()
    monthly_dates = generate_monthly_dates(earliest_date, end_date)
    print(f"Generated {len(monthly_dates)} months to process")
    print(f"Date range: {monthly_dates[0].strftime('%Y-%m-%d')} to {monthly_dates[-1].strftime('%Y-%m-%d')}")
    print()
    
    # Check for existing deltas files in both SPAC and deSPAC locations
    # Use the most recent one for resuming
    spac_last_date, spac_deltas = load_existing_deltas('spac')
    despac_last_date, despac_deltas = load_existing_deltas('despac')
    
    last_processed_date = None
    existing_deltas = []
    
    if resume:
        # Find the most recent date across both
        if spac_last_date and despac_last_date:
            if spac_last_date >= despac_last_date:
                last_processed_date = spac_last_date
                existing_deltas = spac_deltas
                print(f"Found existing deltas files (SPAC more recent)")
            else:
                last_processed_date = despac_last_date
                existing_deltas = despac_deltas
                print(f"Found existing deltas files (deSPAC more recent)")
        elif spac_last_date:
            last_processed_date = spac_last_date
            existing_deltas = spac_deltas
            print(f"Found existing SPAC deltas file")
        elif despac_last_date:
            last_processed_date = despac_last_date
            existing_deltas = despac_deltas
            print(f"Found existing deSPAC deltas file")
    
    if resume and last_processed_date:
        print(f"Last processed date: {last_processed_date.strftime('%Y-%m-%d')}")
        # Filter out dates that have already been processed
        monthly_dates = [d for d in monthly_dates if d > last_processed_date]
        if monthly_dates:
            print(f"Resuming from {monthly_dates[0].strftime('%Y-%m-%d')}, {len(monthly_dates)} months remaining")
        else:
            print("All months already processed!")
            return
        print()
    
    if not monthly_dates:
        print("No months to process")
        return
    
    # Fetch tickers for each month
    ticker_snapshots = []
    successful = []
    failed = []
    
    # If resuming, we need the previous month's ticker set for comparison
    # But we don't add it to snapshots since it's already in the deltas
    previous_ticker_set = None
    if resume and last_processed_date and existing_deltas:
        previous_ticker_set = reconstruct_ticker_set(existing_deltas, last_processed_date)
        if previous_ticker_set:
            print(f"Reconstructed {len(previous_ticker_set)} tickers from last processed date")
            print(f"Will compare new months against this baseline")
    
    print(f"Fetching active tickers for {len(monthly_dates)} months...")
    estimated_minutes = len(monthly_dates) * API_CALL_DELAY / 60
    print(f"Estimated time: ~{estimated_minutes:.1f} minutes")
    print()
    
    for i, date in enumerate(monthly_dates, 1):
        print(f"[{i}/{len(monthly_dates)}] Fetching {date.strftime('%Y-%m-%d')}...", end=' ', flush=True)
        
        tickers = fetch_active_tickers(date, api_key)
        
        if tickers is None:
            failed.append(date)
            print()
            continue
        
        ticker_snapshots.append((date, tickers))
        successful.append(date)
        print(f"✓ {len(tickers)} active tickers")
        
        # Rate limiting
        if i < len(monthly_dates):
            delay = API_CALL_DELAY + random.uniform(0, API_CALL_JITTER)
            time.sleep(delay)
    
    print()
    print("="*60)
    print("Summary")
    print("="*60)
    print(f"  Successful: {len(successful)}")
    print(f"  Failed: {len(failed)}")
    print()
    
    if failed:
        print(f"⚠ Failed dates: {', '.join([d.strftime('%Y-%m-%d') for d in failed])}")
    
    if not ticker_snapshots:
        print("❌ No ticker data collected, cannot compute deltas")
        return
    
    # Compute deltas
    print()
    print("Computing deltas...")
    
    # If resuming, we need to compare first new month against previous month
    if resume and previous_ticker_set is not None and ticker_snapshots:
        # Create a combined snapshot list with previous month for comparison
        # We don't include previous in the final deltas, just use it for comparison
        comparison_snapshots = [(last_processed_date, previous_ticker_set)] + ticker_snapshots
        new_deltas = compute_deltas(comparison_snapshots)
        # Remove deltas for the previous month (they're already in existing_deltas)
        new_deltas = [d for d in new_deltas if d['date'] != last_processed_date.strftime('%Y-%m-%d')]
    else:
        new_deltas = compute_deltas(ticker_snapshots)
    
    print(f"Generated {len(new_deltas)} new delta records")
    
    # Merge with existing deltas if resuming
    if resume and existing_deltas:
        # Combine existing and new deltas
        all_deltas = existing_deltas + new_deltas
        print(f"Total deltas (including existing): {len(all_deltas)}")
    else:
        all_deltas = new_deltas
    
    # Save deltas to both SPAC and deSPAC locations
    spac_output_path = save_deltas(all_deltas, 'spac')
    despac_output_path = save_deltas(all_deltas, 'despac')
    print(f"✓ Deltas saved to:")
    print(f"  - SPAC: {spac_output_path}")
    print(f"  - deSPAC: {despac_output_path}")


def main():
    """Main entry point"""
    api_key = ALPHA_VANTAGE_API_KEY
    if not api_key:
        print("❌ Error: Alpha Vantage API key not found")
        print("   Set it in one of these ways:")
        print("   1. Environment variable: export ALPHAVANTAGE_KEY='your_key_here'")
        print("   2. .env file: Create .env in project root with ALPHAVANTAGE_KEY=your_key_here")
        print("   3. Or use: ALPHA_VANTAGE_API_KEY or ALPHAVANTAGE_API_KEY")
        sys.exit(1)
    
    fetch_active_tickers_for_months(api_key, resume=True)


if __name__ == '__main__':
    main()

