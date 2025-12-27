import Papa from 'papaparse';
import { StockData, StockDataPoint } from '../types';
import { getCachedStockData, setCachedStockData } from './storage';

// Read directly from parent data directory (served via Vite middleware)
const STOCK_DATA_URL = '/data/stock_data/stock_data.csv';
const STOCK_VOLUME_URL = '/data/stock_data/stock_volume.csv';
const IPO_DATES_URL = '/data/stock_data/ipo_dates.json';

export async function loadStockData(useCache: boolean = true): Promise<StockData[]> {
  // Cache disabled due to localStorage size limits with large datasets
  // Check cache first if caching is enabled
  // if (useCache) {
  //   const cached = getCachedStockData();
  //   if (cached) {
  //     console.log('Using cached stock data');
  //     return cached as StockData[];
  //   }
  // }
  
  console.log('Loading fresh stock data from:', {
    price: STOCK_DATA_URL,
    volume: STOCK_VOLUME_URL,
    ipo: IPO_DATES_URL,
  });
  
  // Add cache-busting query parameter to prevent browser caching
  const cacheBuster = `?t=${Date.now()}`;
  
  // Load all three data sources in parallel with cache-busting
  const [priceData, volumeData, ipoDates] = await Promise.all([
    fetch(STOCK_DATA_URL + cacheBuster, { 
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    }).then(res => {
      if (!res.ok) throw new Error(`Failed to load stock data: ${res.status}`);
      return res.text();
    }),
    fetch(STOCK_VOLUME_URL + cacheBuster, { 
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    }).then(res => {
      if (!res.ok) throw new Error(`Failed to load volume data: ${res.status}`);
      return res.text();
    }),
    fetch(IPO_DATES_URL + cacheBuster, { 
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    }).then(res => {
      if (!res.ok) throw new Error(`Failed to load IPO dates: ${res.status}`);
      return res.json();
    }),
  ]);
  
  console.log('Fetched data sizes:', {
    priceDataLength: priceData.length,
    volumeDataLength: volumeData.length,
    priceDataFirst100: priceData.substring(0, 100),
  });

  // Parse CSV files
  const priceCsv = Papa.parse(priceData, { header: true, skipEmptyLines: true });
  const volumeCsv = Papa.parse(volumeData, { header: true, skipEmptyLines: true });

  // Create maps for quick lookup
  const priceMap = new Map<string, Map<string, number>>();
  const volumeMap = new Map<string, Map<string, number>>();

  // Process price data
  console.log(`Processing ${priceCsv.data.length} price data rows...`);
  priceCsv.data.forEach((row: any) => {
    const ticker = row.ticker;
    const date = row.date;
    const close = parseFloat(row.close);
    
    if (!priceMap.has(ticker)) {
      priceMap.set(ticker, new Map());
    }
    priceMap.get(ticker)!.set(date, close);
  });
  
  // Log date range from raw data
  const allDates = Array.from(priceCsv.data.map((r: any) => r.date)).sort();
  if (allDates.length > 0) {
    console.log('Raw CSV date range:', {
      earliest: allDates[0],
      latest: allDates[allDates.length - 1],
      totalRows: allDates.length,
    });
  }

  // Process volume data
  volumeCsv.data.forEach((row: any) => {
    const ticker = row.ticker;
    const date = row.date;
    const volume = parseFloat(row.volume);
    
    if (!volumeMap.has(ticker)) {
      volumeMap.set(ticker, new Map());
    }
    volumeMap.get(ticker)!.set(date, volume);
  });

  // Combine data and create StockData objects
  const stockDataMap = new Map<string, StockData>();
  const tickerToDate = ipoDates.ticker_to_date || {};

  // Get all unique tickers
  const allTickers = new Set([...priceMap.keys(), ...volumeMap.keys()]);

  allTickers.forEach(ticker => {
    const priceDates = priceMap.get(ticker) || new Map();
    const volumeDates = volumeMap.get(ticker) || new Map();
    
    // Get all dates for this ticker
    const allDates = new Set([...priceDates.keys(), ...volumeDates.keys()]);
    
    const dataPoints: StockDataPoint[] = Array.from(allDates)
      .sort()
      .map(date => ({
        date,
        close: priceDates.get(date) || 0,
        volume: volumeDates.get(date) || 0,
      }))
      .filter(point => point.close > 0); // Only include points with price data

    if (dataPoints.length > 0) {
      stockDataMap.set(ticker, {
        ticker,
        ipoDate: tickerToDate[ticker] || dataPoints[0].date,
        data: dataPoints,
      });
    }
  });

  const result = Array.from(stockDataMap.values()).sort((a, b) => 
    a.ipoDate.localeCompare(b.ipoDate)
  );

  // Log data summary for debugging
  if (result.length > 0) {
    // Find actual earliest and latest dates across all stocks
    let earliestDate = result[0].data[0]?.date;
    let latestDate = result[0].data[result[0].data.length - 1]?.date;
    
    result.forEach(stock => {
      if (stock.data.length > 0) {
        const stockEarliest = stock.data[0].date;
        const stockLatest = stock.data[stock.data.length - 1].date;
        if (stockEarliest < earliestDate) earliestDate = stockEarliest;
        if (stockLatest > latestDate) latestDate = stockLatest;
      }
    });
    
    console.log('Loaded stock data:', {
      totalStocks: result.length,
      dateRange: {
        earliest: earliestDate,
        latest: latestDate,
      },
      totalDataPoints: result.reduce((sum, stock) => sum + stock.data.length, 0),
      sampleStock: result[0] ? {
        ticker: result[0].ticker,
        dataPoints: result[0].data.length,
        firstDate: result[0].data[0]?.date,
        lastDate: result[0].data[result[0].data.length - 1]?.date,
      } : null,
    });
  }

  // Cache the result if caching is enabled
  // Note: Disabled by default due to localStorage size limits
  // if (useCache) {
  //   setCachedStockData(result);
  //   console.log('Stock data cached for faster reload');
  // }

  return result;
}

