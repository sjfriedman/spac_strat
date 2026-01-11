"""
Organize unadjusted stock data into stock_data.csv format
Reads unadjusted data from data/unadjusted_stock_data/ and outputs to data/stock_data/
Filters to only include dates after IPO (SPAC) or closing date (De-SPAC)
"""

import json
import os
import sys
from datetime import datetime
from typing import Dict, List, Optional

import pandas as pd


# ========= Constants =========

# Get project root directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Data directories
UNADJUSTED_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'unadjusted_stock_data')
STOCK_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'stock_data')
OUTPUT_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'unadjusted_stock_data')


# ========= Helpers =========

def load_reference_dates(data_type: str) -> Dict[str, str]:
    """
    Load reference dates (IPO date for SPAC, closing date for De-SPAC)
    Returns dict: {ticker: date_string}
    """
    dates_path = os.path.join(STOCK_DATA_DIR, data_type, 'dates.json')
    
    if not os.path.exists(dates_path):
        raise FileNotFoundError(f"Dates file not found: {dates_path}")
    
    with open(dates_path, 'r') as f:
        data = json.load(f)
    
    return data.get('ticker_to_date', {})


def clean_ticker_data(ticker: str, data_type: str, reference_date: str) -> Optional[pd.DataFrame]:
    """
    Load unadjusted ticker data and filter to only include dates on or after reference_date
    Returns cleaned DataFrame or None if no data
    """
    # Handle different directory structures: despac has ticker_level subdirectory, spac doesn't
    if data_type == 'despac':
        raw_file = os.path.join(UNADJUSTED_DATA_DIR, data_type, 'ticker_level', f'{ticker}.csv')
    else:
        raw_file = os.path.join(UNADJUSTED_DATA_DIR, data_type, f'{ticker}.csv')
    
    if not os.path.exists(raw_file):
        return None
    
    try:
        df = pd.read_csv(raw_file)
        df['date'] = pd.to_datetime(df['date'])
        
        # Parse reference date
        ref_date = pd.to_datetime(reference_date)
        
        # Filter to dates >= reference_date
        df_filtered = df[df['date'] >= ref_date].copy()
        
        if df_filtered.empty:
            return None
        
        return df_filtered
        
    except Exception as e:
        print(f"  ✗ Error processing {ticker}: {e}")
        return None


def combine_and_save_data(data_type: str, ticker_to_date: Dict[str, str]):
    """
    Combine all cleaned ticker data into stock_data.csv and stock_volume.csv
    Uses non-adjusted close prices from unadjusted_stock_data
    """
    # Handle different directory structures
    if data_type == 'despac':
        raw_dir = os.path.join(UNADJUSTED_DATA_DIR, data_type, 'ticker_level')
    else:
        raw_dir = os.path.join(UNADJUSTED_DATA_DIR, data_type)
    
    output_dir = os.path.join(OUTPUT_DATA_DIR, data_type)
    
    if not os.path.exists(raw_dir):
        print(f"❌ Error: Unadjusted data directory not found: {raw_dir}")
        print("   Run unadjusted_close.py first to fetch data")
        return
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Collect all data
    all_price_data = []
    all_volume_data = []
    
    processed = 0
    skipped = 0
    failed = 0
    
    print(f"Processing tickers from {raw_dir}...")
    print()
    
    for ticker, reference_date in ticker_to_date.items():
        print(f"  Processing {ticker} (reference date: {reference_date})...", end=' ', flush=True)
        
        df = clean_ticker_data(ticker, data_type, reference_date)
        
        if df is None or df.empty:
            print("⏭ No data after reference date")
            skipped += 1
            continue
        
        # Add to price data (using non-adjusted close)
        for _, row in df.iterrows():
            all_price_data.append({
                'date': row['date'].strftime('%Y-%m-%d'),
                'ticker': ticker,
                'close': row['close'],
            })
            
            all_volume_data.append({
                'date': row['date'].strftime('%Y-%m-%d'),
                'ticker': ticker,
                'volume': row['volume'],
            })
        
        processed += 1
        print(f"✓ {len(df)} days")
    
    print()
    print("="*60)
    print("Summary")
    print("="*60)
    print(f"  Processed: {processed}")
    print(f"  Skipped (no data): {skipped}")
    print(f"  Failed: {failed}")
    print()
    
    if not all_price_data:
        print("❌ No data to save")
        return
    
    # Create DataFrames
    price_df = pd.DataFrame(all_price_data)
    volume_df = pd.DataFrame(all_volume_data)
    
    # Sort by date and ticker
    price_df = price_df.sort_values(['date', 'ticker'])
    volume_df = volume_df.sort_values(['date', 'ticker'])
    
    # Save CSV files
    price_csv = os.path.join(output_dir, 'stock_data.csv')
    volume_csv = os.path.join(output_dir, 'stock_volume.csv')
    
    price_df.to_csv(price_csv, index=False)
    volume_df.to_csv(volume_csv, index=False)
    
    print(f"✓ Saved price data: {price_csv}")
    print(f"  Rows: {len(price_df)}")
    print(f"  Date range: {price_df['date'].min()} to {price_df['date'].max()}")
    print()
    print(f"✓ Saved volume data: {volume_csv}")
    print(f"  Rows: {len(volume_df)}")
    print()
    print(f"✓ Data saved to: {output_dir}")


def main():
    """Main entry point - processes both spac and despac"""
    if len(sys.argv) > 1:
        # Allow optional argument to process only one type
        data_type = sys.argv[1].lower()
        if data_type not in ['spac', 'despac']:
            print(f"Error: Unknown data type '{data_type}'")
            print("Usage: python organize_data.py [spac|despac]")
            print("  (no arguments = process both spac and despac)")
            sys.exit(1)
        data_types = [data_type]
    else:
        # Process both by default
        data_types = ['spac', 'despac']
    
    print("="*60)
    print("Organizing Unadjusted Stock Data")
    print("="*60)
    print()
    
    # Process each data type
    for data_type in data_types:
        print()
        print("="*60)
        print(f"Processing {data_type.upper()}")
        print("="*60)
        print()
        
        # Load reference dates
        try:
            ticker_to_date = load_reference_dates(data_type)
            print(f"Loaded {len(ticker_to_date)} reference dates for {data_type}")
            print()
        except Exception as e:
            print(f"❌ Error loading reference dates for {data_type}: {e}")
            print(f"  Skipping {data_type}...")
            print()
            continue
        
        # Organize and combine data
        combine_and_save_data(data_type, ticker_to_date)
        print()
    
    print("="*60)
    print("All processing complete!")
    print("="*60)


if __name__ == '__main__':
    main()

