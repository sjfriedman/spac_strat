import { TechnicalIndicators } from '../types';

export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(NaN);
    } else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

export function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  // Calculate price changes
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  // Calculate initial average gain and loss
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // First RSI values are NaN
  for (let i = 0; i < period; i++) {
    rsi.push(NaN);
  }

  // Calculate RSI for remaining periods
  for (let i = period; i < prices.length; i++) {
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      const rsiValue = 100 - (100 / (1 + rs));
      rsi.push(rsiValue);
    }

    // Update averages using Wilder's smoothing
    if (i < gains.length) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
  }

  return rsi;
}

export function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  if (prices.length < period) {
    // Not enough data
    return prices.map(() => NaN);
  }
  
  // First value is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
    ema.push(NaN);
  }
  
  const initialEMA = sum / period;
  ema[period - 1] = initialEMA;
  
  // Calculate EMA for remaining values
  for (let i = period; i < prices.length; i++) {
    const currentEMA = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
    ema.push(currentEMA);
  }
  
  return ema;
}

export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);
  
  const macd: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (isNaN(fastEMA[i]) || isNaN(slowEMA[i])) {
      macd.push(NaN);
    } else {
      macd.push(fastEMA[i] - slowEMA[i]);
    }
  }
  
  // Calculate signal line: EMA of MACD line
  // Find first non-NaN MACD value
  let firstMacdIdx = -1;
  for (let i = 0; i < macd.length; i++) {
    if (!isNaN(macd[i])) {
      firstMacdIdx = i;
      break;
    }
  }
  
  if (firstMacdIdx === -1) {
    return {
      macd,
      signal: macd.map(() => NaN),
      histogram: macd.map(() => NaN),
    };
  }
  
  // Extract non-NaN MACD values for signal calculation
  const macdValues = macd.slice(firstMacdIdx);
  const signalEMA = calculateEMA(macdValues, signalPeriod);
  
  // Build signal array, padding with NaNs at the start
  const signal: number[] = [];
  for (let i = 0; i < firstMacdIdx; i++) {
    signal.push(NaN);
  }
  for (let i = 0; i < signalEMA.length; i++) {
    signal.push(signalEMA[i]);
  }
  
  const histogram: number[] = [];
  for (let i = 0; i < macd.length; i++) {
    if (isNaN(macd[i]) || isNaN(signal[i])) {
      histogram.push(NaN);
    } else {
      histogram.push(macd[i] - signal[i]);
    }
  }
  
  return {
    macd,
    signal,
    histogram,
  };
}

export function calculateTechnicalIndicators(prices: number[]): TechnicalIndicators {
  return {
    sma20: calculateSMA(prices, 20),
    sma50: calculateSMA(prices, 50),
    sma200: calculateSMA(prices, 200),
    rsi: calculateRSI(prices, 14),
    macd: calculateMACD(prices, 12, 26, 9),
  };
}

