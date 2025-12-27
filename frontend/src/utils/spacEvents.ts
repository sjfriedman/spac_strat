// Utility to load and cache SPAC calendar events

export interface SPACEvent {
  date: string;
  ticker: string;
  action: string;
}

const SPAC_EVENTS_CACHE_KEY = 'spac_strat_events_cache';
const SPAC_EVENTS_CACHE_VERSION = '1.0.0';

// Map of ticker -> events for that ticker
let eventsCache: Map<string, SPACEvent[]> | null = null;

async function loadAllSPACEvents(): Promise<Map<string, SPACEvent[]>> {
  // Check cache first
  try {
    const cachedVersion = localStorage.getItem('spac_events_cache_version');
    if (cachedVersion === SPAC_EVENTS_CACHE_VERSION) {
      const cached = localStorage.getItem(SPAC_EVENTS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return new Map(Object.entries(parsed).map(([k, v]) => [k, v as SPACEvent[]]));
      }
    }
  } catch (err) {
    console.warn('Error reading cached SPAC events:', err);
  }

  // Load all JSON files from the spac_calendar directory
  const eventsMap = new Map<string, SPACEvent[]>();
  
  // We'll need to load files dynamically - for now, we'll create an API endpoint or load them in batches
  // Since we have many files, we'll load them all in parallel
  const yearMonths: Array<{ year: number; month: number }> = [];
  
  for (let year = 2020; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      yearMonths.push({ year, month });
    }
  }

  const loadPromises = yearMonths.map(async ({ year, month }) => {
    const filename = `spac_calendar_m${month}_y${year}.json`;
    const url = `/data/spac_calendar/${filename}`;
    
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        // File doesn't exist, skip silently
        return;
      }
      const data = await response.json();
      
      // Process the data structure
      Object.values(data).forEach((monthData: any) => {
        if (monthData && monthData.dates) {
          Object.entries(monthData.dates).forEach(([date, dateData]: [string, any]) => {
            if (dateData && dateData.entries && Array.isArray(dateData.entries)) {
              dateData.entries.forEach((entry: any) => {
                if (Array.isArray(entry) && entry.length >= 3) {
                  const [eventDate, ticker, action] = entry;
                  if (ticker && eventDate && action) {
                    if (!eventsMap.has(ticker)) {
                      eventsMap.set(ticker, []);
                    }
                    eventsMap.get(ticker)!.push({
                      date: eventDate,
                      ticker,
                      action,
                    });
                  }
                }
              });
            }
          });
        }
      });
    } catch (err) {
      // File doesn't exist or error loading, skip silently
      // This is expected for files that don't exist yet
    }
  });

  await Promise.all(loadPromises);

  // Sort events by date for each ticker
  eventsMap.forEach((events, ticker) => {
    events.sort((a, b) => a.date.localeCompare(b.date));
  });

  // Cache the result
  try {
    const cacheObj = Object.fromEntries(eventsMap);
    localStorage.setItem(SPAC_EVENTS_CACHE_KEY, JSON.stringify(cacheObj));
    localStorage.setItem('spac_events_cache_version', SPAC_EVENTS_CACHE_VERSION);
  } catch (err) {
    console.warn('Error caching SPAC events:', err);
  }

  return eventsMap;
}

export async function getSPACEventsForTicker(ticker: string): Promise<SPACEvent[]> {
  if (!eventsCache) {
    eventsCache = await loadAllSPACEvents();
  }
  return eventsCache.get(ticker) || [];
}

export async function getAllSPACEvents(): Promise<Map<string, SPACEvent[]>> {
  if (!eventsCache) {
    eventsCache = await loadAllSPACEvents();
  }
  return eventsCache || new Map();
}

// Preload events on app start
export async function preloadSPACEvents(): Promise<Map<string, SPACEvent[]>> {
  if (!eventsCache) {
    eventsCache = await loadAllSPACEvents();
  }
  return eventsCache || new Map();
}

