"""
Clean and filter stock data to only include dates after IPO (SPAC) or closing date (De-SPAC)
Reads raw data from data/raw_stock_data/ and outputs cleaned data to data/stock_data/
Also supports cleaning news data by filtering articles by date
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
RAW_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'raw_stock_data')
STOCK_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'stock_data')


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
    Load raw ticker data and filter to only include dates on or after reference_date
    Returns cleaned DataFrame or None if no data
    """
    raw_file = os.path.join(RAW_DATA_DIR, data_type, f'{ticker}.csv')
    
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


def clean_ticker_news(ticker: str, data_type: str, reference_date: str) -> Optional[Dict]:
    """
    Load raw ticker news data and filter to only include articles on or after reference_date
    Returns cleaned news data dict or None if no data
    """
    raw_file = os.path.join(RAW_DATA_DIR, data_type, 'news', f'{ticker}.json')
    
    if not os.path.exists(raw_file):
        return None
    
    try:
        with open(raw_file, 'r') as f:
            news_data = json.load(f)
        
        # Check if feed exists
        if 'feed' not in news_data:
            return None
        
        feed = news_data.get('feed', [])
        if not feed:
            # Empty feed is valid, return the data as-is
            return news_data
        
        # Parse reference date
        ref_date = datetime.strptime(reference_date, '%Y-%m-%d')
        
        # Filter articles where time_published >= reference_date
        # time_published format: YYYYMMDDTHHMMSS
        filtered_feed = []
        for article in feed:
            time_published = article.get('time_published', '')
            if not time_published:
                continue
            
            # Parse time_published (format: YYYYMMDDTHHMMSS)
            try:
                # Extract date portion (YYYYMMDD)
                date_str = time_published[:8]
                article_date = datetime.strptime(date_str, '%Y%m%d')
                
                # Keep if article date >= reference date
                if article_date >= ref_date:
                    filtered_feed.append(article)
            except (ValueError, IndexError) as e:
                # Skip articles with invalid date format
                continue
        
        # Create filtered news data
        filtered_data = {
            **news_data,
            'feed': filtered_feed
        }
        
        # Preserve other fields
        if 'items' in news_data:
            filtered_data['items'] = str(len(filtered_feed))
        
        return filtered_data
        
    except Exception as e:
        print(f"  ✗ Error processing {ticker}: {e}")
        return None


def combine_and_save_data(data_type: str, ticker_to_date: Dict[str, str], data_mode: str = 'stock'):
    """
    Combine all cleaned ticker data into stock_data.csv and stock_volume.csv (for stock mode)
    Or filter and save news data to individual JSON files (for news mode)
    """
    if data_mode == 'news':
        print("="*60)
        print(f"Cleaning News Data - {data_type.upper()}")
        print("="*60)
        print()
        
        raw_news_dir = os.path.join(RAW_DATA_DIR, data_type, 'news')
        output_news_dir = os.path.join(STOCK_DATA_DIR, data_type, 'news')
        
        if not os.path.exists(raw_news_dir):
            print(f"❌ Error: Raw news directory not found: {raw_news_dir}")
            print("   Run news_sentiment.py first to fetch news data")
            sys.exit(1)
        
        os.makedirs(output_news_dir, exist_ok=True)
        
        processed = 0
        skipped = 0
        failed = 0
        no_articles = 0
        
        print(f"Processing news from {raw_news_dir}...")
        print()
        
        for ticker, reference_date in ticker_to_date.items():
            print(f"  Processing {ticker} (reference date: {reference_date})...", end=' ', flush=True)
            
            filtered_news = clean_ticker_news(ticker, data_type, reference_date)
            
            if filtered_news is None:
                print("⏭ No news file found")
                skipped += 1
                continue
            
            feed = filtered_news.get('feed', [])
            if not feed or len(feed) == 0:
                print("⏭ No articles after reference date")
                no_articles += 1
                # Still save empty feed for consistency
                output_file = os.path.join(output_news_dir, f'{ticker}.json')
                with open(output_file, 'w') as f:
                    json.dump(filtered_news, f, indent=2)
                continue
            
            # Save filtered news
            try:
                output_file = os.path.join(output_news_dir, f'{ticker}.json')
                with open(output_file, 'w') as f:
                    json.dump(filtered_news, f, indent=2)
                processed += 1
                print(f"✓ {len(feed)} articles")
            except Exception as e:
                print(f"✗ Error saving: {e}")
                failed += 1
        
        print()
        print("="*60)
        print("Summary")
        print("="*60)
        print(f"  Processed: {processed}")
        print(f"  No articles: {no_articles}")
        print(f"  Skipped (no file): {skipped}")
        print(f"  Failed: {failed}")
        print()
        print(f"✓ News data saved to: {output_news_dir}")
        return
    
    # Original stock data cleaning logic
    print("="*60)
    print(f"Cleaning Stock Data - {data_type.upper()}")
    print("="*60)
    print()
    
    raw_dir = os.path.join(RAW_DATA_DIR, data_type)
    output_dir = os.path.join(STOCK_DATA_DIR, data_type)
    
    if not os.path.exists(raw_dir):
        print(f"❌ Error: Raw data directory not found: {raw_dir}")
        print("   Run adjusted_close.py first to fetch data")
        sys.exit(1)
    
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
        
        # Add to price data (using adjusted_close)
        for _, row in df.iterrows():
            all_price_data.append({
                'date': row['date'].strftime('%Y-%m-%d'),
                'ticker': ticker,
                'close': row['adjusted_close'],
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
    """Main entry point"""
    if len(sys.argv) < 2:
        print("Usage: python clean_data.py [spac|despac] [stock|news]")
        print()
        print("Options:")
        print("  spac   - Clean SPAC data (filter to dates >= IPO date)")
        print("  despac - Clean De-SPAC data (filter to dates >= closing date)")
        print()
        print("Data mode (optional, defaults to 'stock'):")
        print("  stock  - Clean stock data (CSV files)")
        print("  news   - Clean news data (JSON files)")
        print()
        print("For stock mode:")
        print("  1. Reads raw data from data/raw_stock_data/{spac|despac}/")
        print("  2. Filters to only include dates on/after reference date")
        print("  3. Combines all tickers into stock_data.csv and stock_volume.csv")
        print("  4. Saves to data/stock_data/{spac|despac}/")
        print()
        print("For news mode:")
        print("  1. Reads raw news from data/raw_stock_data/{spac|despac}/news/")
        print("  2. Filters articles to only include dates on/after reference date")
        print("  3. Saves filtered news to data/stock_data/{spac|despac}/news/{TICKER}.json")
        sys.exit(1)
    
    data_type = sys.argv[1].lower()
    
    if data_type not in ['spac', 'despac']:
        print(f"Error: Unknown data type '{data_type}'")
        print("Usage: python clean_data.py [spac|despac] [stock|news]")
        sys.exit(1)
    
    # Get data mode (stock or news), default to stock for backward compatibility
    data_mode = sys.argv[2].lower() if len(sys.argv) > 2 else 'stock'
    
    if data_mode not in ['stock', 'news']:
        print(f"Error: Unknown data mode '{data_mode}'")
        print("Usage: python clean_data.py [spac|despac] [stock|news]")
        sys.exit(1)
    
    # Load reference dates
    try:
        ticker_to_date = load_reference_dates(data_type)
        print(f"Loaded {len(ticker_to_date)} reference dates")
    except Exception as e:
        print(f"❌ Error loading reference dates: {e}")
        sys.exit(1)
    
    # Clean and combine data
    combine_and_save_data(data_type, ticker_to_date, data_mode)


if __name__ == '__main__':
    main()

