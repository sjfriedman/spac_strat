"""
Fetch historical options data from Alpha Vantage API
Uses HISTORICAL_OPTIONS endpoint to get options chain data for each ticker on each trading date
Queries one ticker-date combination at a time (no bulk API available)
"""

import csv
import json
import os
import sys
import time
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple

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
API_FUNCTION = 'HISTORICAL_OPTIONS'

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
ACTIVE_TICKERS_DIR = os.path.join(PROJECT_ROOT, 'data', 'active_tickers')
OPTION_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'option_data')


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


def load_active_tickers(data_type: str) -> Dict[str, Set[str]]:
    """
    Load active tickers from parquet file
    Parquet format: date, ticker (one row per date-ticker combination)
    Returns dict: {date_string: set(tickers)} showing which tickers are active on each date
    """
    parquet_path = os.path.join(ACTIVE_TICKERS_DIR, data_type, 'active_tickers.parquet')
    
    if not os.path.exists(parquet_path):
        raise FileNotFoundError(f"Active tickers file not found: {parquet_path}")
    
    date_to_tickers = {}
    
    try:
        df = pd.read_parquet(parquet_path)
        if 'date' in df.columns and 'ticker' in df.columns:
            for _, row in df.iterrows():
                date_str = str(row['date'])
                ticker = str(row['ticker'])
                
                if date_str and ticker:
                    if date_str not in date_to_tickers:
                        date_to_tickers[date_str] = set()
                    date_to_tickers[date_str].add(ticker)
    except Exception as e:
        raise FileNotFoundError(f"Error reading active tickers file: {e}")
    
    return date_to_tickers


def get_first_market_day(year: int, month: int) -> datetime:
    """
    Returns the first market day (Monday-Friday) of the given month
    Skips weekends
    Reused from get_active_tickers.py
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


def filter_relevant_tickers(
    date_to_tickers: Dict[str, Set[str]], 
    ticker_to_date: Dict[str, str],
    query_date: datetime
) -> Set[str]:
    """
    Filter tickers to only include those where:
    - Ticker exists in dates.json (SPAC or deSPAC ticker)
    - IPO/deSPAC date <= current query date
    
    Args:
        date_to_tickers: Dict mapping date strings to sets of active tickers
        ticker_to_date: Dict mapping tickers to their IPO/deSPAC dates
        query_date: The date we're querying for
    
    Returns:
        Set of relevant tickers for the query date
    """
    query_date_str = query_date.strftime('%Y-%m-%d')
    
    # Get active tickers on this date
    active_tickers = date_to_tickers.get(query_date_str, set())
    
    # Filter to only tickers in our dates.json and where IPO/deSPAC date <= query_date
    relevant_tickers = set()
    for ticker in active_tickers:
        if ticker in ticker_to_date:
            ipo_date_str = ticker_to_date[ticker]
            ipo_date = datetime.strptime(ipo_date_str, '%Y-%m-%d')
            if ipo_date <= query_date:
                relevant_tickers.add(ticker)
    
    return relevant_tickers


def fetch_historical_options(ticker: str, date: datetime, api_key: str) -> Optional[Dict]:
    """
    Fetch HISTORICAL_OPTIONS data for a single ticker on a specific date
    Returns the full API response or None if failed
    """
    date_str = date.strftime('%Y-%m-%d')
    
    params = {
        'function': API_FUNCTION,
        'symbol': ticker,
        'date': date_str,
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
                print(f"    ✗ API Error for {ticker} on {date_str}: {data['Error Message']}")
                return None
            
            if 'Note' in data:
                print(f"    ⚠ Rate limit hit for {ticker} on {date_str}, waiting {RETRY_DELAY * (attempt + 1)}s...")
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            
            if 'Information' in data:
                print(f"    ⚠ Info for {ticker} on {date_str}: {data['Information']}")
                return None
            
            # Check if we have options data
            # The structure may vary, but typically has 'data' or similar key
            # We'll accept any response that doesn't have error indicators
            return data
            
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                print(f"    ⚠ Attempt {attempt + 1} failed for {ticker} on {date_str}: {e}. Retrying...")
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
                print(f"    ✗ Failed to fetch {ticker} on {date_str} after {MAX_RETRIES} attempts: {e}")
                return None
    
    return None


def check_options_availability(
    ticker: str, 
    month_date: datetime, 
    api_key: str,
    skip_cache: Dict[str, Dict[str, bool]]
) -> bool:
    """
    Check if ticker has options data available for a given month
    Checks first trading day of current month, then next month if needed
    If no data after 2 consecutive months, marks to skip
    
    Args:
        ticker: Ticker symbol
        month_date: Any date in the month to check
        api_key: API key
        skip_cache: Cache of skip decisions {ticker: {month_key: should_skip}}
    
    Returns:
        True if should skip this ticker for this month, False otherwise
    """
    month_key = month_date.strftime('%Y-%m')
    
    # Check cache first
    if ticker in skip_cache and month_key in skip_cache[ticker]:
        return skip_cache[ticker][month_key]
    
    # Check first trading day of current month
    first_day = get_first_market_day(month_date.year, month_date.month)
    response = fetch_historical_options(ticker, first_day, api_key)
    
    # Rate limiting - ALWAYS wait after API call
    delay = API_CALL_DELAY + random.uniform(0, API_CALL_JITTER)
    time.sleep(delay)
    
    # Check if response has actual options data
    has_data = False
    if response is not None:
        # Check for data key and that it's not empty
        if 'data' in response:
            data = response['data']
            # Data exists and is not empty
            if isinstance(data, (dict, list)) and len(data) > 0:
                has_data = True
    
    if has_data:
        # Has data, don't skip
        if ticker not in skip_cache:
            skip_cache[ticker] = {}
        skip_cache[ticker][month_key] = False
        return False
    
    # No data on first day, check next month's first day (if not in the future)
    next_month = month_date.replace(day=28) + timedelta(days=4)  # Move to next month
    next_month = next_month.replace(day=1)
    next_first_day = get_first_market_day(next_month.year, next_month.month)
    
    # Only check next month if it's not in the future
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    has_next_data = False
    if next_first_day <= today:
        next_response = fetch_historical_options(ticker, next_first_day, api_key)
        
        # Rate limiting - ALWAYS wait after API call
        delay = API_CALL_DELAY + random.uniform(0, API_CALL_JITTER)
        time.sleep(delay)
        
        # Check if next month has data
        if next_response is not None:
            if 'data' in next_response:
                next_data = next_response['data']
                if isinstance(next_data, (dict, list)) and len(next_data) > 0:
                    has_next_data = True
    
    if has_next_data:
        # Has data next month, don't skip this month
        if ticker not in skip_cache:
            skip_cache[ticker] = {}
        skip_cache[ticker][month_key] = False
        return False
    
    # No data for 2 consecutive months, skip this month
    if ticker not in skip_cache:
        skip_cache[ticker] = {}
    skip_cache[ticker][month_key] = True
    return True


def parse_options_response(api_response: Dict, ticker: str, date: datetime) -> List[Dict]:
    """
    Parse Alpha Vantage API response and flatten options chain data
    Returns list of dict records, one per option contract
    """
    records = []
    date_str = date.strftime('%Y-%m-%d')
    
    # The API response structure may vary, but typically has 'data' key
    # with nested structure: expiration_date -> strike -> option_type -> contract data
    if 'data' not in api_response:
        # No options data for this date
        return records
    
    data = api_response['data']
    
    # Handle different possible structures
    # Common structure: {expiration_date: {strike: {option_type: {contract_data}}}}
    if isinstance(data, dict):
        for expiration_date, strikes in data.items():
            if isinstance(strikes, dict):
                for strike_str, option_types in strikes.items():
                    if isinstance(option_types, dict):
                        for option_type, contract_data in option_types.items():
                            # Create record with all fields
                            record = {
                                'date': date_str,
                                'ticker': ticker,
                                'expiration_date': expiration_date,
                                'strike': strike_str,
                                'option_type': option_type,
                            }
                            # Add all contract data fields
                            if isinstance(contract_data, dict):
                                record.update(contract_data)
                            else:
                                record['contract_data'] = contract_data
                            records.append(record)
                    else:
                        # Flat structure, just add expiration and strike
                        record = {
                            'date': date_str,
                            'ticker': ticker,
                            'expiration_date': expiration_date,
                            'strike': strike_str,
                            'contract_data': option_types,
                        }
                        records.append(record)
            else:
                # Very flat structure
                record = {
                    'date': date_str,
                    'ticker': ticker,
                    'expiration_date': expiration_date,
                    'contract_data': strikes,
                }
                records.append(record)
    elif isinstance(data, list):
        # List of contracts
        for contract in data:
            record = {
                'date': date_str,
                'ticker': ticker,
            }
            if isinstance(contract, dict):
                record.update(contract)
                # Ensure expiration_date exists for sorting
                if 'expiration_date' not in record:
                    record['expiration_date'] = ''
            else:
                record['contract_data'] = contract
                record['expiration_date'] = ''
            records.append(record)
    
    return records


def load_existing_data(data_type: str) -> Tuple[Optional[pd.DataFrame], Set[Tuple[str, str]]]:
    """
    Load existing parquet file if it exists
    Returns (DataFrame, set of (date, ticker) tuples already fetched)
    """
    parquet_path = os.path.join(OPTION_DATA_DIR, data_type, 'options_data.parquet')
    
    if not os.path.exists(parquet_path):
        return None, set()
    
    try:
        df = pd.read_parquet(parquet_path)
        # Extract (date, ticker) combinations
        fetched_combos = set()
        if 'date' in df.columns and 'ticker' in df.columns:
            # Normalize date format to YYYY-MM-DD for consistent comparison
            # Convert date column to string format if needed
            if pd.api.types.is_datetime64_any_dtype(df['date']):
                df['date_str'] = df['date'].dt.strftime('%Y-%m-%d')
            else:
                df['date_str'] = df['date'].astype(str).str[:10]  # Take YYYY-MM-DD part
            
            # Get unique combinations efficiently
            unique_combos = df[['date_str', 'ticker']].drop_duplicates()
            fetched_combos = set(zip(unique_combos['date_str'], unique_combos['ticker'].astype(str)))
        return df, fetched_combos
    except Exception as e:
        print(f"⚠ Warning: Could not read existing parquet file: {e}")
        return None, set()


def save_options_data(df: pd.DataFrame, data_type: str):
    """
    Save options data to parquet file
    Sorts by date, ticker, expiration_date before saving
    """
    output_dir = os.path.join(OPTION_DATA_DIR, data_type)
    os.makedirs(output_dir, exist_ok=True)
    
    parquet_path = os.path.join(output_dir, 'options_data.parquet')
    
    # Sort by date, ticker, expiration_date
    sort_columns = ['date', 'ticker']
    if 'expiration_date' in df.columns:
        sort_columns.append('expiration_date')
    
    df_sorted = df.sort_values(sort_columns)
    
    # Save to parquet
    df_sorted.to_parquet(parquet_path, index=False, engine='pyarrow')
    
    return parquet_path


# ========= Main =========

def fetch_options_data(data_type: str, api_key: str, tickers: Optional[List[str]] = None):
    """
    Fetch historical options data for all relevant tickers
    Args:
        data_type: 'spac' or 'despac'
        api_key: Alpha Vantage API key
        tickers: Optional list of specific tickers to fetch. If None, fetches all from dates.json
    """
    print("="*60)
    print(f"Alpha Vantage Historical Options Data Fetcher - {data_type.upper()}")
    print("="*60)
    print()
    
    if not api_key:
        print("❌ Error: Alpha Vantage API key not found")
        print("   Set it in one of these ways:")
        print("   1. Environment variable: export ALPHAVANTAGE_KEY='your_key_here'")
        print("   2. .env file: Create .env in project root with ALPHAVANTAGE_KEY=your_key_here")
        print("   3. Or use: ALPHA_VANTAGE_API_KEY or ALPHAVANTAGE_API_KEY")
        sys.exit(1)
    
    # Load tickers and their IPO/deSPAC dates
    print("Loading tickers and dates...")
    try:
        all_ticker_to_date = load_tickers(data_type)
        if tickers is None:
            ticker_to_date = all_ticker_to_date
            print(f"  ✓ Loaded {len(ticker_to_date)} tickers from dates.json")
        else:
            # Filter to only requested tickers
            ticker_to_date = {t: all_ticker_to_date[t] for t in tickers if t in all_ticker_to_date}
            missing = [t for t in tickers if t not in all_ticker_to_date]
            if missing:
                print(f"  ⚠ Warning: Tickers not found in dates.json: {', '.join(missing)}")
            print(f"  ✓ Processing {len(ticker_to_date)} tickers")
    except Exception as e:
        print(f"❌ Error loading tickers: {e}")
        sys.exit(1)
    
    # Load active tickers
    print("Loading active tickers...")
    try:
        date_to_tickers = load_active_tickers(data_type)
        total_ticker_dates = sum(len(tickers) for tickers in date_to_tickers.values())
        print(f"  ✓ Loaded {len(date_to_tickers)} date snapshots with {total_ticker_dates} total ticker-date combinations")
    except Exception as e:
        print(f"❌ Error loading active tickers: {e}")
        print(f"   Run get_active_tickers.py first to generate active_tickers.csv")
        sys.exit(1)
    
    # Get date range
    if not ticker_to_date:
        print("❌ No tickers found in dates.json")
        sys.exit(1)
    
    dates_list = [datetime.strptime(d, '%Y-%m-%d') for d in ticker_to_date.values()]
    earliest_date = min(dates_list)
    end_date = datetime.now()
    
    print(f"  Date range: {earliest_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
    print()
    
    # Generate trading dates
    print("Generating trading dates...")
    trading_dates = get_trading_dates(earliest_date, end_date)
    print(f"  ✓ Generated {len(trading_dates)} trading dates")
    print()
    
    # Load existing data for resume
    print("Checking for existing data...")
    existing_df, fetched_combos = load_existing_data(data_type)
    if existing_df is not None:
        print(f"  ✓ Found existing data: {len(existing_df)} records")
        print(f"  ✓ {len(fetched_combos)} (date, ticker) combinations already fetched")
    else:
        print("  ✓ No existing data found, starting fresh")
    print()
    
    # Initialize skip cache for monthly availability checks
    skip_cache: Dict[str, Dict[str, bool]] = {}
    
    # Statistics
    successful = 0
    failed = 0
    skipped_existing = 0
    skipped_no_options = 0
    total_records = 0
    
    # Collect data in daily batches
    all_records = []
    current_month = None
    
    print(f"Processing {len(trading_dates)} trading dates...")
    estimated_calls = len(trading_dates) * 10  # Rough estimate
    estimated_minutes = estimated_calls * API_CALL_DELAY / 60
    print(f"Estimated time: ~{estimated_minutes:.1f} minutes")
    print(f"Rate limit: {1 / API_CALL_DELAY:.1f} calls/second (max 5/sec), {60 / API_CALL_DELAY:.0f} calls/minute (max 75/min)")
    print()
    
    for i, trading_date in enumerate(trading_dates, 1):
        date_str = trading_date.strftime('%Y-%m-%d')
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{i}/{len(trading_dates)}] Processing {date_str} [{timestamp}]...", end=' ', flush=True)
        
        # Get relevant tickers for this date
        relevant_tickers = filter_relevant_tickers(date_to_tickers, ticker_to_date, trading_date)
        
        if not relevant_tickers:
            print("⏭ No relevant tickers")
            continue
        
        print(f"{len(relevant_tickers)} tickers", flush=True)
        
        # Check if we need to do monthly availability check
        month_key = trading_date.strftime('%Y-%m')
        if current_month != month_key:
            current_month = month_key
            # Reset skip decisions for new month (we check per month)
            pass
        
        daily_records = []
        daily_successful = 0
        daily_failed = 0
        daily_skipped_existing = 0
        daily_skipped_no_options = 0
        
        # Check if this is the first trading day of the month
        first_day_of_month = get_first_market_day(trading_date.year, trading_date.month)
        is_first_trading_day = (trading_date == first_day_of_month)
        
        for ticker in sorted(relevant_tickers):
            # If specific tickers requested, only process those
            if tickers is not None and ticker not in tickers:
                continue
            
            # Check if already fetched
            if (date_str, ticker) in fetched_combos:
                skipped_existing += 1
                daily_skipped_existing += 1
                continue
            
            # Monthly availability check
            month_key = trading_date.strftime('%Y-%m')
            
            # Check cache first
            if ticker in skip_cache and month_key in skip_cache[ticker]:
                if skip_cache[ticker][month_key]:
                    # Marked to skip for this month
                    skipped_no_options += 1
                    daily_skipped_no_options += 1
                    continue
            elif is_first_trading_day:
                # On first trading day, check availability
                # Note: check_options_availability already includes rate limiting delays
                should_skip = check_options_availability(ticker, trading_date, api_key, skip_cache)
                if should_skip:
                    skipped_no_options += 1
                    daily_skipped_no_options += 1
                    continue
                # check_options_availability already waited, but ensure we have proper spacing
                # before the next ticker (delay is at end of loop iteration)
            
            # Fetch options data
            api_response = fetch_historical_options(ticker, trading_date, api_key)
            
            if api_response is None:
                failed += 1
                daily_failed += 1
                # Still wait for rate limiting
                delay = API_CALL_DELAY + random.uniform(0, API_CALL_JITTER)
                time.sleep(delay)
                continue
            
            # Parse response
            records = parse_options_response(api_response, ticker, trading_date)
            
            # Mark as fetched (even if 0 records - empty options data is valid)
            fetched_combos.add((date_str, ticker))
            
            if records:
                daily_records.extend(records)
                successful += 1
                daily_successful += 1
            else:
                # Empty response (no options data) is valid
                # Save a marker record so we know this date was fetched (for resume logic)
                daily_records.append({
                    'date': date_str,
                    'ticker': ticker,
                    'expiration_date': '',
                    'no_options_data': True  # Marker to indicate no options available
                })
                successful += 1
                daily_successful += 1
            
            # Rate limiting - ALWAYS wait between API calls
            delay = API_CALL_DELAY + random.uniform(0, API_CALL_JITTER)
            time.sleep(delay)
        
        # Add daily records to batch (includes marker records for dates with 0 options)
        if daily_records:
            all_records.extend(daily_records)
            total_records += len(daily_records)
        
        # Count actual options records (excluding marker records)
        actual_records = len([r for r in daily_records if not r.get('no_options_data', False)])
        
        # Build skip message
        skip_parts = []
        if daily_skipped_existing > 0:
            skip_parts.append(f"{daily_skipped_existing} existing")
        if daily_skipped_no_options > 0:
            skip_parts.append(f"{daily_skipped_no_options} no-options")
        skip_msg = f", {', '.join(skip_parts)} skipped" if skip_parts else ""
        
        print(f"    ✓ {daily_successful} successful, {daily_failed} failed{skip_msg}, {actual_records} records")
        
        # Save daily batch to parquet (always save if we have any records, including markers)
        if all_records:
            try:
                new_df = pd.DataFrame(all_records)
                if existing_df is not None and not existing_df.empty:
                    combined_df = pd.concat([existing_df, new_df], ignore_index=True)
                else:
                    combined_df = new_df
                
                save_options_data(combined_df, data_type)
                existing_df = combined_df
                
                # Clear batch
                all_records = []
            except Exception as e:
                print(f"    ⚠ Error saving batch: {e}")
    
    # Final save if there are remaining records
    if all_records:
        try:
            new_df = pd.DataFrame(all_records)
            if existing_df is not None and not existing_df.empty:
                combined_df = pd.concat([existing_df, new_df], ignore_index=True)
            else:
                combined_df = new_df
            
            save_options_data(combined_df, data_type)
        except Exception as e:
            print(f"⚠ Error saving final batch: {e}")
    
    print()
    print("="*60)
    print("Summary")
    print("="*60)
    print(f"  Successful: {successful}")
    print(f"  Failed: {failed}")
    print(f"  Skipped (already exists): {skipped_existing}")
    print(f"  Skipped (no options): {skipped_no_options}")
    print(f"  Total records: {total_records}")
    print()
    
    output_path = os.path.join(OPTION_DATA_DIR, data_type, 'options_data.parquet')
    if os.path.exists(output_path):
        print(f"✓ Data saved to: {output_path}")


def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print("Usage: python get_options_data.py [spac|despac] [ticker1 ticker2 ...]")
        print()
        print("Options:")
        print("  spac   - Fetch options data for SPAC tickers")
        print("  despac - Fetch options data for De-SPAC tickers")
        print()
        print("Optional: Provide specific tickers as additional arguments")
        print("  Example: python get_options_data.py spac AAPL TSLA")
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
        print("Usage: python get_options_data.py [spac|despac] [ticker1 ticker2 ...]")
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
    
    fetch_options_data(data_type, api_key, tickers)


if __name__ == '__main__':
    main()

