const FAVORITES_KEY = 'spac_strat_favorites';
const LOCKED_KEY = 'spac_strat_locked';
const STOCK_DATA_CACHE_KEY = 'spac_strat_stock_data_cache';
const CACHE_VERSION_KEY = 'spac_strat_cache_version';
const CACHE_VERSION = '1.0.0';

export function getFavorites(): Set<string> {
  const stored = localStorage.getItem(FAVORITES_KEY);
  return stored ? new Set(JSON.parse(stored)) : new Set();
}

export function toggleFavorite(ticker: string): void {
  const favorites = getFavorites();
  if (favorites.has(ticker)) {
    favorites.delete(ticker);
  } else {
    favorites.add(ticker);
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favorites)));
}

export function getLocked(): Set<string> {
  const stored = localStorage.getItem(LOCKED_KEY);
  return stored ? new Set(JSON.parse(stored)) : new Set();
}

export function toggleLocked(ticker: string): void {
  const locked = getLocked();
  if (locked.has(ticker)) {
    locked.delete(ticker);
  } else {
    locked.add(ticker);
  }
  localStorage.setItem(LOCKED_KEY, JSON.stringify(Array.from(locked)));
}

export function resetAll(): void {
  localStorage.removeItem(FAVORITES_KEY);
  localStorage.removeItem(LOCKED_KEY);
}

// Stock data cache functions
export function getCachedStockData(): any[] | null {
  try {
    const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
    if (cachedVersion !== CACHE_VERSION) {
      // Cache version mismatch, clear old cache
      clearStockDataCache();
      return null;
    }
    
    const cached = localStorage.getItem(STOCK_DATA_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error('Error reading cached stock data:', err);
    clearStockDataCache();
  }
  return null;
}

export function setCachedStockData(data: any[]): void {
  try {
    localStorage.setItem(STOCK_DATA_CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
  } catch (err) {
    console.error('Error caching stock data:', err);
    // If storage is full, try to clear and retry
    if (err instanceof DOMException && err.code === 22) {
      clearStockDataCache();
      try {
        localStorage.setItem(STOCK_DATA_CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
      } catch (retryErr) {
        console.error('Failed to cache after clearing:', retryErr);
      }
    }
  }
}

export function clearStockDataCache(): void {
  localStorage.removeItem(STOCK_DATA_CACHE_KEY);
  localStorage.removeItem(CACHE_VERSION_KEY);
}

