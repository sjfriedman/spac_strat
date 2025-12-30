import { StockData, PrecomputedChartData } from '../types';

// Cache for formatted date strings to avoid repeated toLocaleDateString calls
const dateFormatCache = new Map<string, string>();

// Format date with caching - includes year to avoid ambiguity in multi-year charts
function formatDateShort(dateString: string): string {
  if (dateFormatCache.has(dateString)) {
    return dateFormatCache.get(dateString)!;
  }
  const formatted = new Date(dateString).toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: '2-digit'  // Add year to make dates unique across years
  });
  dateFormatCache.set(dateString, formatted);
  return formatted;
}

function precomputeChartData(stocks: StockData[]): Map<string, PrecomputedChartData> {
  const precomputed = new Map<string, PrecomputedChartData>();

  stocks.forEach(stock => {
    // Find IPO price (day 0 price)
    const ipoDataPoint = stock.data.find(d => d.date === stock.ipoDate);
    const ipoPrice = ipoDataPoint?.close || stock.data[0]?.close || 0;
    
    // Pre-compute chart data with percentage change from IPO
    const chartData = stock.data.map(point => {
      const pctChange = ipoPrice > 0 ? ((point.close - ipoPrice) / ipoPrice) * 100 : 0;
      return {
        date: point.date,
        dateShort: formatDateShort(point.date),
        close: point.close,
        volume: point.volume,
        pctChange: pctChange,
      };
    });

    // Calculate price range
    const prices = stock.data.map(d => d.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;
    const priceRangeObj = {
      min: Math.max(0, minPrice - priceRange * 0.1),
      max: maxPrice + priceRange * 0.1,
    };
    
    // Calculate percentage change range
    const pctChanges = chartData.map(d => d.pctChange);
    const minPctChange = Math.min(...pctChanges);
    const maxPctChange = Math.max(...pctChanges);
    const pctRange = maxPctChange - minPctChange;
    const pctRangeObj = {
      min: minPctChange - pctRange * 0.1,
      max: maxPctChange + pctRange * 0.1,
    };

    // Calculate volume range
    const volumes = stock.data.map(d => d.volume);
    const maxVol = Math.max(...volumes);
    const volumeRangeObj = {
      min: 0,
      max: maxVol * 1.1,
    };

    // Calculate stats
    const stats = {
      min: minPrice,
      max: maxPrice,
      current: stock.data[stock.data.length - 1]?.close || 0,
    };

    precomputed.set(stock.ticker, {
      ticker: stock.ticker,
      chartData,
      priceRange: priceRangeObj,
      volumeRange: volumeRangeObj,
      pctChangeRange: pctRangeObj,
      ipoPrice,
      stats,
    });
  });

  return precomputed;
}

// Worker message handler
self.addEventListener('message', (event: MessageEvent<{ stocks: StockData[] }>) => {
  try {
    const { stocks } = event.data;
    const precomputed = precomputeChartData(stocks);
    
    // Convert Map to object for serialization (Maps can't be directly serialized)
    const result: Record<string, PrecomputedChartData> = {};
    precomputed.forEach((value, key) => {
      result[key] = value;
    });
    
    self.postMessage({ success: true, data: result });
  } catch (error: any) {
    self.postMessage({ 
      success: false, 
      error: error?.message || 'Unknown error in precomputation worker' 
    });
  }
});

