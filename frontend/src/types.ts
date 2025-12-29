export interface StockDataPoint {
  date: string;
  close: number;
  volume: number;
}

export interface StockData {
  ticker: string;
  ipoDate: string;
  data: StockDataPoint[];
}

export interface ChartPosition {
  ticker: string;
  locked: boolean;
  starred: boolean;
}

export interface PrecomputedChartData {
  ticker: string;
  chartData: Array<{
    date: string;
    dateShort: string;
    close: number;
    volume: number;
    pctChange: number;
  }>;
  priceRange: { min: number; max: number };
  volumeRange: { min: number; max: number };
  pctChangeRange: { min: number; max: number };
  ipoPrice: number;
  stats: {
    min: number;
    max: number;
    current: number;
  };
}

export interface SPACEvent {
  date: string;
  ticker: string;
  action: string;
}

export interface StockStatistics {
  // Basic stats
  ipoPrice: number;
  currentPrice: number;
  totalReturn: number;
  totalReturnPct: number;
  
  // Price stats
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  priceStdDev: number;
  
  // Performance metrics
  maxDrawdown: number;
  maxDrawdownPct: number;
  daysToPeak: number;
  daysToTrough: number;
  recoveryDays: number | null;
  
  // Volatility
  volatility: number; // Annualized volatility
  dailyVolatility: number;
  
  // Volume stats
  avgVolume: number;
  maxVolume: number;
  currentVolume: number;
  volumeSpikes: number; // Count of days with volume > 2x average
  
  // Time stats
  totalDays: number;
  daysSinceIPO: number;
  
  // Price milestones
  daysAboveIPO: number;
  daysBelowIPO: number;
  peakPrice: number;
  peakDate: string;
  troughPrice: number;
  troughDate: string;
}

export interface TechnicalIndicators {
  sma20: number[];
  sma50: number[];
  sma200: number[];
  rsi: number[];
  macd: {
    macd: number[];
    signal: number[];
    histogram: number[];
  };
}

export interface NewsArticle {
  title: string;
  url: string;
  time_published: string;
  authors: string[];
  summary: string;
  banner_image?: string;
  source: string;
  category_within_source?: string;
  source_domain: string;
  topics: Array<{
    topic: string;
    relevance_score: string;
  }>;
  overall_sentiment_score: number;
  overall_sentiment_label: "Bullish" | "Bearish" | "Neutral";
  ticker_sentiment: Array<{
    ticker: string;
    relevance_score: string;
    ticker_sentiment_score: string;
    ticker_sentiment_label: "Bullish" | "Bearish" | "Neutral";
  }>;
}

export interface NewsData {
  ticker: string;
  feed: NewsArticle[];
  items?: string;
  sentiment_score_definition?: string;
  relevance_score_definition?: string;
}

export interface NewsEvent {
  date: string; // YYYY-MM-DD format (extracted from time_published)
  time_published: string; // Full timestamp
  title: string;
  url: string;
  source: string;
  category_within_source?: string;
  topics: NewsArticle['topics'];
  overall_sentiment_score: number;
  overall_sentiment_label: string;
  ticker_sentiment?: {
    ticker: string;
    relevance_score: string;
    ticker_sentiment_score: string;
    ticker_sentiment_label: string;
  };
}

export interface FinancialStatement {
  ticker: string;
  balanceSheet: any; // Full API response
  cashFlow: any;
  incomeStatement: any;
}

export interface FinancialStatementEvent {
  date: string; // Report date (YYYY-MM-DD)
  ticker: string;
  quarter: string; // "Q1 2025"
  fiscalDateEnding: string; // "2025-03-31"
  reportDate: string; // Actual report release date
  label: string; // "Q1 2025 - 2025-03-28"
}

export interface EarningsData {
  ticker: string;
  earnings: any; // Full EARNINGS API response (includes quarterlyEarnings and annualEarnings with both reportedEPS and estimatedEPS)
}

