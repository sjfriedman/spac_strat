import { StockData, StockStatistics } from '../types';

export function calculateStatistics(stock: StockData): StockStatistics {
  if (stock.data.length === 0) {
    throw new Error('Stock has no data');
  }

  const ipoPrice = stock.data[0].close;
  const currentPrice = stock.data[stock.data.length - 1].close;
  const totalReturn = currentPrice - ipoPrice;
  const totalReturnPct = (totalReturn / ipoPrice) * 100;

  // Price stats
  const prices = stock.data.map(d => d.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  
  // Standard deviation
  const variance = prices.reduce((sum, price) => sum + Math.pow(price - avgPrice, 2), 0) / prices.length;
  const priceStdDev = Math.sqrt(variance);

  // Find peak and trough
  let peakPrice = prices[0];
  let peakDate = stock.data[0].date;
  let peakIndex = 0;
  let troughPrice = prices[0];
  let troughDate = stock.data[0].date;
  let troughIndex = 0;

  prices.forEach((price, idx) => {
    if (price > peakPrice) {
      peakPrice = price;
      peakDate = stock.data[idx].date;
      peakIndex = idx;
    }
    if (price < troughPrice) {
      troughPrice = price;
      troughDate = stock.data[idx].date;
      troughIndex = idx;
    }
  });

  // Calculate max drawdown
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let peak = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > peak) {
      peak = prices[i];
    } else {
      const drawdown = peak - prices[i];
      const drawdownPct = (drawdown / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPct = drawdownPct;
      }
    }
  }

  // Days to peak/trough
  const ipoDate = new Date(stock.ipoDate);
  const peakDateObj = new Date(peakDate);
  const troughDateObj = new Date(troughDate);
  const daysToPeak = Math.floor((peakDateObj.getTime() - ipoDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysToTrough = Math.floor((troughDateObj.getTime() - ipoDate.getTime()) / (1000 * 60 * 60 * 24));

  // Recovery days (days from trough to back above peak)
  let recoveryDays: number | null = null;
  if (troughIndex < peakIndex) {
    // Trough came after peak, check if recovered
    for (let i = troughIndex + 1; i < prices.length; i++) {
      if (prices[i] >= peakPrice) {
        const recoveryDate = new Date(stock.data[i].date);
        recoveryDays = Math.floor((recoveryDate.getTime() - troughDateObj.getTime()) / (1000 * 60 * 60 * 24));
        break;
      }
    }
  }

  // Volatility (annualized)
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const dailyReturn = (prices[i] - prices[i - 1]) / prices[i - 1];
    returns.push(dailyReturn);
  }
  
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const returnVariance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
  const dailyVolatility = Math.sqrt(returnVariance);
  const volatility = dailyVolatility * Math.sqrt(252); // Annualized

  // Volume stats
  const volumes = stock.data.map(d => d.volume);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const maxVolume = Math.max(...volumes);
  const currentVolume = volumes[volumes.length - 1];
  
  // Count volume spikes (> 2x average)
  const volumeSpikes = volumes.filter(v => v > avgVolume * 2).length;

  // Time stats
  const totalDays = stock.data.length;
  const lastDate = new Date(stock.data[stock.data.length - 1].date);
  const daysSinceIPO = Math.floor((lastDate.getTime() - ipoDate.getTime()) / (1000 * 60 * 60 * 24));

  // Days above/below IPO
  const daysAboveIPO = prices.filter(p => p > ipoPrice).length;
  const daysBelowIPO = prices.filter(p => p < ipoPrice).length;

  return {
    ipoPrice,
    currentPrice,
    totalReturn,
    totalReturnPct,
    minPrice,
    maxPrice,
    avgPrice,
    priceStdDev,
    maxDrawdown,
    maxDrawdownPct,
    daysToPeak,
    daysToTrough,
    recoveryDays,
    volatility,
    dailyVolatility,
    avgVolume,
    maxVolume,
    currentVolume,
    volumeSpikes,
    totalDays,
    daysSinceIPO,
    daysAboveIPO,
    daysBelowIPO,
    peakPrice,
    peakDate,
    troughPrice,
    troughDate,
  };
}

