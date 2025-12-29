// Utility to load and cache news & sentiment data

import { NewsData, NewsEvent, NewsArticle } from '../types';
import { DataType } from './dataLoader';

const NEWS_CACHE_KEY = 'spac_strat_news_cache';
const NEWS_CACHE_VERSION = '1.0.0';

// Map of ticker -> news data for that ticker
let newsCache: Map<string, NewsData> | null = null;
let cacheDataType: DataType | null = null;

/**
 * Extract date from time_published format (YYYYMMDDTHHMMSS) to YYYY-MM-DD
 */
function extractDate(timePublished: string): string {
  if (!timePublished || timePublished.length < 8) {
    return '';
  }
  // Extract YYYYMMDD portion
  const dateStr = timePublished.substring(0, 8);
  // Format as YYYY-MM-DD
  return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
}

/**
 * Transform NewsArticle to NewsEvent format for chart display
 */
function articleToEvent(article: NewsArticle, ticker: string): NewsEvent {
  const date = extractDate(article.time_published);
  
  // Find ticker-specific sentiment
  const tickerSentiment = article.ticker_sentiment?.find(ts => ts.ticker === ticker);
  
  return {
    date,
    time_published: article.time_published,
    title: article.title,
    url: article.url,
    source: article.source,
    category_within_source: article.category_within_source,
    topics: article.topics,
    overall_sentiment_score: article.overall_sentiment_score,
    overall_sentiment_label: article.overall_sentiment_label,
    ticker_sentiment: tickerSentiment ? {
      ticker: tickerSentiment.ticker,
      relevance_score: tickerSentiment.relevance_score,
      ticker_sentiment_score: tickerSentiment.ticker_sentiment_score,
      ticker_sentiment_label: tickerSentiment.ticker_sentiment_label,
    } : undefined,
  };
}

/**
 * Load news data for a single ticker
 */
async function loadNewsForTicker(ticker: string, dataType: DataType): Promise<NewsData | null> {
  const url = `/data/stock_data/${dataType}/news/${ticker}.json`;
  
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      // File doesn't exist - ticker has no news or hasn't been fetched yet
      return null;
    }
    
    const data = await response.json();
    
    // Ensure ticker is set
    return {
      ...data,
      ticker,
    };
  } catch (err) {
    console.warn(`Error loading news for ${ticker}:`, err);
    return null;
  }
}

/**
 * Load all news data for all tickers (preload)
 * This will attempt to load news for all tickers found in dates.json
 */
async function loadAllNews(dataType: DataType): Promise<Map<string, NewsData>> {
  // Check cache first
  try {
    const cachedVersion = localStorage.getItem('spac_news_cache_version');
    const cachedDataType = localStorage.getItem('spac_news_cache_data_type');
    if (cachedVersion === NEWS_CACHE_VERSION && cachedDataType === dataType) {
      const cached = localStorage.getItem(NEWS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const newsMap = new Map<string, NewsData>();
        Object.entries(parsed).forEach(([k, v]) => {
          newsMap.set(k, v as NewsData);
        });
        return newsMap;
      }
    }
  } catch (err) {
    console.warn('Error reading cached news:', err);
  }

  // Load dates.json to get list of tickers
  const datesUrl = `/data/stock_data/${dataType}/dates.json`;
  let tickers: string[] = [];
  
  try {
    const datesResponse = await fetch(datesUrl, { cache: 'no-store' });
    if (datesResponse.ok) {
      const datesData = await datesResponse.json();
      tickers = Object.keys(datesData.ticker_to_date || {});
    }
  } catch (err) {
    console.warn('Error loading dates.json:', err);
  }

  // Load news for all tickers in parallel
  const newsMap = new Map<string, NewsData>();
  const loadPromises = tickers.map(async (ticker) => {
    const newsData = await loadNewsForTicker(ticker, dataType);
    if (newsData) {
      newsMap.set(ticker, newsData);
    }
  });

  await Promise.all(loadPromises);

  // Cache the result
  try {
    const cacheObj = Object.fromEntries(newsMap);
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(cacheObj));
    localStorage.setItem('spac_news_cache_version', NEWS_CACHE_VERSION);
    localStorage.setItem('spac_news_cache_data_type', dataType);
  } catch (err) {
    // Handle quota exceeded errors gracefully - news will load fresh each time
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      console.warn('News cache quota exceeded - news data will load fresh each time. This is not critical.');
    } else {
      console.warn('Error caching news:', err);
    }
  }

  return newsMap;
}

/**
 * Get news data for a specific ticker (from cache or load on demand)
 */
export async function getNewsForTicker(ticker: string, dataType: DataType): Promise<NewsData | null> {
  // Check cache first
  if (newsCache && cacheDataType === dataType) {
    const cached = newsCache.get(ticker);
    if (cached) {
      return cached;
    }
  }
  
  // Load on demand
  const newsData = await loadNewsForTicker(ticker, dataType);
  if (newsData && newsCache && cacheDataType === dataType) {
    newsCache.set(ticker, newsData);
  }
  
  return newsData;
}

/**
 * Get news events (transformed format) for a specific ticker
 */
export async function getNewsEventsForTicker(ticker: string, dataType: DataType): Promise<NewsEvent[]> {
  const newsData = await getNewsForTicker(ticker, dataType);
  if (!newsData || !newsData.feed || newsData.feed.length === 0) {
    return [];
  }
  
  return newsData.feed.map(article => articleToEvent(article, ticker));
}

/**
 * Preload all news data for a data type
 */
export async function preloadAllNews(dataType: DataType): Promise<Map<string, NewsData>> {
  if (!newsCache || cacheDataType !== dataType) {
    newsCache = await loadAllNews(dataType);
    cacheDataType = dataType;
  }
  return newsCache || new Map();
}

/**
 * Get all news data (from cache)
 */
export function getAllNews(): Map<string, NewsData> {
  return newsCache || new Map();
}

/**
 * Clear news cache (useful for testing or when data is updated)
 */
export function clearNewsCache(): void {
  newsCache = null;
  cacheDataType = null;
  try {
    localStorage.removeItem(NEWS_CACHE_KEY);
    localStorage.removeItem('spac_news_cache_version');
    localStorage.removeItem('spac_news_cache_data_type');
  } catch (err) {
    console.warn('Error clearing news cache:', err);
  }
}

