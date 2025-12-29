// Utility to load and cache earnings data

import { EarningsData } from '../types';
import { DataType } from './dataLoader';

const EARNINGS_CACHE_KEY = 'spac_strat_earnings_cache';
const EARNINGS_CACHE_VERSION = '1.0.0';

// Map of ticker -> earnings data for that ticker
let earningsCache: Map<string, EarningsData> | null = null;
let cacheDataType: DataType | null = null;

/**
 * Calculate quarter from month (1-12)
 */
function getQuarter(month: number): number {
  if (month >= 1 && month <= 3) return 1;
  if (month >= 4 && month <= 6) return 2;
  if (month >= 7 && month <= 9) return 3;
  if (month >= 10 && month <= 12) return 4;
  return 1;
}

/**
 * Convert fiscal date ending (YYYY-MM-DD) to quarter/year string
 */
function fiscalDateToQuarterYear(fiscalDateEnding: string): string {
  if (!fiscalDateEnding || fiscalDateEnding.length < 10) {
    return '';
  }
  
  try {
    const date = new Date(fiscalDateEnding);
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // getMonth() returns 0-11
    const quarter = getQuarter(month);
    
    return `Q${quarter} ${year}`;
  } catch (err) {
    console.warn(`Error parsing fiscal date: ${fiscalDateEnding}`, err);
    return '';
  }
}

/**
 * Extract earnings by quarter/year from EARNINGS endpoint
 * The EARNINGS endpoint includes both reported EPS (actual) and estimated EPS (analyst estimates)
 * Returns map of quarter/year -> { reportedEPS, estimatedEPS, reportDate, fiscalDateEnding }
 */
export function extractEarningsByPeriod(earningsData: EarningsData): Map<string, {
  quarter: string;
  fiscalDateEnding: string;
  reportDate: string;
  reportedEPS: number | null;
  estimatedEPS: number | null;
}> {
  const earningsMap = new Map<string, {
    quarter: string;
    fiscalDateEnding: string;
    reportDate: string;
    reportedEPS: number | null;
    estimatedEPS: number | null;
  }>();
  
  // Process earnings data (EARNINGS endpoint: includes both reported EPS and estimated EPS)
  if (earningsData.earnings) {
    const earnings = earningsData.earnings;
    
    // Process quarterly earnings
    if (earnings.quarterlyEarnings && Array.isArray(earnings.quarterlyEarnings)) {
      for (const earning of earnings.quarterlyEarnings) {
        const fiscalDateEnding = earning.fiscalDateEnding || '';
        const reportDate = earning.reportedDate || fiscalDateEnding;
        const quarter = fiscalDateToQuarterYear(fiscalDateEnding);
        
        if (!fiscalDateEnding || !quarter) continue;
        
        // Parse reported EPS (actual earnings)
        let reportedEPS: number | null = null;
        if (earning.reportedEPS) {
          const eps = parseFloat(earning.reportedEPS);
          if (!isNaN(eps)) {
            reportedEPS = eps;
          }
        }
        
        // Parse estimated EPS (what analysts estimated before earnings were reported)
        let estimatedEPS: number | null = null;
        if (earning.estimatedEPS) {
          const eps = parseFloat(earning.estimatedEPS);
          if (!isNaN(eps)) {
            estimatedEPS = eps;
          }
        }
        
        const periodKey = `${quarter}-${fiscalDateEnding}`;
        earningsMap.set(periodKey, {
          quarter,
          fiscalDateEnding,
          reportDate,
          reportedEPS,
          estimatedEPS
        });
      }
    }
    
    // Process annual earnings (if needed)
    if (earnings.annualEarnings && Array.isArray(earnings.annualEarnings)) {
      for (const earning of earnings.annualEarnings) {
        const fiscalDateEnding = earning.fiscalDateEnding || '';
        const reportDate = earning.reportedDate || fiscalDateEnding;
        const quarter = fiscalDateToQuarterYear(fiscalDateEnding);
        
        if (!fiscalDateEnding || !quarter) continue;
        
        let reportedEPS: number | null = null;
        if (earning.reportedEPS) {
          const eps = parseFloat(earning.reportedEPS);
          if (!isNaN(eps)) {
            reportedEPS = eps;
          }
        }
        
        // Parse estimated EPS (what analysts estimated before earnings were reported)
        let estimatedEPS: number | null = null;
        if (earning.estimatedEPS) {
          const eps = parseFloat(earning.estimatedEPS);
          if (!isNaN(eps)) {
            estimatedEPS = eps;
          }
        }
        
        const periodKey = `${quarter}-${fiscalDateEnding}`;
        // Only set if not already exists (quarterly takes precedence)
        if (!earningsMap.has(periodKey)) {
          earningsMap.set(periodKey, {
            quarter,
            fiscalDateEnding,
            reportDate,
            reportedEPS,
            estimatedEPS
          });
        } else {
          // Update existing entry with annual data if quarterly didn't have estimates
          const existing = earningsMap.get(periodKey)!;
          if (existing.estimatedEPS === null && estimatedEPS !== null) {
            existing.estimatedEPS = estimatedEPS;
          }
        }
      }
    }
  }
  
  return earningsMap;
}

/**
 * Load earnings data for a single ticker
 */
async function loadEarningsForTicker(ticker: string, dataType: DataType): Promise<EarningsData | null> {
  // Try raw data directory first (where the script saves)
  const rawUrl = `/data/raw_stock_data/${dataType}/earnings/${ticker}.json`;
  
  try {
    const response = await fetch(rawUrl, { cache: 'no-store' });
    if (!response.ok) {
      // File doesn't exist - ticker has no earnings data or hasn't been fetched yet
      return null;
    }
    
    const data = await response.json();
    
    // Ensure ticker is set
    return {
      ...data,
      ticker,
    };
  } catch (err) {
    console.warn(`Error loading earnings for ${ticker}:`, err);
    return null;
  }
}

/**
 * Load all earnings data for all tickers (preload)
 * This will attempt to load earnings for all tickers found in dates.json
 */
async function loadAllEarnings(dataType: DataType): Promise<Map<string, EarningsData>> {
  // Check cache first
  try {
    const cachedVersion = localStorage.getItem('spac_earnings_cache_version');
    const cachedDataType = localStorage.getItem('spac_earnings_cache_data_type');
    if (cachedVersion === EARNINGS_CACHE_VERSION && cachedDataType === dataType) {
      const cached = localStorage.getItem(EARNINGS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const earningsMap = new Map<string, EarningsData>();
        Object.entries(parsed).forEach(([k, v]) => {
          earningsMap.set(k, v as EarningsData);
        });
        return earningsMap;
      }
    }
  } catch (err) {
    console.warn('Error reading cached earnings:', err);
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

  // Load earnings for all tickers in parallel
  const earningsMap = new Map<string, EarningsData>();
  const loadPromises = tickers.map(async (ticker) => {
    const earningsData = await loadEarningsForTicker(ticker, dataType);
    if (earningsData) {
      earningsMap.set(ticker, earningsData);
    }
  });

  await Promise.all(loadPromises);

  // Cache the result
  try {
    const cacheObj = Object.fromEntries(earningsMap);
    localStorage.setItem(EARNINGS_CACHE_KEY, JSON.stringify(cacheObj));
    localStorage.setItem('spac_earnings_cache_version', EARNINGS_CACHE_VERSION);
    localStorage.setItem('spac_earnings_cache_data_type', dataType);
  } catch (err) {
    // Handle quota exceeded errors gracefully - earnings will load fresh each time
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      console.warn('Earnings cache quota exceeded - data will load fresh each time. This is not critical.');
    } else {
      console.warn('Error caching earnings:', err);
    }
  }

  return earningsMap;
}

/**
 * Get earnings data for a specific ticker (from cache or load on demand)
 */
export async function getEarningsForTicker(ticker: string, dataType: DataType): Promise<EarningsData | null> {
  // Check cache first
  if (earningsCache && cacheDataType === dataType) {
    const cached = earningsCache.get(ticker);
    if (cached) {
      return cached;
    }
  }
  
  // Load on demand
  const earningsData = await loadEarningsForTicker(ticker, dataType);
  if (earningsData && earningsCache && cacheDataType === dataType) {
    earningsCache.set(ticker, earningsData);
  }
  
  return earningsData;
}

/**
 * Preload all earnings data for a data type
 */
export async function preloadAllEarnings(dataType: DataType): Promise<Map<string, EarningsData>> {
  if (!earningsCache || cacheDataType !== dataType) {
    earningsCache = await loadAllEarnings(dataType);
    cacheDataType = dataType;
  }
  return earningsCache || new Map();
}

/**
 * Get all earnings data (from cache)
 */
export function getAllEarnings(): Map<string, EarningsData> {
  return earningsCache || new Map();
}

/**
 * Clear earnings cache (useful for testing or when data is updated)
 */
export function clearEarningsCache(): void {
  earningsCache = null;
  cacheDataType = null;
  try {
    localStorage.removeItem(EARNINGS_CACHE_KEY);
    localStorage.removeItem('spac_earnings_cache_version');
    localStorage.removeItem('spac_earnings_cache_data_type');
  } catch (err) {
    console.warn('Error clearing earnings cache:', err);
  }
}

