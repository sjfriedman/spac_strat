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

