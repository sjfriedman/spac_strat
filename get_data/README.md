# Get Data - Alpha Vantage Stock Data Fetcher

This folder contains scripts to fetch and clean stock data using the Alpha Vantage API.

## Setup

1. Set your Alpha Vantage API key in one of these ways:

   **Option 1: .env file (recommended)**
   ```bash
   # Create .env file in project root
   echo "ALPHAVANTAGE_KEY=your_premium_key_here" > .env
   ```

   **Option 2: Environment variable**
   ```bash
   export ALPHAVANTAGE_KEY='your_premium_key_here'
   # Or: export ALPHA_VANTAGE_API_KEY='your_premium_key_here'
   ```

2. Install dependencies:
   ```bash
   pip install -r ../requirements.txt
   ```

## Scripts

### `adjusted_close.py`

Fetches TIME_SERIES_DAILY_ADJUSTED data from Alpha Vantage for all tickers.

**Usage:**
```bash
# Fetch all SPAC tickers
python adjusted_close.py spac

# Fetch all De-SPAC tickers
python adjusted_close.py despac

# Fetch specific tickers only
python adjusted_close.py spac AAPL TSLA
```

**Features:**
- Fetches all available historical data for each ticker
- Handles API rate limiting (12 second delay between calls)
- Skips tickers that already have data files
- Saves individual CSV files per ticker to `data/raw_stock_data/{spac|despac}/`

**Output:**
- Individual CSV files: `data/raw_stock_data/{spac|despac}/{TICKER}.csv`
- Each file contains: date, ticker, open, high, low, close, adjusted_close, volume, dividend, split_coefficient

### `news_sentiment.py`

Fetches NEWS_SENTIMENT data from Alpha Vantage for all tickers.

**Usage:**
```bash
# Fetch news for all SPAC tickers (from IPO date to present)
python news_sentiment.py spac

# Fetch news for all De-SPAC tickers (from closing date to present)
python news_sentiment.py despac

# Fetch news for specific tickers only
python news_sentiment.py spac AAPL TSLA
```

**Features:**
- Fetches news articles and sentiment analysis for each ticker
- Date range: from IPO date (SPAC) or closing date (De-SPAC) to present
- Handles API rate limiting (1 second delay between calls)
- Skips tickers that already have news files
- Handles tickers with no news gracefully (saves empty response)
- Saves individual JSON files per ticker to `data/raw_stock_data/{spac|despac}/news/`

**Output:**
- Individual JSON files: `data/raw_stock_data/{spac|despac}/news/{TICKER}.json`
- Each file contains the full Alpha Vantage API response with:
  - `feed`: Array of news articles with title, url, summary, sentiment scores, etc.
  - `items`: Number of articles returned
  - `sentiment_score_definition`: Definition of sentiment scores
  - `relevance_score_definition`: Definition of relevance scores

### `clean_data.py`

Filters raw stock data or news data to only include dates on or after the reference date (IPO date for SPAC, closing date for De-SPAC).

**Usage:**
```bash
# Clean SPAC stock data (filter to dates >= IPO date)
python clean_data.py spac stock

# Clean De-SPAC stock data (filter to dates >= closing date)
python clean_data.py despac stock

# Clean SPAC news data (filter articles to dates >= IPO date)
python clean_data.py spac news

# Clean De-SPAC news data (filter articles to dates >= closing date)
python clean_data.py despac news

# Note: 'stock' is the default mode if not specified
python clean_data.py spac  # Same as 'python clean_data.py spac stock'
```

**Features:**
- **Stock mode** (default):
  - Reads raw data from `data/raw_stock_data/{spac|despac}/`
  - Filters each ticker to dates >= reference date
  - Combines all tickers into two CSV files:
    - `stock_data.csv` - price data (using adjusted_close)
    - `stock_volume.csv` - volume data
  - Saves to `data/stock_data/{spac|despac}/`

- **News mode**:
  - Reads raw news from `data/raw_stock_data/{spac|despac}/news/`
  - Filters articles where `time_published` >= reference date
  - Preserves all article fields (title, url, sentiment, topics, etc.)
  - Saves filtered news to `data/stock_data/{spac|despac}/news/{TICKER}.json`

**Output:**
- **Stock mode:**
  - `data/stock_data/{spac|despac}/stock_data.csv` - date, ticker, close
  - `data/stock_data/{spac|despac}/stock_volume.csv` - date, ticker, volume
- **News mode:**
  - `data/stock_data/{spac|despac}/news/{TICKER}.json` - Filtered news articles per ticker

## Workflow

### Stock Data Workflow

1. **Fetch raw stock data:**
   ```bash
   python adjusted_close.py spac
   ```
   This will take time (1 second per ticker for premium tier). The script will skip tickers that already have data.

2. **Clean and combine stock data:**
   ```bash
   python clean_data.py spac stock
   ```
   This filters and combines all ticker data into the final CSV files.

### News Data Workflow

1. **Fetch raw news data:**
   ```bash
   python news_sentiment.py spac
   ```
   This will take time (1 second per ticker for premium tier). The script will skip tickers that already have news files.

2. **Clean news data:**
   ```bash
   python clean_data.py spac news
   ```
   This filters news articles to only include those on or after the reference date.

## Notes

- **Rate Limiting:** All scripts use a 0.85-second delay between calls (about 70 calls/minute) with small random jitter to satisfy both Alpha Vantage limits:
  - Maximum 5 requests per second
  - Maximum 75 requests per minute (premium tier)
- The scripts automatically add small random delays (jitter) to spread requests evenly across time and avoid burst patterns.
- **Important:** The delay is ALWAYS applied after each API call, even when no data is returned (e.g., empty news feed), to ensure rate limits are respected.
- All scripts automatically skip tickers that already have data files, so you can safely re-run them.
- Raw data is saved per-ticker for easy inspection and debugging.
- **News Data:** Some tickers may have no news articles. The script will save an empty `feed` array for these tickers to maintain consistency.

