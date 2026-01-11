// Utility to load and cache insider regression statistics

import { 
  InsiderRegressionStats, 
  PerInsiderRegression, 
  PerPairRegression,
  RegressionStatsData 
} from '../types';
import { DataType } from './dataLoader';

const REGRESSION_CACHE_KEY = 'spac_strat_regression_cache';
const REGRESSION_CACHE_VERSION = '1.1.0'; // v1.1: Added cache clearing support

// Cache for regression statistics
let regressionCache: RegressionStatsData | null = null;
let cacheDataType: DataType | null = null;

/**
 * Load regression statistics JSON files for a data type
 */
async function loadRegressionStatsJSON(dataType: DataType): Promise<RegressionStatsData | null> {
  const perInsiderUrl = `/data/insider_transactions/${dataType}/per_insider_regression.json`;
  const perPairUrl = `/data/insider_transactions/${dataType}/per_pair_regression.json`;
  
  console.log(`[Regression Stats] Loading from: ${perInsiderUrl} and ${perPairUrl}`);
  
  try {
    // Load both JSON files in parallel
    const [perInsiderResponse, perPairResponse] = await Promise.all([
      fetch(perInsiderUrl, { cache: 'no-store' }),
      fetch(perPairUrl, { cache: 'no-store' })
    ]);
    
    // Check if files exist
    if (!perInsiderResponse.ok) {
      console.warn(`[Regression Stats] Per-insider file not found: ${perInsiderUrl}`);
      return null;
    }
    
    if (!perPairResponse.ok) {
      console.warn(`[Regression Stats] Per-pair file not found: ${perPairUrl}`);
      return null;
    }
    
    // Parse JSON
    const perInsiderData = await perInsiderResponse.json();
    const perPairData = await perPairResponse.json();
    
    const perInsider = perInsiderData.per_insider || {};
    const perPair = perPairData.per_pair || {};
    
    console.log(`[Regression Stats] Loaded ${Object.keys(perInsider).length} insiders and ${Object.keys(perPair).length} pairs`);
    
    // Log first few entries for debugging
    const insiderKeys = Object.keys(perInsider).slice(0, 3);
    const pairKeys = Object.keys(perPair).slice(0, 3);
    if (insiderKeys.length > 0) {
      console.log(`[Regression Stats] Sample insider keys:`, insiderKeys);
      console.log(`[Regression Stats] Sample insider data:`, perInsider[insiderKeys[0]]);
    }
    if (pairKeys.length > 0) {
      console.log(`[Regression Stats] Sample pair keys:`, pairKeys);
      console.log(`[Regression Stats] Sample pair data:`, perPair[pairKeys[0]]);
    }
    
    return {
      per_insider: perInsider,
      per_pair: perPair
    };
    
  } catch (error) {
    console.error('[Regression Stats] Error loading:', error);
    return null;
  }
}

/**
 * Load regression stats from localStorage cache or fetch fresh data
 */
async function loadRegressionStats(dataType: DataType): Promise<RegressionStatsData | null> {
  // Check memory cache first
  if (regressionCache && cacheDataType === dataType) {
    console.log('[Regression Stats] Using memory cache');
    return regressionCache;
  }
  
  // Try localStorage cache
  try {
    const cacheKey = `${REGRESSION_CACHE_KEY}_${dataType}`;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      const parsedCache = JSON.parse(cached);
      
      // Check version
      if (parsedCache.version === REGRESSION_CACHE_VERSION) {
        console.log('[Regression Stats] Using localStorage cache');
        regressionCache = parsedCache.data;
        cacheDataType = dataType;
        return regressionCache;
      } else {
        console.log('[Regression Stats] Cache version mismatch, clearing');
        localStorage.removeItem(cacheKey);
      }
    }
  } catch (error) {
    console.warn('[Regression Stats] Error reading cache:', error);
  }
  
  // Load fresh data
  console.log('[Regression Stats] Loading fresh data');
  const data = await loadRegressionStatsJSON(dataType);
  
  if (data) {
    // Update memory cache
    regressionCache = data;
    cacheDataType = dataType;
    
    // Update localStorage cache
    try {
      const cacheKey = `${REGRESSION_CACHE_KEY}_${dataType}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        version: REGRESSION_CACHE_VERSION,
        data: data
      }));
      console.log('[Regression Stats] Cached to localStorage');
    } catch (error) {
      console.warn('[Regression Stats] Error caching to localStorage:', error);
    }
  }
  
  return data;
}

/**
 * Preload and cache all regression statistics for a data type
 * Call this when the app initializes or when switching data types
 */
export async function preloadAllRegressionStats(dataType: DataType): Promise<RegressionStatsData | null> {
  console.log(`[Regression Stats] Preloading all stats for ${dataType}...`);
  
  // Check for clearCache URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const shouldClearCache = urlParams.get('clearCache') === 'true';
  
  if (shouldClearCache) {
    console.log('[Regression Stats] Clearing cache due to URL parameter');
    clearRegressionCache();
  }
  
  const startTime = performance.now();
  
  const data = await loadRegressionStats(dataType);
  
  const endTime = performance.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  if (data) {
    const insiderCount = Object.keys(data.per_insider).length;
    const pairCount = Object.keys(data.per_pair).length;
    console.log(`[Regression Stats] ✓ Preloaded ${insiderCount} insiders and ${pairCount} pairs in ${duration}s`);
  } else {
    console.log(`[Regression Stats] ✗ No data found for ${dataType}`);
  }
  
  return data;
}

/**
 * Get regression stats for a specific insider (aggregated across all companies)
 */
export function getRegressionForInsider(insiderName: string, statsData?: RegressionStatsData | null): InsiderRegressionStats | null {
  const data = statsData || regressionCache;
  if (!data) {
    return null;
  }
  
  return data.per_insider[insiderName] || null;
}

/**
 * Get regression stats for a specific insider-company pair
 */
export function getRegressionForPair(insiderName: string, ticker: string, statsData?: RegressionStatsData | null): InsiderRegressionStats | null {
  const data = statsData || regressionCache;
  if (!data) {
    console.warn(`[Regression Stats] getRegressionForPair called but no data available`);
    return null;
  }
  
  const pairKey = `${insiderName}|${ticker}`;
  const result = data.per_pair[pairKey] || null;
  
  // Debug logging for first few lookups
  if (Math.random() < 0.01) { // Log 1% of lookups to avoid spam
    console.log(`[Regression Stats] Lookup pair: "${pairKey}" -> ${result ? 'FOUND' : 'NOT FOUND'}`);
    if (!result && Object.keys(data.per_pair).length > 0) {
      const sampleKeys = Object.keys(data.per_pair).slice(0, 3);
      console.log(`[Regression Stats] Sample available keys:`, sampleKeys);
    }
  }
  
  return result;
}

/**
 * Get all regression stats (cached data)
 */
export function getAllRegressionStats(): RegressionStatsData | null {
  return regressionCache;
}

/**
 * Clear regression stats cache
 */
export function clearRegressionCache(): void {
  regressionCache = null;
  cacheDataType = null;
  
  // Clear localStorage
  try {
    localStorage.removeItem(`${REGRESSION_CACHE_KEY}_spac`);
    localStorage.removeItem(`${REGRESSION_CACHE_KEY}_despac`);
    console.log('[Regression Stats] Cache cleared');
  } catch (error) {
    console.warn('[Regression Stats] Error clearing cache:', error);
  }
}

/**
 * Get accuracy color class based on directional accuracy percentage
 */
export function getAccuracyColorClass(accuracy: number): string {
  if (accuracy >= 65) return 'text-green-400';
  if (accuracy >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

/**
 * Get accuracy icon based on directional accuracy percentage
 */
export function getAccuracyIcon(accuracy: number): string {
  if (accuracy >= 65) return '✓';
  if (accuracy >= 50) return '~';
  return '✗';
}

/**
 * Format correlation for display
 */
export function formatCorrelation(correlation: number | null | undefined): string {
  if (correlation === null || correlation === undefined || isNaN(correlation)) {
    return 'N/A';
  }
  return correlation.toFixed(3);
}

/**
 * Format R-squared for display
 */
export function formatRSquared(r_squared: number | null | undefined): string {
  if (r_squared === null || r_squared === undefined || isNaN(r_squared)) {
    return 'N/A';
  }
  return r_squared.toFixed(3);
}

