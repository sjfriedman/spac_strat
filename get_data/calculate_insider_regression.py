"""
Calculate regression statistics for insider transactions and stock price movements.

Analyzes whether insider transactions predict stock price changes 7 business days later.
Calculates correlation, R-squared, and directional accuracy for:
- Per insider (aggregated across all companies)
- Per insider-company pair

Usage:
    python3 get_data/calculate_insider_regression.py spac
    python3 get_data/calculate_insider_regression.py despac
"""

import json
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple
from collections import defaultdict

import pandas as pd
import numpy as np
from scipy import stats


# ========= Constants =========

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Data directories
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
INSIDER_TRANSACTIONS_DIR = os.path.join(DATA_DIR, 'insider_transactions')
STOCK_DATA_DIR = os.path.join(DATA_DIR, 'unadjusted_stock_data')

# Minimum transactions required for statistical significance
MIN_TRANSACTIONS = 3

# Number of business days to look ahead
PREDICTION_WINDOW = 7


# ========= Helper Functions =========

def load_stock_data(data_type: str) -> pd.DataFrame:
    """Load stock price data from CSV"""
    stock_data_path = os.path.join(STOCK_DATA_DIR, data_type, 'stock_data.csv')
    
    if not os.path.exists(stock_data_path):
        raise FileNotFoundError(f"Stock data not found: {stock_data_path}")
    
    df = pd.read_csv(stock_data_path)
    df['date'] = pd.to_datetime(df['date'])
    
    print(f"✓ Loaded stock data: {len(df)} rows, {df['ticker'].nunique()} tickers")
    return df


def load_volume_data(data_type: str) -> pd.DataFrame:
    """Load volume data from CSV"""
    volume_data_path = os.path.join(STOCK_DATA_DIR, data_type, 'stock_volume.csv')
    
    if not os.path.exists(volume_data_path):
        raise FileNotFoundError(f"Volume data not found: {volume_data_path}")
    
    df = pd.read_csv(volume_data_path)
    df['date'] = pd.to_datetime(df['date'])
    
    print(f"✓ Loaded volume data: {len(df)} rows")
    return df


def load_insider_transactions(data_type: str) -> pd.DataFrame:
    """Load insider transactions from CSV"""
    insider_path = os.path.join(INSIDER_TRANSACTIONS_DIR, data_type, 'insider_transactions.csv')
    
    if not os.path.exists(insider_path):
        raise FileNotFoundError(f"Insider transactions not found: {insider_path}")
    
    df = pd.read_csv(insider_path)
    # Parse dates with mixed format to handle both YYYY-MM-DD and ISO8601 formats
    df['date'] = pd.to_datetime(df['date'], format='mixed', errors='coerce')
    
    # Remove rows with invalid dates
    initial_len = len(df)
    df = df.dropna(subset=['date'])
    if len(df) < initial_len:
        print(f"  Warning: Removed {initial_len - len(df)} rows with invalid dates")
    
    print(f"✓ Loaded insider transactions: {len(df)} rows, {df['ticker'].nunique()} tickers")
    return df


def get_business_days_later(start_date: datetime, days: int, available_dates: Set[datetime]) -> Optional[datetime]:
    """
    Get date that is N business days after start_date.
    Uses actual trading days from available_dates.
    """
    current = start_date
    count = 0
    max_iterations = days * 3  # Safety limit (worst case: every other day is a trading day)
    iterations = 0
    
    while count < days and iterations < max_iterations:
        current += timedelta(days=1)
        iterations += 1
        if current in available_dates:
            count += 1
    
    if count < days:
        return None
    
    return current


def calculate_avg_volume(ticker: str, date: datetime, volume_df: pd.DataFrame, window: int = 30) -> float:
    """Calculate average volume over past N days"""
    ticker_data = volume_df[
        (volume_df['ticker'] == ticker) &
        (volume_df['date'] < date) &
        (volume_df['date'] >= date - timedelta(days=window * 2))  # Look back further to get enough trading days
    ].sort_values('date', ascending=False).head(window)
    
    if len(ticker_data) == 0:
        return 0.0
    
    return ticker_data['volume'].mean()


def normalize_transaction_value(value: float, price: float, avg_volume: float) -> float:
    """
    Normalize transaction value by company size proxy (price * avg_volume).
    Returns value relative to typical daily trading activity.
    """
    if avg_volume == 0 or price == 0:
        return 0.0
    
    market_size_proxy = price * avg_volume
    if market_size_proxy == 0:
        return 0.0
    
    return value / market_size_proxy


def calculate_regression_stats(signed_values: List[float], price_changes: List[float]) -> Dict:
    """
    Calculate correlation, R-squared, and directional accuracy.
    
    Args:
        signed_values: Normalized transaction values (positive for Buy, negative for Sell)
        price_changes: Percentage price changes 7 days later
    
    Returns:
        Dict with correlation, r_squared, directional_accuracy, transaction_count
    """
    if len(signed_values) < MIN_TRANSACTIONS:
        return None
    
    # Convert to numpy arrays
    x = np.array(signed_values)
    y = np.array(price_changes)
    
    # Calculate Pearson correlation
    if len(x) < 2 or np.std(x) == 0 or np.std(y) == 0:
        correlation = 0.0
        r_squared = 0.0
    else:
        correlation, p_value = stats.pearsonr(x, y)
        
        # Calculate R-squared using linear regression
        slope, intercept, r_value, _, _ = stats.linregress(x, y)
        r_squared = r_value ** 2
    
    # Calculate directional accuracy
    # Correct prediction: (Buy AND price_up) OR (Sell AND price_down)
    correct_predictions = 0
    for val, change in zip(signed_values, price_changes):
        if (val > 0 and change > 0) or (val < 0 and change < 0):
            correct_predictions += 1
    
    directional_accuracy = (correct_predictions / len(signed_values)) * 100
    
    return {
        'correlation': float(correlation),
        'r_squared': float(r_squared),
        'directional_accuracy': float(directional_accuracy),
        'transaction_count': len(signed_values),
    }


def process_transactions(insider_df: pd.DataFrame, stock_df: pd.DataFrame, volume_df: pd.DataFrame) -> Tuple[Dict, Dict]:
    """
    Process all transactions and calculate regression statistics.
    
    Returns:
        Tuple of (per_insider_stats, per_pair_stats)
    """
    # Create lookup structures for fast access
    stock_lookup = {}
    for ticker in stock_df['ticker'].unique():
        ticker_data = stock_df[stock_df['ticker'] == ticker].set_index('date')
        stock_lookup[ticker] = ticker_data
    
    # Get all available trading dates per ticker
    available_dates_by_ticker = {}
    for ticker in stock_df['ticker'].unique():
        available_dates_by_ticker[ticker] = set(stock_df[stock_df['ticker'] == ticker]['date'])
    
    # Storage for transaction data
    per_insider_data = defaultdict(lambda: {
        'signed_values': [],
        'price_changes': [],
        'companies': set(),
        'total_value': 0.0,
    })
    
    per_pair_data = defaultdict(lambda: {
        'signed_values': [],
        'price_changes': [],
        'insider': '',
        'ticker': '',
        'total_value': 0.0,
    })
    
    # Process each transaction
    total_transactions = len(insider_df)
    processed = 0
    skipped_no_price = 0
    skipped_no_future = 0
    skipped_zero_value = 0
    skipped_no_volume = 0
    
    print(f"\nProcessing {total_transactions} transactions...")
    print("Progress: ", end='', flush=True)
    progress_step = max(1, total_transactions // 50)  # Show 50 progress markers
    
    for idx, row in insider_df.iterrows():
        # Show progress bar
        if idx > 0 and idx % progress_step == 0:
            percentage = (idx / total_transactions) * 100
            bars = int(percentage / 2)  # 50 bars = 100%
            print(f"\rProgress: [{'=' * bars}{' ' * (50 - bars)}] {percentage:.1f}% ({idx}/{total_transactions})", end='', flush=True)
        
        ticker = row['ticker']
        owner_name = row['owner_name']
        transaction_date = row['date']
        transaction_type = row['transaction_type']
        price = row['price']
        value = row['value']
        
        # Skip if no price data for this ticker
        if ticker not in stock_lookup:
            skipped_no_price += 1
            continue
        
        # Skip zero-value transactions
        if value == 0 or price == 0:
            skipped_zero_value += 1
            continue
        
        # Get stock price on transaction date
        ticker_data = stock_lookup[ticker]
        if transaction_date not in ticker_data.index:
            skipped_no_price += 1
            continue
        
        price_t0 = ticker_data.loc[transaction_date, 'close']
        
        # Get stock price 7 business days later
        available_dates = available_dates_by_ticker[ticker]
        future_date = get_business_days_later(transaction_date, PREDICTION_WINDOW, available_dates)
        
        if future_date is None or future_date not in ticker_data.index:
            skipped_no_future += 1
            continue
        
        price_t7 = ticker_data.loc[future_date, 'close']
        
        # Calculate price change percentage
        price_change_pct = ((price_t7 - price_t0) / price_t0) * 100
        
        # Calculate average volume
        avg_volume = calculate_avg_volume(ticker, transaction_date, volume_df)
        if avg_volume == 0:
            skipped_no_volume += 1
            continue
        
        # Normalize transaction value
        normalized_value = normalize_transaction_value(abs(value), price_t0, avg_volume)
        
        # Create signed value (positive for Buy, negative for Sell)
        if transaction_type.lower() == 'buy':
            signed_value = normalized_value
        else:  # Sell
            signed_value = -normalized_value
        
        # Store data for per-insider aggregation
        per_insider_data[owner_name]['signed_values'].append(signed_value)
        per_insider_data[owner_name]['price_changes'].append(price_change_pct)
        per_insider_data[owner_name]['companies'].add(ticker)
        per_insider_data[owner_name]['total_value'] += abs(value)
        
        # Store data for per-pair aggregation
        pair_key = f"{owner_name}|{ticker}"
        per_pair_data[pair_key]['signed_values'].append(signed_value)
        per_pair_data[pair_key]['price_changes'].append(price_change_pct)
        per_pair_data[pair_key]['insider'] = owner_name
        per_pair_data[pair_key]['ticker'] = ticker
        per_pair_data[pair_key]['total_value'] += abs(value)
        
        processed += 1
    
    # Clear progress bar and show completion
    print(f"\rProgress: [{'=' * 50}] 100.0% ({total_transactions}/{total_transactions})")
    print(f"✓ Processed: {processed} transactions")
    print(f"  Skipped (no price data): {skipped_no_price}")
    print(f"  Skipped (no future data): {skipped_no_future}")
    print(f"  Skipped (zero value): {skipped_zero_value}")
    print(f"  Skipped (no volume): {skipped_no_volume}")
    
    # Calculate statistics for per-insider
    print(f"\nCalculating per-insider statistics...")
    per_insider_stats = {}
    
    total_insiders = len(per_insider_data)
    progress_count = 0
    progress_step = max(1, total_insiders // 20)
    
    for insider, data in per_insider_data.items():
        progress_count += 1
        if progress_count % progress_step == 0:
            percentage = (progress_count / total_insiders) * 100
            print(f"  Progress: {progress_count}/{total_insiders} ({percentage:.1f}%)", end='\r', flush=True)
        stats_result = calculate_regression_stats(data['signed_values'], data['price_changes'])
        
        if stats_result is not None:
            per_insider_stats[insider] = {
                **stats_result,
                'total_value': data['total_value'],
                'companies': sorted(list(data['companies'])),
                'avg_normalized_impact': np.mean(np.abs(data['signed_values'])),
            }
    
    print(f"\r✓ Calculated stats for {len(per_insider_stats)} insiders (min {MIN_TRANSACTIONS} transactions)" + " " * 30)
    
    # Calculate statistics for per-pair
    print(f"\nCalculating per-pair statistics...")
    per_pair_stats = {}
    
    total_pairs = len(per_pair_data)
    progress_count = 0
    progress_step = max(1, total_pairs // 20)
    
    for pair_key, data in per_pair_data.items():
        progress_count += 1
        if progress_count % progress_step == 0:
            percentage = (progress_count / total_pairs) * 100
            print(f"  Progress: {progress_count}/{total_pairs} ({percentage:.1f}%)", end='\r', flush=True)
        stats_result = calculate_regression_stats(data['signed_values'], data['price_changes'])
        
        if stats_result is not None:
            per_pair_stats[pair_key] = {
                **stats_result,
                'insider': data['insider'],
                'ticker': data['ticker'],
                'total_value': data['total_value'],
                'avg_normalized_impact': np.mean(np.abs(data['signed_values'])),
            }
    
    print(f"\r✓ Calculated stats for {len(per_pair_stats)} insider-company pairs" + " " * 30)
    
    return per_insider_stats, per_pair_stats


def convert_nan_to_none(obj):
    """Recursively convert NaN, Infinity to None for JSON serialization"""
    if isinstance(obj, dict):
        return {k: convert_nan_to_none(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_nan_to_none(item) for item in obj]
    elif isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    return obj


def save_regression_stats(per_insider: Dict, per_pair: Dict, data_type: str):
    """Save regression statistics to JSON files"""
    output_dir = os.path.join(INSIDER_TRANSACTIONS_DIR, data_type)
    os.makedirs(output_dir, exist_ok=True)
    
    # Convert NaN values to None (null in JSON) to ensure valid JSON
    per_insider_clean = convert_nan_to_none(per_insider)
    per_pair_clean = convert_nan_to_none(per_pair)
    
    # Save per-insider stats
    per_insider_path = os.path.join(output_dir, 'per_insider_regression.json')
    with open(per_insider_path, 'w') as f:
        json.dump({'per_insider': per_insider_clean}, f, indent=2)
    print(f"\n✓ Saved per-insider stats: {per_insider_path}")
    
    # Save per-pair stats
    per_pair_path = os.path.join(output_dir, 'per_pair_regression.json')
    with open(per_pair_path, 'w') as f:
        json.dump({'per_pair': per_pair_clean}, f, indent=2)
    print(f"✓ Saved per-pair stats: {per_pair_path}")
    
    # Print summary statistics
    print("\n" + "="*60)
    print("Summary Statistics")
    print("="*60)
    
    if per_insider:
        accuracies = [s['directional_accuracy'] for s in per_insider.values()]
        # Filter out None values for correlation statistics
        correlations = [s['correlation'] for s in per_insider.values() if s['correlation'] is not None]
        
        print(f"\nPer-Insider Stats ({len(per_insider)} insiders):")
        print(f"  Directional Accuracy:")
        print(f"    Mean: {np.mean(accuracies):.1f}%")
        print(f"    Median: {np.median(accuracies):.1f}%")
        print(f"    Min: {np.min(accuracies):.1f}%")
        print(f"    Max: {np.max(accuracies):.1f}%")
        print(f"  Correlation:")
        if correlations:
            print(f"    Mean: {np.mean(correlations):.3f}")
            print(f"    Median: {np.median(correlations):.3f}")
            print(f"    Valid correlations: {len(correlations)}/{len(per_insider)}")
        else:
            print(f"    No valid correlations found")
        
        # Top 10 by directional accuracy
        top_insiders = sorted(per_insider.items(), key=lambda x: x[1]['directional_accuracy'], reverse=True)[:10]
        print(f"\n  Top 10 Insiders by Directional Accuracy:")
        for insider, stats in top_insiders:
            corr_str = f"{stats['correlation']:.3f}" if stats['correlation'] is not None else "N/A"
            print(f"    {insider[:40]:40} {stats['directional_accuracy']:5.1f}%  (n={stats['transaction_count']}, r={corr_str})")
    
    if per_pair:
        accuracies = [s['directional_accuracy'] for s in per_pair.values()]
        # Filter out None values for correlation statistics
        correlations = [s['correlation'] for s in per_pair.values() if s['correlation'] is not None]
        
        print(f"\nPer-Pair Stats ({len(per_pair)} pairs):")
        print(f"  Directional Accuracy:")
        print(f"    Mean: {np.mean(accuracies):.1f}%")
        print(f"    Median: {np.median(accuracies):.1f}%")
        print(f"  Correlation:")
        if correlations:
            print(f"    Mean: {np.mean(correlations):.3f}")
            print(f"    Median: {np.median(correlations):.3f}")
            print(f"    Valid correlations: {len(correlations)}/{len(per_pair)}")
        else:
            print(f"    No valid correlations found")


def main():
    """Main entry point"""
    if len(sys.argv) != 2:
        print("Usage: python3 calculate_insider_regression.py <spac|despac>")
        sys.exit(1)
    
    data_type = sys.argv[1].lower()
    
    if data_type not in ['spac', 'despac']:
        print("Error: data_type must be 'spac' or 'despac'")
        sys.exit(1)
    
    print("="*60)
    print(f"Calculating Insider Transaction Regression Statistics")
    print(f"Data Type: {data_type}")
    print("="*60)
    
    try:
        # Load data
        stock_df = load_stock_data(data_type)
        volume_df = load_volume_data(data_type)
        insider_df = load_insider_transactions(data_type)
        
        # Process transactions and calculate statistics
        per_insider_stats, per_pair_stats = process_transactions(insider_df, stock_df, volume_df)
        
        # Save results
        save_regression_stats(per_insider_stats, per_pair_stats, data_type)
        
        print("\n✅ Done!")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

