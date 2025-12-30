"""
Fetch active ticker listings from Alpha Vantage API
Uses LISTING_STATUS endpoint to get active tickers for each trading day
Stores as parquet: date, ticker (one row per date-ticker combination)
Saves all data at the end (not incrementally)
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


def get_earliest_date_both() -> datetime:
    """
    Load dates.json for both SPAC and deSPAC and find the earliest date across both
    Returns datetime object
    """
    spac_date = None
    despac_date = None
    
    try:
        spac_tickers = load_tickers('spac')
        if spac_tickers:
            dates = [datetime.strptime(date_str, '%Y-%m-%d') for date_str in spac_tickers.values()]
            spac_date = min(dates)
        print(f"Earliest SPAC date: {spac_date.strftime('%Y-%m-%d')}")
    except Exception as e:
        print(f"⚠ Warning: Could not load SPAC dates: {e}")
    
    try:
        despac_tickers = load_tickers('despac')
        if despac_tickers:
            dates = [datetime.strptime(date_str, '%Y-%m-%d') for date_str in despac_tickers.values()]
            despac_date = min(dates)
        print(f"Earliest deSPAC date: {despac_date.strftime('%Y-%m-%d')}")
    except Exception as e:
        print(f"⚠ Warning: Could not load deSPAC dates: {e}")
    
    if spac_date is None and despac_date is None:
        raise ValueError("Could not load dates from either SPAC or deSPAC")
    
    dates = [d for d in [spac_date, despac_date] if d is not None]
    earliest = min(dates)
    print(f"Earliest date across both: {earliest.strftime('%Y-%m-%d')}")
    return earliest


def get_trading_dates(start_date: datetime, end_date: datetime) -> List[datetime]:
    """
    Generate all trading dates (weekdays only) between start_date and end_date (inclusive)
    Skips weekends (Saturday=5, Sunday=6)
    """
    trading_dates = []
    current_date = start_date
    
    while current_date <= end_date:
        # Only include weekdays (Monday=0 to Friday=4)
        if current_date.weekday() < 5:
            trading_dates.append(current_date)
        current_date += timedelta(days=1)
    
    return trading_dates


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


def load_existing_data(data_type: str) -> Tuple[Optional[pd.DataFrame], Set[Tuple[str, str]]]:
    """
    Load existing parquet file and return DataFrame and set of (date, ticker) combinations already fetched
    Returns (DataFrame, set) for fast lookup
    """
    parquet_path = os.path.join(OUTPUT_DIR, data_type, 'active_tickers.parquet')
    
    if not os.path.exists(parquet_path):
        return None, set()
    
    fetched_combos = set()
    try:
        df = pd.read_parquet(parquet_path)
        if 'date' in df.columns and 'ticker' in df.columns:
            for _, row in df.iterrows():
                date_str = str(row['date'])
                ticker = str(row['ticker'])
                if date_str and ticker:
                    fetched_combos.add((date_str, ticker))
        return df, fetched_combos
    except Exception as e:
        print(f"⚠ Warning: Could not read existing parquet file: {e}")
        return None, set()


def save_active_tickers(df: pd.DataFrame, data_type: str):
    """
    Save active tickers data to parquet file
    Format: date, ticker
    Sorted by date, then ticker
    """
    output_path = os.path.join(OUTPUT_DIR, data_type, 'active_tickers.parquet')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    # Sort by date, then ticker
    df_sorted = df.sort_values(['date', 'ticker'])
    
    # Save to parquet
    df_sorted.to_parquet(output_path, index=False, engine='pyarrow')
    
    return output_path


# ========= Main =========

def fetch_active_tickers_for_days(api_key: str, resume: bool = True):
    """
    Fetch active tickers for each trading day
    Args:
        api_key: Alpha Vantage API key
        resume: If True, resume from last processed date in existing parquet file
    """
    print("="*60)
    print("Alpha Vantage Active Tickers Fetcher - Daily Snapshots")
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
    
    # Generate trading dates
    end_date = datetime.now()
    trading_dates = get_trading_dates(earliest_date, end_date)
    print(f"Generated {len(trading_dates)} trading days to process")
    print(f"Date range: {trading_dates[0].strftime('%Y-%m-%d')} to {trading_dates[-1].strftime('%Y-%m-%d')}")
    print()
    
    # Check for existing data in both SPAC and deSPAC locations
    # Use the most recent one for resuming
    spac_df, spac_fetched = load_existing_data('spac')
    despac_df, despac_fetched = load_existing_data('despac')
    
    # Combine to get all fetched dates
    all_fetched_dates = set()
    for date_str, _ in spac_fetched | despac_fetched:
        all_fetched_dates.add(date_str)
    
    last_processed_date = None
    if resume and all_fetched_dates:
        # Find the most recent date
        dates = [datetime.strptime(d, '%Y-%m-%d') for d in all_fetched_dates]
        last_processed_date = max(dates)
        print(f"Found existing data files")
        print(f"Last processed date: {last_processed_date.strftime('%Y-%m-%d')}")
        # Filter out dates that have already been processed
        trading_dates = [d for d in trading_dates if d > last_processed_date]
        if trading_dates:
            print(f"Resuming from {trading_dates[0].strftime('%Y-%m-%d')}, {len(trading_dates)} days remaining")
        else:
            print("All days already processed!")
            return
        print()
    
    if not trading_dates:
        print("No trading days to process")
        return
    
    # Collect new data
    new_data = []
    
    successful = []
    failed = []
    
    print(f"Fetching active tickers for {len(trading_dates)} trading days...")
    estimated_minutes = len(trading_dates) * API_CALL_DELAY / 60
    print(f"Estimated time: ~{estimated_minutes:.1f} minutes")
    print()
    
    for i, date in enumerate(trading_dates, 1):
        date_str = date.strftime('%Y-%m-%d')
        print(f"[{i}/{len(trading_dates)}] Fetching {date_str}...", end=' ', flush=True)
        
        # Check if already fetched
        if resume and date_str in all_fetched_dates:
            print("⏭ Already exists, skipping")
            continue
        
        tickers = fetch_active_tickers(date, api_key)
        
        if tickers is None:
            failed.append(date)
            print()
            continue
        
        successful.append(date)
        print(f"✓ {len(tickers)} active tickers")
        
        # Add to new data (same data for both SPAC and deSPAC)
        for ticker in sorted(tickers):
            new_data.append({'date': date_str, 'ticker': ticker})
        
        # Rate limiting
        if i < len(trading_dates):
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
    
    # Merge with existing data and save
    if new_data:
    print()
        print("Saving data...")
    
        # Create DataFrame from new data
        new_df = pd.DataFrame(new_data)
        
        # Merge with existing dataframes
        if spac_df is not None and not spac_df.empty:
            combined_spac_df = pd.concat([spac_df, new_df], ignore_index=True)
    else:
            combined_spac_df = new_df
        
        if despac_df is not None and not despac_df.empty:
            combined_despac_df = pd.concat([despac_df, new_df], ignore_index=True)
        else:
            combined_despac_df = new_df
        
        # Save to both locations
        spac_output_path = save_active_tickers(combined_spac_df, 'spac')
        despac_output_path = save_active_tickers(combined_despac_df, 'despac')
        print(f"✓ Data saved to:")
        print(f"  - SPAC: {spac_output_path} ({len(combined_spac_df)} rows)")
        print(f"  - deSPAC: {despac_output_path} ({len(combined_despac_df)} rows)")
    else:
        print("No new data to save")


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
    
    fetch_active_tickers_for_days(api_key, resume=True)


if __name__ == '__main__':
    main()
