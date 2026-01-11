"""
Organize insider transactions data into combined CSV format
Reads JSON files from data/raw_stock_data/{spac|despac}/insider_transactions/
Outputs to data/insider_transactions/{spac|despac}/insider_transactions.csv
"""

import json
import os
import sys
from datetime import datetime
from typing import Dict, List, Optional, Any
import glob

import pandas as pd


# ========= Constants =========

# Get project root directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Data directories
RAW_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'raw_stock_data')
OUTPUT_DATA_DIR = os.path.join(PROJECT_ROOT, 'data', 'insider_transactions')


# ========= Helpers =========

def parse_insider_transaction(transaction: Dict[str, Any], ticker: str) -> Optional[Dict[str, Any]]:
    """
    Parse a single insider transaction record into standardized format
    Handles Alpha Vantage API response structure
    """
    try:
        # Try to extract date - various possible field names
        date = None
        for date_field in ['transaction_date', 'transactionDate', 'date', 'filing_date', 'filingDate']:
            if date_field in transaction:
                date = transaction[date_field]
                break
        
        if not date:
            return None
        
        # Parse date to standard format and validate
        try:
            if isinstance(date, str):
                # Try to parse various date formats
                for fmt in ['%Y-%m-%d', '%Y%m%d', '%m/%d/%Y']:
                    try:
                        parsed_date = datetime.strptime(date, fmt)
                        
                        # Validate year is reasonable (filter out bad dates like 0023-03-23 or 2002 when it should be 2022)
                        if parsed_date.year < 2000 or parsed_date.year > 2030:
                            return None
                        
                        date = parsed_date.strftime('%Y-%m-%d')
                        break
                    except ValueError:
                        continue
        except:
            return None
        
        # Extract owner name and position from Alpha Vantage fields
        owner_name = transaction.get('executive') or transaction.get('owner_name') or transaction.get('name') or 'Unknown'
        position = transaction.get('executive_title') or transaction.get('position') or transaction.get('title') or ''
        
        # Map acquisition_or_disposal code to transaction type
        # A = Acquisition (Buy), D = Disposal (Sell)
        acquisition_or_disposal = transaction.get('acquisition_or_disposal', '')
        if acquisition_or_disposal == 'A':
            transaction_type = 'Buy'
        elif acquisition_or_disposal == 'D':
            transaction_type = 'Sell'
        else:
            # Fallback to other possible field names
            transaction_type = transaction.get('transaction_type') or transaction.get('transactionType') or transaction.get('type') or 'Unknown'
        
        # Extract security type (useful to distinguish stocks from options/warrants)
        security_type = transaction.get('security_type') or transaction.get('securityType') or 'Common Stock'
        
        # Shares - handle various numeric formats
        shares = 0
        for shares_field in ['shares', 'shares_traded', 'sharesTraded', 'quantity', 'amount']:
            if shares_field in transaction:
                try:
                    shares = float(transaction[shares_field])
                    break
                except (ValueError, TypeError):
                    pass
        
        # Price - handle empty strings and missing values
        price = 0.0
        for price_field in ['share_price', 'price', 'price_per_share', 'pricePerShare', 'sharePrice']:
            if price_field in transaction:
                try:
                    price_val = transaction[price_field]
                    # Check for empty string or None
                    if price_val and price_val != '':
                        price = float(price_val)
                        break
                except (ValueError, TypeError):
                    pass
        
        # Calculate value if not provided
        value = 0.0
        for value_field in ['value', 'transaction_value', 'transactionValue', 'total']:
            if value_field in transaction:
                try:
                    value = float(transaction[value_field])
                    break
                except (ValueError, TypeError):
                    pass
        
        if value == 0.0 and shares and price:
            value = shares * price
        
        return {
            'date': date,
            'ticker': ticker,
            'owner_name': owner_name,
            'position': position,
            'transaction_type': transaction_type,
            'security_type': security_type,
            'shares': shares,
            'price': price,
            'value': value
        }
    
    except Exception as e:
        print(f"    ⚠ Error parsing transaction: {e}")
        return None


def load_and_parse_ticker_data(json_file: str) -> List[Dict[str, Any]]:
    """
    Load insider transactions JSON file for a single ticker and parse all transactions
    """
    try:
        with open(json_file, 'r') as f:
            data = json.load(f)
        
        ticker = data.get('ticker', '')
        insider_data = data.get('insider_transactions', {})
        
        # Extract transactions list - handle various possible structures
        transactions = []
        
        # Try different possible structures
        if isinstance(insider_data, list):
            # Direct list of transactions
            transactions = insider_data
        elif isinstance(insider_data, dict):
            # Look for common transaction list keys
            for key in ['data', 'transactions', 'insider_transactions', 'trades']:
                if key in insider_data and isinstance(insider_data[key], list):
                    transactions = insider_data[key]
                    break
            
            # If still empty, check all keys for list values
            if not transactions:
                for key, value in insider_data.items():
                    if isinstance(value, list) and value:
                        transactions = value
                        break
        
        # Parse each transaction
        parsed_transactions = []
        for transaction in transactions:
            if isinstance(transaction, dict):
                parsed = parse_insider_transaction(transaction, ticker)
                if parsed:
                    parsed_transactions.append(parsed)
        
        return parsed_transactions
    
    except Exception as e:
        print(f"  ✗ Error loading {json_file}: {e}")
        return []


def organize_data(data_type: str):
    """
    Organize insider transactions data for a given data type (spac or despac)
    """
    print(f"Organizing insider transactions data for {data_type.upper()}...")
    print()
    
    # Input and output directories
    input_dir = os.path.join(RAW_DATA_DIR, data_type, 'insider_transactions')
    output_dir = os.path.join(OUTPUT_DATA_DIR, data_type)
    
    if not os.path.exists(input_dir):
        print(f"❌ Error: Input directory not found: {input_dir}")
        print("   Run get_insider_transactions.py first to fetch data")
        return
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Find all JSON files
    json_files = glob.glob(os.path.join(input_dir, '*.json'))
    
    if not json_files:
        print(f"❌ No JSON files found in {input_dir}")
        return
    
    print(f"Found {len(json_files)} JSON files to process")
    print()
    
    # Collect all transactions
    all_transactions = []
    processed = 0
    skipped = 0
    
    for json_file in json_files:
        ticker = os.path.basename(json_file).replace('.json', '')
        print(f"  Processing {ticker}...", end=' ', flush=True)
        
        transactions = load_and_parse_ticker_data(json_file)
        
        if transactions:
            all_transactions.extend(transactions)
            processed += 1
            print(f"✓ {len(transactions)} transactions")
        else:
            skipped += 1
            print("⏭ No transactions")
    
    print()
    print("="*60)
    print("Summary")
    print("="*60)
    print(f"  Files processed: {processed}")
    print(f"  Files skipped (no data): {skipped}")
    print(f"  Total transactions: {len(all_transactions)}")
    print()
    
    if not all_transactions:
        print("❌ No transactions to save")
        return
    
    # Create DataFrame
    df = pd.DataFrame(all_transactions)
    
    # Sort by date and ticker
    df = df.sort_values(['date', 'ticker'])
    
    # Reorder columns
    columns_order = ['date', 'ticker', 'owner_name', 'position', 'transaction_type', 
                     'security_type', 'shares', 'price', 'value']
    df = df[columns_order]
    
    # Save CSV
    csv_path = os.path.join(output_dir, 'insider_transactions.csv')
    df.to_csv(csv_path, index=False)
    
    print(f"✓ Saved insider transactions: {csv_path}")
    print(f"  Rows: {len(df)}")
    print(f"  Date range: {df['date'].min()} to {df['date'].max()}")
    print(f"  Unique tickers: {df['ticker'].nunique()}")
    print(f"  Unique insiders: {df['owner_name'].nunique()}")
    print()


def main():
    """Main entry point - processes both spac and despac"""
    if len(sys.argv) > 1:
        # Allow optional argument to process only one type
        data_type = sys.argv[1].lower()
        if data_type not in ['spac', 'despac']:
            print(f"Error: Unknown data type '{data_type}'")
            print("Usage: python organize_insider_transactions.py [spac|despac]")
            print("  (no arguments = process both spac and despac)")
            sys.exit(1)
        data_types = [data_type]
    else:
        # Process both by default
        data_types = ['spac', 'despac']
    
    print("="*60)
    print("Organizing Insider Transactions Data")
    print("="*60)
    print()
    
    # Process each data type
    for data_type in data_types:
        print()
        print("="*60)
        print(f"Processing {data_type.upper()}")
        print("="*60)
        print()
        
        organize_data(data_type)
        print()
    
    print("="*60)
    print("All processing complete!")
    print("="*60)


if __name__ == '__main__':
    main()

