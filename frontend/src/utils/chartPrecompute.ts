import { StockData, PrecomputedChartData } from '../types';

export function precomputeChartData(stocks: StockData[]): Map<string, PrecomputedChartData> {
  const precomputed = new Map<string, PrecomputedChartData>();

  stocks.forEach(stock => {
    // Calculate max volume for scaling
    const maxVolume = Math.max(...stock.data.map(d => d.volume));
    
    // Find IPO price (day 0 price)
    const ipoDataPoint = stock.data.find(d => d.date === stock.ipoDate);
    const ipoPrice = ipoDataPoint?.close || stock.data[0]?.close || 0;
    
    // Pre-compute chart data with percentage change from IPO
    const chartData = stock.data.map(point => {
      const pctChange = ipoPrice > 0 ? ((point.close - ipoPrice) / ipoPrice) * 100 : 0;
      return {
        date: point.date,
        dateShort: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
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

