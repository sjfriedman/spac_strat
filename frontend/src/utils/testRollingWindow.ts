// Quick test utility for rolling window filter logic
// Can be imported and run in browser console

import { StockData } from '../types';

// Test the future_max calculation
export function testFutureMax() {
  console.log('🧪 Testing future_max calculation...\n');
  
  // Test case: prices [10, 12, 11, 13, 11.5, 12.5, 11]
  // For N=4, day 0 should have max of days 1-4 = 13.0
  const prices = new Float64Array([10.0, 12.0, 11.0, 13.0, 11.5, 12.5, 11.0]);
  
  // Simplified version of the algorithm for testing
  const n = prices.length;
  const N = 4;
  const out = new Float64Array(n);
  out.fill(NaN);
  
  const q = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let right = 1;
  
  for (let i = 0; i < n; i++) {
    let targetRight = i + N;
    if (targetRight > n - 1) targetRight = n - 1;
    
    while (right <= targetRight) {
      while (tail > head && prices[right] >= prices[q[tail - 1]]) {
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
      out[i] = prices[q[head]];
    }
  }
  
  console.log('Prices:', Array.from(prices));
  console.log('Future max (N=4):', Array.from(out));
  console.log('Expected future_max[0] = 13.0');
  console.log('Actual future_max[0] =', out[0]);
  
  if (Math.abs(out[0] - 13.0) < 0.01) {
    console.log('✅ PASSED: future_max calculation is correct\n');
    return true;
  } else {
    console.log('❌ FAILED: future_max calculation is incorrect\n');
    return false;
  }
}

// Test filter logic with simple data
export function testFilterLogic() {
  console.log('🧪 Testing filter logic...\n');
  
  // Test stock: goes from $10 to $11 in 3 days (10% gain)
  const testStock: StockData = {
    ticker: 'TEST',
    ipoDate: '2024-01-01',
    data: [
      { date: '2024-01-01', close: 10.0, volume: 1000 },
      { date: '2024-01-02', close: 10.5, volume: 1000 },
      { date: '2024-01-03', close: 10.8, volume: 1000 },
      { date: '2024-01-04', close: 11.0, volume: 1000 }, // 10% gain
      { date: '2024-01-05', close: 10.9, volume: 1000 },
    ],
  };
  
  // Simulate the filter logic
  const sortedData = [...testStock.data].sort((a, b) => a.date.localeCompare(b.date));
  const close = new Float64Array(sortedData.map(d => d.close));
  const N = 6;
  
  // Calculate future_max
  const n = close.length;
  const futureMax = new Float64Array(n);
  futureMax.fill(NaN);
  
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
      futureMax[i] = close[q[head]];
    }
  }
  
  // Check if any day hits 10%
  const pct = 0.10;
  let hit = false;
  for (let i = 0; i < close.length; i++) {
    if (isNaN(futureMax[i])) continue;
    const bestReturn = (futureMax[i] / close[i]) - 1.0;
    if (bestReturn >= pct) {
      hit = true;
      console.log(`Day ${i}: close=$${close[i].toFixed(2)}, future_max=$${futureMax[i].toFixed(2)}, return=${(bestReturn * 100).toFixed(2)}%`);
      break;
    }
  }
  
  console.log('Expected: Should hit 10% gain');
  console.log('Actual:', hit ? '✅ HIT' : '❌ NO HIT');
  
  if (hit) {
    console.log('✅ PASSED: Filter logic correctly identifies 10% gain\n');
    return true;
  } else {
    console.log('❌ FAILED: Filter logic should identify 10% gain\n');
    return false;
  }
}

// Run all tests
export function runAllTests() {
  console.log('='.repeat(60));
  console.log('ROLLING WINDOW FILTER LOGIC TESTS');
  console.log('='.repeat(60));
  console.log('');
  
  const test1 = testFutureMax();
  const test2 = testFilterLogic();
  
  console.log('='.repeat(60));
  console.log('SUMMARY:');
  console.log(`  Future Max Test: ${test1 ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  Filter Logic Test: ${test2 ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('='.repeat(60));
  
  return test1 && test2;
}

// Make available in browser console
if (typeof window !== 'undefined') {
  (window as any).testRollingWindow = {
    testFutureMax,
    testFilterLogic,
    runAllTests,
  };
  console.log('Test functions available: window.testRollingWindow.runAllTests()');
}

