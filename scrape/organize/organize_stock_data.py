"""
Script to organize stock data from stock_data.json
Creates:
1. ipo_dates.json - bidirectional dictionary mapping ticker <-> min date
2. stock_data.csv - concatenated close price data from all stocks
3. stock_volume.csv - concatenated volume data from all stocks
"""

import json
import os
from datetime import datetime
from typing import Dict, List
from collections import defaultdict

import pandas as pd


# Constants
# Get project root directory (go up from scrape/organize/ to project root)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Script is in scrape/organize/, so go up 2 levels to get project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
STOCK_DATA_FILE = os.path.join(PROJECT_ROOT, 'data', 'stock_data', 'stock_data.json')
IPO_DATES_FILE = os.path.join(PROJECT_ROOT, 'data', 'stock_data', 'ipo_dates.json')
STOCK_DATA_CSV = os.path.join(PROJECT_ROOT, 'data', 'stock_data', 'stock_data.csv')
STOCK_VOLUME_CSV = os.path.join(PROJECT_ROOT, 'data', 'stock_data', 'stock_volume.csv')


def load_stock_data() -> Dict:
    """Load stock data from JSON file"""
    if not os.path.exists(STOCK_DATA_FILE):
        raise FileNotFoundError(f"Stock data file not found: {STOCK_DATA_FILE}")
    
    with open(STOCK_DATA_FILE, 'r') as f:
        return json.load(f)


def create_ipo_dates_dict(stock_data: Dict) -> Dict:
    """
    Create bidirectional dictionary mapping ticker <-> min date
    Returns: {
        'ticker_to_date': {ticker: min_date, ...},
        'date_to_tickers': {min_date: [ticker1, ticker2, ...], ...}
    }
    """
    ticker_to_date = {}
    date_to_tickers = defaultdict(list)
    
    # Iterate through all date entries in stock_data
    for start_date, entry in stock_data.items():
        ticker_data = entry.get('data', {})
        
        # For each ticker, find the minimum date in its stock data
        for ticker, dates_dict in ticker_data.items():
            if not dates_dict:
                continue
            
            # Find the minimum date (earliest date) for this ticker
            date_strings = list(dates_dict.keys())
            if date_strings:
                min_date = min(date_strings)
                
                # Store ticker -> min_date mapping
                ticker_to_date[ticker] = min_date
                
                # Store date -> tickers mapping (bidirectional)
                date_to_tickers[min_date].append(ticker)
    
    # Convert defaultdict to regular dict and sort ticker lists
    date_to_tickers = {k: sorted(v) for k, v in sorted(date_to_tickers.items())}
    
    return {
        'ticker_to_date': ticker_to_date,
        'date_to_tickers': date_to_tickers
    }


def create_stock_data_csv(stock_data: Dict) -> pd.DataFrame:
    """
    Create CSV with concatenated close price data from all stocks
    Returns DataFrame with columns: date, ticker, close
    """
    all_rows = []
    
    # Iterate through all date entries in stock_data
    for start_date, entry in stock_data.items():
        ticker_data = entry.get('data', {})
        
        # For each ticker, extract close prices
        for ticker, dates_dict in ticker_data.items():
            for date_str, price_data in dates_dict.items():
                close_price = price_data.get('Close')
                if close_price is not None:
                    all_rows.append({
                        'date': date_str,
                        'ticker': ticker,
                        'close': close_price
                    })
    
    # Create DataFrame
    df = pd.DataFrame(all_rows)
    
    if df.empty:
        return df
    
    # Convert date to datetime and sort
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values(['date', 'ticker'])
    df = df.reset_index(drop=True)
    
    return df


def create_stock_volume_csv(stock_data: Dict) -> pd.DataFrame:
    """
    Create CSV with concatenated volume data from all stocks
    Returns DataFrame with columns: date, ticker, volume
    """
    all_rows = []
    
    # Iterate through all date entries in stock_data
    for start_date, entry in stock_data.items():
        ticker_data = entry.get('data', {})
        
        # For each ticker, extract volume
        for ticker, dates_dict in ticker_data.items():
            for date_str, price_data in dates_dict.items():
                volume = price_data.get('Volume')
                if volume is not None:
                    all_rows.append({
                        'date': date_str,
                        'ticker': ticker,
                        'volume': volume
                    })
    
    # Create DataFrame
    df = pd.DataFrame(all_rows)
    
    if df.empty:
        return df
    
    # Convert date to datetime and sort
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values(['date', 'ticker'])
    df = df.reset_index(drop=True)
    
    return df


def main():
    """Main entry point"""
    print("="*60)
    print("Organizing Stock Data")
    print("="*60)
    
    # Load stock data
    print(f"\nLoading stock data from: {STOCK_DATA_FILE}")
    stock_data = load_stock_data()
    
    if not stock_data:
        print("No stock data found to organize.")
        return
    
    # Create IPO dates dictionary
    print("\nCreating IPO dates dictionary...")
    ipo_dates = create_ipo_dates_dict(stock_data)
    
    # Save IPO dates JSON
    print(f"Saving IPO dates to: {IPO_DATES_FILE}")
    os.makedirs(os.path.dirname(IPO_DATES_FILE), exist_ok=True)
    with open(IPO_DATES_FILE, 'w') as f:
        json.dump(ipo_dates, f, indent=2)
    
    print(f"  Tickers mapped: {len(ipo_dates['ticker_to_date'])}")
    print(f"  Unique IPO dates: {len(ipo_dates['date_to_tickers'])}")
    
    # Create stock data CSV
    print("\nCreating stock data CSV...")
    df = create_stock_data_csv(stock_data)
    
    if df.empty:
        print("No stock data to save to CSV.")
    else:
        print(f"Saving stock data CSV to: {STOCK_DATA_CSV}")
        os.makedirs(os.path.dirname(STOCK_DATA_CSV), exist_ok=True)
        df.to_csv(STOCK_DATA_CSV, index=False)
        
        print(f"  Total rows: {len(df)}")
        print(f"  Date range: {df['date'].min()} to {df['date'].max()}")
        print(f"  Unique tickers: {df['ticker'].nunique()}")
    
    # Create stock volume CSV
    print("\nCreating stock volume CSV...")
    volume_df = create_stock_volume_csv(stock_data)
    
    if volume_df.empty:
        print("No volume data to save to CSV.")
    else:
        print(f"Saving stock volume CSV to: {STOCK_VOLUME_CSV}")
        os.makedirs(os.path.dirname(STOCK_VOLUME_CSV), exist_ok=True)
        volume_df.to_csv(STOCK_VOLUME_CSV, index=False)
        
        print(f"  Total rows: {len(volume_df)}")
        print(f"  Date range: {volume_df['date'].min()} to {volume_df['date'].max()}")
        print(f"  Unique tickers: {volume_df['ticker'].nunique()}")
    
    print("\n" + "="*60)
    print("Organization complete!")
    print("="*60)
    
    # Print sample of IPO dates
    print("\nSample IPO dates (first 10):")
    for i, (ticker, date) in enumerate(list(ipo_dates['ticker_to_date'].items())[:10]):
        print(f"  {ticker} -> {date}")
    if len(ipo_dates['ticker_to_date']) > 10:
        print(f"  ... and {len(ipo_dates['ticker_to_date']) - 10} more")


if __name__ == '__main__':
    main()

