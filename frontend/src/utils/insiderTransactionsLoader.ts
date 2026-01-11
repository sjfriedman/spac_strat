// Utility to load and cache insider transactions data

import { InsiderTransaction, InsiderTransactionsData, InsiderTransactionEvent } from '../types';
import { DataType } from './dataLoader';

const INSIDER_CACHE_KEY = 'spac_strat_insider_cache';
const INSIDER_CACHE_VERSION = '3.0.0'; // v3: Added cache clearing and fixed reload issues

// Map of ticker -> insider transactions data for that ticker
let insiderCache: Map<string, InsiderTransactionsData> | null = null;
let cacheDataType: DataType | null = null;

/**
 * Parse CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Load and parse insider transactions CSV for a data type
 * Returns all transactions across all tickers
 */
async function loadInsiderTransactionsCSV(dataType: DataType): Promise<InsiderTransaction[]> {
  const url = `/data/insider_transactions/${dataType}/insider_transactions.csv`;
  
  console.log(`[Insider Transactions] Loading from: ${url}`);
  
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      console.error(`[Insider Transactions] HTTP ${response.status}: File not found or error loading ${url}`);
      console.error(`[Insider Transactions] Response status: ${response.status}, statusText: ${response.statusText}`);
      return [];
    }
    
    const csvText = await response.text();
    console.log(`[Insider Transactions] Loaded ${csvText.length} bytes from ${url}`);
    
    if (!csvText || csvText.trim().length === 0) {
      console.error(`[Insider Transactions] CSV file is empty: ${url}`);
      return [];
    }
    
    const lines = csvText.split('\n').filter(line => line.trim());
    console.log(`[Insider Transactions] Parsed ${lines.length} lines from CSV`);
    
    if (lines.length < 2) {
      // No data (just header or empty)
      return [];
    }
    
    // Parse header
    const header = parseCSVLine(lines[0]);
    console.log(`[Insider Transactions] CSV header:`, header);
    
    // Find column indices
    const colIndex: Record<string, number> = {};
    header.forEach((col, idx) => {
      colIndex[col] = idx;
    });
    
    // Verify required columns exist
    const requiredColumns = ['date', 'ticker', 'owner_name', 'transaction_type', 'shares', 'value'];
    const missingColumns = requiredColumns.filter(col => colIndex[col] === undefined);
    if (missingColumns.length > 0) {
      console.error(`[Insider Transactions] Missing required columns: ${missingColumns.join(', ')}`);
      console.error(`[Insider Transactions] Available columns: ${header.join(', ')}`);
      return [];
    }
    
    // Parse data rows
    const transactions: InsiderTransaction[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      
      if (values.length < header.length) {
        continue; // Skip malformed rows
      }
      
      try {
        const transaction: InsiderTransaction = {
          date: values[colIndex['date']] || '',
          ticker: values[colIndex['ticker']] || '',
          owner_name: values[colIndex['owner_name']] || '',
          position: values[colIndex['position']] || '',
          transaction_type: values[colIndex['transaction_type']] || '',
          security_type: values[colIndex['security_type']] || 'Common Stock',
          shares: parseFloat(values[colIndex['shares']]) || 0,
          price: parseFloat(values[colIndex['price']]) || 0,
          value: parseFloat(values[colIndex['value']]) || 0,
        };
        
        transactions.push(transaction);
      } catch (err) {
        console.warn(`Error parsing transaction row ${i}:`, err);
      }
    }
    
    console.log(`[Insider Transactions] Parsed ${transactions.length} transactions for ${dataType}`);
    return transactions;
  } catch (err) {
    console.error(`[Insider Transactions] Error loading or parsing CSV for ${dataType}:`, err);
    return [];
  }
}

/**
 * Load all insider transactions and group by ticker
 */
async function loadAllInsiderTransactions(dataType: DataType): Promise<Map<string, InsiderTransactionsData>> {
  console.log(`[Insider Transactions] loadAllInsiderTransactions called for ${dataType}`);
  
  // Check cache first
  try {
    const cachedVersion = localStorage.getItem('spac_insider_cache_version');
    const cachedDataType = localStorage.getItem('spac_insider_cache_data_type');
    console.log(`[Insider Transactions] Cache check: version=${cachedVersion}, expected=${INSIDER_CACHE_VERSION}, dataType=${cachedDataType}, expected=${dataType}`);
    
    if (cachedVersion === INSIDER_CACHE_VERSION && cachedDataType === dataType) {
      const cached = localStorage.getItem(INSIDER_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const insiderMap = new Map<string, InsiderTransactionsData>();
        Object.entries(parsed).forEach(([k, v]) => {
          insiderMap.set(k, v as InsiderTransactionsData);
        });
        console.log(`[Insider Transactions] Loaded ${insiderMap.size} tickers from localStorage cache`);
        
        // Validate cache - if it's empty, reload
        if (insiderMap.size === 0) {
          console.warn('[Insider Transactions] Cache is empty, clearing and reloading...');
          clearInsiderTransactionsCache();
        } else {
          return insiderMap;
        }
      } else {
        console.log('[Insider Transactions] No cached data found, loading from CSV...');
      }
    } else {
      console.log(`[Insider Transactions] Cache version mismatch or wrong data type, loading from CSV...`);
    }
  } catch (err) {
    console.warn('[Insider Transactions] Error reading cached data:', err);
    console.log('[Insider Transactions] Clearing cache and loading from CSV...');
    clearInsiderTransactionsCache();
  }

  // Load CSV data
  const allTransactions = await loadInsiderTransactionsCSV(dataType);
  console.log(`[Insider Transactions] Loaded ${allTransactions.length} total transactions`);
  
  if (allTransactions.length === 0) {
    console.warn(`[Insider Transactions] No transactions loaded for ${dataType}! Check if CSV file exists at /data/insider_transactions/${dataType}/insider_transactions.csv`);
    return new Map();
  }
  
  // Group by ticker
  const insiderMap = new Map<string, InsiderTransactionsData>();
  
  allTransactions.forEach(transaction => {
    const ticker = transaction.ticker;
    
    if (!ticker || ticker.trim() === '') {
      console.warn('[Insider Transactions] Skipping transaction with empty ticker:', transaction);
      return;
    }
    
    if (!insiderMap.has(ticker)) {
      insiderMap.set(ticker, {
        ticker,
        transactions: [],
      });
    }
    
    insiderMap.get(ticker)!.transactions.push(transaction);
  });

  console.log(`[Insider Transactions] Grouped into ${insiderMap.size} tickers`);
  
  // Log sample tickers for debugging
  if (insiderMap.size > 0) {
    const sampleTickers = Array.from(insiderMap.keys()).slice(0, 5);
    console.log(`[Insider Transactions] Sample tickers:`, sampleTickers);
    sampleTickers.forEach(ticker => {
      const data = insiderMap.get(ticker)!;
      console.log(`[Insider Transactions] ${ticker}: ${data.transactions.length} transactions`);
    });
  }

  // Sort transactions by date for each ticker
  insiderMap.forEach(data => {
    data.transactions.sort((a, b) => a.date.localeCompare(b.date));
  });

  // Cache the result
  try {
    const cacheObj = Object.fromEntries(insiderMap);
    localStorage.setItem(INSIDER_CACHE_KEY, JSON.stringify(cacheObj));
    localStorage.setItem('spac_insider_cache_version', INSIDER_CACHE_VERSION);
    localStorage.setItem('spac_insider_cache_data_type', dataType);
    console.log(`[Insider Transactions] Cached ${insiderMap.size} tickers to localStorage`);
  } catch (err) {
    // Handle quota exceeded errors gracefully
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      console.warn('Insider transactions cache quota exceeded - data will load fresh each time.');
    } else {
      console.warn('Error caching insider transactions:', err);
    }
  }

  return insiderMap;
}

/**
 * Get insider transactions for a specific ticker
 */
export async function getInsiderTransactionsForTicker(
  ticker: string, 
  dataType: DataType
): Promise<InsiderTransactionsData | null> {
  // Ensure cache is loaded
  if (!insiderCache || cacheDataType !== dataType) {
    insiderCache = await loadAllInsiderTransactions(dataType);
    cacheDataType = dataType;
  }
  
  return insiderCache.get(ticker) || null;
}

/**
 * Get insider transaction events (grouped by date) for a specific ticker
 * Used for chart annotations
 */
export async function getInsiderTransactionEventsForTicker(
  ticker: string, 
  dataType: DataType
): Promise<InsiderTransactionEvent[]> {
  const insiderData = await getInsiderTransactionsForTicker(ticker, dataType);
  if (!insiderData || !insiderData.transactions || insiderData.transactions.length === 0) {
    return [];
  }
  
  // Group transactions by date
  const transactionsByDate = new Map<string, InsiderTransaction[]>();
  
  insiderData.transactions.forEach(transaction => {
    const date = transaction.date;
    if (!transactionsByDate.has(date)) {
      transactionsByDate.set(date, []);
    }
    transactionsByDate.get(date)!.push(transaction);
  });
  
  // Calculate total value for all transactions to determine size categories
  const allValues = insiderData.transactions.map(t => Math.abs(t.value));
  allValues.sort((a, b) => a - b);
  const p25 = allValues[Math.floor(allValues.length * 0.25)] || 0;
  const p75 = allValues[Math.floor(allValues.length * 0.75)] || 0;
  
  // Create events
  const events: InsiderTransactionEvent[] = [];
  
  transactionsByDate.forEach((transactions, date) => {
    // Calculate aggregate metrics
    const totalValue = transactions.reduce((sum, t) => sum + Math.abs(t.value), 0);
    const netShares = transactions.reduce((sum, t) => {
      // Positive for buys/purchases, negative for sales
      const isBuy = t.transaction_type.toLowerCase().includes('purchase') || 
                    t.transaction_type.toLowerCase().includes('buy');
      return sum + (isBuy ? t.shares : -t.shares);
    }, 0);
    
    const uniqueInsiders = new Set(transactions.map(t => t.owner_name)).size;
    
    // Determine size category based on total value
    let sizeCategory: 'small' | 'medium' | 'large';
    if (totalValue < p25) {
      sizeCategory = 'small';
    } else if (totalValue < p75) {
      sizeCategory = 'medium';
    } else {
      sizeCategory = 'large';
    }
    
    events.push({
      date,
      transactions,
      totalValue,
      netShares,
      insiderCount: uniqueInsiders,
      sizeCategory,
    });
  });
  
  // Sort by date
  events.sort((a, b) => a.date.localeCompare(b.date));
  
  return events;
}

/**
 * Preload all insider transactions for a data type
 */
export async function preloadAllInsiderTransactions(dataType: DataType): Promise<Map<string, InsiderTransactionsData>> {
  console.log(`[Insider Transactions] preloadAllInsiderTransactions called for ${dataType}`);
  
  // Check for clearCache URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const shouldClearCache = urlParams.get('clearCache') === 'true';
  
  if (shouldClearCache) {
    console.log('[Insider Transactions] Clearing cache due to URL parameter');
    clearInsiderTransactionsCache();
  }
  
  // Always reload if cache is empty or data type changed
  if (!insiderCache || cacheDataType !== dataType || insiderCache.size === 0) {
    console.log(`[Insider Transactions] Loading insider transactions (cache empty or data type changed)`);
    insiderCache = await loadAllInsiderTransactions(dataType);
    cacheDataType = dataType;
    console.log(`[Insider Transactions] Loaded ${insiderCache.size} tickers into cache`);
    
    // If still empty after loading, log a warning
    if (insiderCache.size === 0) {
      console.error(`[Insider Transactions] WARNING: Still 0 tickers after loading! Check CSV file at /data/insider_transactions/${dataType}/insider_transactions.csv`);
    }
  } else {
    console.log(`[Insider Transactions] Using existing cache with ${insiderCache.size} tickers`);
  }
  return insiderCache || new Map();
}

/**
 * Get all insider transactions data (from cache)
 */
export function getAllInsiderTransactions(): Map<string, InsiderTransactionsData> {
  return insiderCache || new Map();
}

/**
 * Clear insider transactions cache
 */
export function clearInsiderTransactionsCache(): void {
  console.log('[Insider Transactions] Clearing cache');
  insiderCache = null;
  cacheDataType = null;
  try {
    localStorage.removeItem(INSIDER_CACHE_KEY);
    localStorage.removeItem('spac_insider_cache_version');
    localStorage.removeItem('spac_insider_cache_data_type');
    // Also clear the old cache key format if it exists
    localStorage.removeItem('spac_insider_cache_version');
    localStorage.removeItem('spac_insider_cache_data_type');
    console.log('[Insider Transactions] Cache cleared successfully');
  } catch (err) {
    console.warn('[Insider Transactions] Error clearing localStorage:', err);
  }
}

