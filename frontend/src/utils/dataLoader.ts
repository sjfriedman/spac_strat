import Papa from 'papaparse';
import { StockData, StockDataPoint } from '../types';
import { getCachedStockData, setCachedStockData } from './storage';

export type DataType = 'spac' | 'despac';

// Build URLs based on data type
function getDataUrls(dataType: DataType) {
  const basePath = `/data/stock_data/${dataType}`;
  return {
    stockData: `${basePath}/stock_data.csv`,
    stockVolume: `${basePath}/stock_volume.csv`,
    dates: `${basePath}/dates.json`,
  };
}

export async function loadStockData(dataType: DataType = 'spac', useCache: boolean = true): Promise<StockData[]> {
  // Cache disabled due to localStorage size limits with large datasets
  // Check cache first if caching is enabled
  // if (useCache) {
  //   const cached = getCachedStockData();
  //   if (cached) {
  //     console.log('Using cached stock data');
  //     return cached as StockData[];
  //   }
  // }
  
  const urls = getDataUrls(dataType);
  
  console.log(`Loading fresh ${dataType.toUpperCase()} stock data from:`, {
    price: urls.stockData,
    volume: urls.stockVolume,
    dates: urls.dates,
  });
  
  // Add cache-busting query parameter to prevent browser caching
  const cacheBuster = `?t=${Date.now()}`;
  
  // Helper function to parse CSV using streaming
  async function parseCSVStream(url: string, dataType: DataType, fileType: 'price' | 'volume'): Promise<Map<string, Map<string, number>>> {
    const response = await fetch(url + cacheBuster, { 
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!response.ok) {
      // For De-SPAC, these files might not exist yet, return empty map
      if (dataType === 'despac' && response.status === 404) {
        const fileTypeName = fileType === 'price' ? 'Stock data' : 'Stock volume';
        console.warn(`${fileTypeName} CSV not found for De-SPAC (may need to be scraped)`);
        return new Map();
      }
      throw new Error(`Failed to load ${fileType} data: ${response.status}`);
    }

    // Check if response body is available for streaming
    if (!response.body) {
      // Fallback to text if streaming not available
      const text = await response.text();
      if (!text || text.trim().length === 0) {
        return new Map();
      }
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const map = new Map<string, Map<string, number>>();
      parsed.data.forEach((row: any) => {
        const ticker = row.ticker;
        const date = row.date;
        const value = parseFloat(row[fileType === 'price' ? 'close' : 'volume']);
        if (!map.has(ticker)) {
          map.set(ticker, new Map());
        }
        map.get(ticker)!.set(date, value);
      });
      return map;
    }

    // Use streaming parser with response body
    // PapaParse can handle ReadableStream, but we need to ensure proper setup
    const map = new Map<string, Map<string, number>>();
    let rowCount = 0;
    const dates: string[] = [];

    return new Promise((resolve, reject) => {
      // Use PapaParse streaming mode
      // Note: PapaParse expects a stream that can be read incrementally
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let headerParsed = false;
      let headerFields: string[] = [];

      function processChunk(chunk: string) {
        buffer += chunk;
        const lines = buffer.split('\n');
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          if (!headerParsed) {
            // Parse header
            headerFields = Papa.parse(line, { header: false }).data[0] as string[];
            headerParsed = true;
            continue;
          }

          // Parse data row
          const rowData = Papa.parse(line, { header: false }).data[0] as string[];
          if (rowData.length < headerFields.length) continue;

          const row: any = {};
          headerFields.forEach((field, idx) => {
            row[field] = rowData[idx];
          });

          if (row.ticker && row.date) {
            const ticker = row.ticker;
            const date = row.date;
            const value = parseFloat(row[fileType === 'price' ? 'close' : 'volume']);
            
            if (!isNaN(value)) {
              if (!map.has(ticker)) {
                map.set(ticker, new Map());
              }
              map.get(ticker)!.set(date, value);
              if (fileType === 'price') {
                dates.push(date);
              }
              rowCount++;
            }
          }
        }
      }

      function readStream() {
        reader.read().then(({ done, value }) => {
          if (done) {
            // Process remaining buffer
            if (buffer.trim() && headerParsed) {
              const rowData = Papa.parse(buffer, { header: false }).data[0] as string[];
              if (rowData.length >= headerFields.length) {
                const row: any = {};
                headerFields.forEach((field, idx) => {
                  row[field] = rowData[idx];
                });
                if (row.ticker && row.date) {
                  const ticker = row.ticker;
                  const date = row.date;
                  const value = parseFloat(row[fileType === 'price' ? 'close' : 'volume']);
                  if (!isNaN(value)) {
                    if (!map.has(ticker)) {
                      map.set(ticker, new Map());
                    }
                    map.get(ticker)!.set(date, value);
                    if (fileType === 'price') {
                      dates.push(date);
                    }
                    rowCount++;
                  }
                }
              }
            }

            if (fileType === 'price' && dates.length > 0) {
              const sortedDates = dates.sort();
              console.log('Raw CSV date range:', {
                earliest: sortedDates[0],
                latest: sortedDates[sortedDates.length - 1],
                totalRows: rowCount,
              });
            }
            console.log(`Processed ${rowCount} ${fileType} data rows via streaming...`);
            resolve(map);
            return;
          }

          const chunk = decoder.decode(value, { stream: true });
          processChunk(chunk);
          readStream();
        }).catch(reject);
      }

      readStream();
    });
  }

  // Load all three data sources in parallel
  // Note: For De-SPAC, stock_data.csv and stock_volume.csv might not exist yet
  const [priceMap, volumeMap, datesData] = await Promise.all([
    parseCSVStream(urls.stockData, dataType, 'price'),
    parseCSVStream(urls.stockVolume, dataType, 'volume'),
    fetch(urls.dates + cacheBuster, { 
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    }).then(res => {
      if (!res.ok) throw new Error(`Failed to load dates: ${res.status}`);
      return res.json();
    }),
  ]);

  // If no price data (e.g., De-SPAC not scraped yet), return empty array
  if (priceMap.size === 0) {
    console.warn(`No stock data available for ${dataType}. You may need to scrape stock data first.`);
    return [];
  }

  // Combine data and create StockData objects
  const stockDataMap = new Map<string, StockData>();
  const tickerToDate = datesData.ticker_to_date || {};

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
      // Use the date from dates.json (IPO date for SPAC, De-SPAC closing date for De-SPAC)
      const referenceDate = tickerToDate[ticker] || dataPoints[0].date;
      stockDataMap.set(ticker, {
        ticker,
        ipoDate: referenceDate,
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

