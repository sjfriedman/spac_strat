// Test file to verify rolling window filter logic
// This can be run in browser console or as a test

import { StockData } from '../types';

// Copy the worker functions for testing (without worker context)
function futureWindowMaxExclusive(close: Float64Array, N: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  
  if (N <= 0 || n === 0) return out;
  
  const q = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let right = 1;
  
  for (let i = 0; i < n; i++) {
    let targetRight = i + N;
    if (targetRight > n - 1) targetRight = n - 1;
    
    while (right <= targetRight) {
      while (tail > head && close[right] >= close[q[tail - 1]]) {
        tail--;
      }
      q[tail] = right;
      tail++;
      right++;
    }
    
    while (tail > head && q[head] <= i) {
      head++;
    }
    
    if (tail > head) {
      out[i] = close[q[head]];
    }
  }
  
  return out;
}

function addUpWithinNDaysFlag(
  stocks: StockData[],
  N: number,
  pct: number,
  direction: 'up' | 'down'
): { matchingTickers: string[], tickerHitMap: Map<string, boolean> } {
  const tickerHitMap = new Map<string, boolean>();
  
  for (const stock of stocks) {
    if (stock.data.length < 2) {
      tickerHitMap.set(stock.ticker, false);
      continue;
    }
    
    const sortedData = [...stock.data].sort((a, b) => a.date.localeCompare(b.date));
    const close = new Float64Array(sortedData.map(d => d.close));
    const futureMax = futureWindowMaxExclusive(close, N);
    
    let hit = false;
    for (let i = 0; i < close.length; i++) {
      if (isNaN(futureMax[i])) continue;
      
      const bestReturn = (futureMax[i] / close[i]) - 1.0;
      
      if (direction === 'up' && bestReturn >= pct) {
        hit = true;
        break;
      } else if (direction === 'down' && bestReturn <= -pct) {
        hit = true;
        break;
      }
    }
    
    tickerHitMap.set(stock.ticker, hit);
  }
  
  const matchingTickers: string[] = [];
  tickerHitMap.forEach((hit, ticker) => {
    if (hit) {
      matchingTickers.push(ticker);
    }
  });
  
  return { matchingTickers, tickerHitMap };
}

// Test cases
export function runTests() {
  console.log('🧪 Running Rolling Window Filter Tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: Simple 10% gain within 6 days
  console.log('Test 1: Simple 10% gain within 6 days');
  const testStock1: StockData = {
    ticker: 'TEST1',
    ipoDate: '2024-01-01',
    data: [
      { date: '2024-01-01', close: 10.0, volume: 1000 },
      { date: '2024-01-02', close: 10.5, volume: 1000 },
      { date: '2024-01-03', close: 10.8, volume: 1000 },
      { date: '2024-01-04', close: 11.0, volume: 1000 }, // 10% gain from day 0
      { date: '2024-01-05', close: 10.9, volume: 1000 },
    ],
  };
  
  const result1 = addUpWithinNDaysFlag([testStock1], 6, 0.10, 'up');
  if (result1.matchingTickers.includes('TEST1')) {
    console.log('✅ PASSED: Correctly identifies 10% gain');
    passed++;
  } else {
    console.log('❌ FAILED: Should identify 10% gain');
    failed++;
  }
  
  // Test 2: Stock that doesn't hit target
  console.log('\nTest 2: Stock that doesn\'t hit target');
  const testStock2: StockData = {
    ticker: 'TEST2',
    ipoDate: '2024-01-01',
    data: [
      { date: '2024-01-01', close: 10.0, volume: 1000 },
      { date: '2024-01-02', close: 10.2, volume: 1000 },
      { date: '2024-01-03', close: 10.3, volume: 1000 },
      { date: '2024-01-04', close: 10.4, volume: 1000 },
      { date: '2024-01-05', close: 10.5, volume: 1000 }, // Only 5% gain
    ],
  };
  
  const result2 = addUpWithinNDaysFlag([testStock2], 6, 0.10, 'up');
  if (!result2.matchingTickers.includes('TEST2')) {
    console.log('✅ PASSED: Correctly excludes stock that doesn\'t hit target');
    passed++;
  } else {
    console.log('❌ FAILED: Should exclude stock with only 5% gain');
    failed++;
  }
  
  // Test 3: Verify future_max calculation
  console.log('\nTest 3: Verify future_max calculation');
  const prices = new Float64Array([10.0, 12.0, 11.0, 13.0, 11.5, 12.5, 11.0]);
  const futureMax = futureWindowMaxExclusive(prices, 4);
  
  // Day 0: max of days 1-4 should be 13.0
  if (Math.abs(futureMax[0] - 13.0) < 0.01) {
    console.log('✅ PASSED: future_max[0] correctly finds max in forward window');
    passed++;
  } else {
    console.log(`❌ FAILED: future_max[0] = ${futureMax[0]}, expected 13.0`);
    failed++;
  }
  
  // Test 4: Down direction
  console.log('\nTest 4: Down direction (-10%)');
  const testStock4: StockData = {
    ticker: 'TEST4',
    ipoDate: '2024-01-01',
    data: [
      { date: '2024-01-01', close: 10.0, volume: 1000 },
      { date: '2024-01-02', close: 9.5, volume: 1000 },
      { date: '2024-01-03', close: 9.0, volume: 1000 }, // -10% from day 0
      { date: '2024-01-04', close: 9.2, volume: 1000 },
    ],
  };
  
  const result4 = addUpWithinNDaysFlag([testStock4], 6, 0.10, 'down');
  if (result4.matchingTickers.includes('TEST4')) {
    console.log('✅ PASSED: Correctly identifies -10% drop');
    passed++;
  } else {
    console.log('❌ FAILED: Should identify -10% drop');
    failed++;
  }
  
  // Test 5: Multiple tickers
  console.log('\nTest 5: Multiple tickers');
  const testStocks5: StockData[] = [
    {
      ticker: 'HIT',
      ipoDate: '2024-01-01',
      data: [
        { date: '2024-01-01', close: 10.0, volume: 1000 },
        { date: '2024-01-02', close: 11.0, volume: 1000 }, // 10% gain
      ],
    },
    {
      ticker: 'NO_HIT',
      ipoDate: '2024-01-01',
      data: [
        { date: '2024-01-01', close: 10.0, volume: 1000 },
        { date: '2024-01-02', close: 10.5, volume: 1000 }, // Only 5% gain
      ],
    },
  ];
  
  const result5 = addUpWithinNDaysFlag(testStocks5, 6, 0.10, 'up');
  if (result5.matchingTickers.includes('HIT') && !result5.matchingTickers.includes('NO_HIT')) {
    console.log('✅ PASSED: Correctly handles multiple tickers');
    passed++;
  } else {
    console.log('❌ FAILED: Multiple ticker handling incorrect');
    failed++;
  }
  
  // Test 6: Edge case - single data point
  console.log('\nTest 6: Edge case - single data point');
  const testStock6: StockData = {
    ticker: 'SINGLE',
    ipoDate: '2024-01-01',
    data: [
      { date: '2024-01-01', close: 10.0, volume: 1000 },
    ],
  };
  
  const result6 = addUpWithinNDaysFlag([testStock6], 6, 0.10, 'up');
  if (!result6.matchingTickers.includes('SINGLE')) {
    console.log('✅ PASSED: Correctly handles single data point');
    passed++;
  } else {
    console.log('❌ FAILED: Should not match single data point');
    failed++;
  }
  
  // Test 7: Edge case - empty data
  console.log('\nTest 7: Edge case - empty data');
  const testStock7: StockData = {
    ticker: 'EMPTY',
    ipoDate: '2024-01-01',
    data: [],
  };
  
  const result7 = addUpWithinNDaysFlag([testStock7], 6, 0.10, 'up');
  if (!result7.matchingTickers.includes('EMPTY')) {
    console.log('✅ PASSED: Correctly handles empty data');
    passed++;
  } else {
    console.log('❌ FAILED: Should not match empty data');
    failed++;
  }
  
  // Test 8: Verify best_return calculation
  console.log('\nTest 8: Verify best_return calculation');
  const testStock8: StockData = {
    ticker: 'RETURN_TEST',
    ipoDate: '2024-01-01',
    data: [
      { date: '2024-01-01', close: 10.0, volume: 1000 },
      { date: '2024-01-02', close: 12.0, volume: 1000 }, // 20% gain
      { date: '2024-01-03', close: 11.0, volume: 1000 },
    ],
  };
  
  const sortedData8 = [...testStock8.data].sort((a, b) => a.date.localeCompare(b.date));
  const close8 = new Float64Array(sortedData8.map(d => d.close));
  const futureMax8 = futureWindowMaxExclusive(close8, 2);
  const bestReturn8 = (futureMax8[0] / close8[0]) - 1.0;
  
  if (Math.abs(bestReturn8 - 0.20) < 0.001) {
    console.log('✅ PASSED: best_return correctly calculated as 20%');
    passed++;
  } else {
    console.log(`❌ FAILED: best_return = ${bestReturn8}, expected 0.20`);
    failed++;
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`Test Summary: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));
  
  return { passed, failed };
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  (window as any).testRollingWindowFilter = runTests;
}

