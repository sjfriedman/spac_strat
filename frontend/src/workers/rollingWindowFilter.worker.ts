import { StockData, MatchingWindow } from '../types';

// Cache for formatted date strings
const dateFormatCache = new Map<string, string>();

function formatDateShort(dateString: string): string {
  if (dateFormatCache.has(dateString)) {
    return dateFormatCache.get(dateString)!;
  }
  const formatted = new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  dateFormatCache.set(dateString, formatted);
  return formatted;
}

// Port future_window_max_exclusive_numba to JavaScript
// Finds max price in forward window [i+1, i+N] using deque algorithm
function futureWindowMaxExclusive(close: Float64Array, N: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  
  if (N <= 0 || n === 0) return out;
  
  // Manual deque via TypedArray + head/tail pointers
  const q = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let right = 1; // next j to add
  
  for (let i = 0; i < n; i++) {
    // Extend window up to i+N
    let targetRight = i + N;
    if (targetRight > n - 1) targetRight = n - 1;
    
    while (right <= targetRight) {
      // Maintain decreasing close[q[*]]
      while (tail > head && close[right] >= close[q[tail - 1]]) {
        tail--;
      }
      q[tail] = right;
      tail++;
      right++;
    }
    
    // Drop indices not in (i, i+N]
    while (tail > head && q[head] <= i) {
      head++;
    }
    
    if (tail > head) {
      out[i] = close[q[head]];
    }
  }
  
  return out;
}

// Port future_window_min_exclusive for "down" direction
// Finds min price in forward window [i+1, i+N] using deque algorithm
function futureWindowMinExclusive(close: Float64Array, N: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  
  if (N <= 0 || n === 0) return out;
  
  // Manual deque via TypedArray + head/tail pointers (for minimum, maintain increasing order)
  const q = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let right = 1; // next j to add
  
  for (let i = 0; i < n; i++) {
    // Extend window up to i+N
    let targetRight = i + N;
    if (targetRight > n - 1) targetRight = n - 1;
    
    while (right <= targetRight) {
      // Maintain increasing close[q[*]] (for minimum)
      while (tail > head && close[right] <= close[q[tail - 1]]) {
        tail--;
      }
      q[tail] = right;
      tail++;
      right++;
    }
    
    // Drop indices not in (i, i+N]
    while (tail > head && q[head] <= i) {
      head++;
    }
    
    if (tail > head) {
      out[i] = close[q[head]];
    }
  }
  
  return out;
}

// Port add_up_within_n_days_flag
// Returns matching tickers and hit flags for each row
function addUpWithinNDaysFlag(
  stocks: StockData[],
  N: number,
  pct: number,
  direction: 'up' | 'down'
): { matchingTickers: string[], tickerHitMap: Map<string, boolean> } {
  const tickerHitMap = new Map<string, boolean>();
  
  // Process each stock
  for (const stock of stocks) {
    if (stock.data.length < 2) {
      tickerHitMap.set(stock.ticker, false);
      continue;
    }
    
    // Ensure data is sorted by date
    const sortedData = [...stock.data].sort((a, b) => a.date.localeCompare(b.date));
    
    // Convert to TypedArray
    const close = new Float64Array(sortedData.map(d => d.close));
    
    // Compute future_max for 'up' or future_min for 'down'
    let hit = false;
    if (direction === 'up') {
      const futureMax = futureWindowMaxExclusive(close, N);
      // Compute best_return = future_max / close - 1
      for (let i = 0; i < close.length; i++) {
        if (isNaN(futureMax[i])) continue;
        const bestReturn = (futureMax[i] / close[i]) - 1.0;
        if (bestReturn >= pct) {
          hit = true;
          break;
        }
      }
    } else {
      // For 'down', use future_min
      const futureMin = futureWindowMinExclusive(close, N);
      // Compute worst_return = future_min / close - 1
      for (let i = 0; i < close.length; i++) {
        if (isNaN(futureMin[i])) continue;
        const worstReturn = (futureMin[i] / close[i]) - 1.0;
        // Use small epsilon for floating point comparison
        if (worstReturn <= -pct + 1e-10) {
          hit = true;
          break;
        }
      }
    }
    
    tickerHitMap.set(stock.ticker, hit);
  }
  
  // Get matching tickers
  const matchingTickers: string[] = [];
  tickerHitMap.forEach((hit, ticker) => {
    if (hit) {
      matchingTickers.push(ticker);
    }
  });
  
  return { matchingTickers, tickerHitMap };
}

// Port find_up_cycles_one_ticker_chainable
// Finds chainable cycles for highlighting
// Supports both 'up' and 'down' directions
function findUpCyclesOneTickerChainable(
  close: Float64Array,
  N: number,
  pct: number,
  direction: 'up' | 'down'
): { starts: number[], ends: number[] } {
  const n = close.length;
  const starts: number[] = [];
  const ends: number[] = [];
  
  let i = 0;
  while (i < n - 1) {
    const c0 = close[i];
    if (c0 <= 0.0) {
      i++;
      continue;
    }
    
    const target = direction === 'up' 
      ? c0 * (1.0 + pct)  // For up: target is higher (c0 * 1.10 for 10%)
      : c0 * (1.0 - pct); // For down: target is lower (c0 * 0.90 for 10% drop)
    
    let maxJ = i + N;
    if (maxJ > n - 1) {
      maxJ = n - 1;
    }
    
    let hitJ = -1;
    let j = i + 1;
    while (j <= maxJ) {
      if (direction === 'up' && close[j] >= target) {
        hitJ = j;
        break;
      } else if (direction === 'down' && close[j] <= target) {
        hitJ = j;
        break;
      }
      j++;
    }
    
    if (hitJ !== -1) {
      starts.push(i);
      ends.push(hitJ);
      i = hitJ; // chainable (start immediately on hit day)
    } else {
      i++;
    }
  }
  
  return { starts, ends };
}

// Port compute_up_cycles_df
// Computes cycles for all matching tickers
// Returns cycles with ticker information included
function computeUpCycles(
  stocks: StockData[],
  matchingTickers: string[],
  N: number,
  pct: number,
  direction: 'up' | 'down'
): Array<MatchingWindow & { ticker: string }> {
  const cycles: Array<MatchingWindow & { ticker: string }> = [];
  
  // Create a map for quick lookup
  const stockMap = new Map<string, StockData>();
  stocks.forEach(stock => {
    stockMap.set(stock.ticker, stock);
  });
  
  // Process each matching ticker
  for (const ticker of matchingTickers) {
    const stock = stockMap.get(ticker);
    if (!stock || stock.data.length < 2) continue;
    
    // Sort data by date to ensure correct order
    const sortedData = [...stock.data].sort((a, b) => a.date.localeCompare(b.date));
    
    // Convert to TypedArray
    const close = new Float64Array(sortedData.map(d => d.close));
    
    // Find cycles
    const { starts, ends } = findUpCyclesOneTickerChainable(close, N, pct, direction);
    
    // Convert to MatchingWindow format
    for (let idx = 0; idx < starts.length; idx++) {
      const startIdx = starts[idx];
      const endIdx = ends[idx];
      
      if (startIdx >= sortedData.length || endIdx >= sortedData.length) continue;
      
      const startDataPoint = sortedData[startIdx];
      const endDataPoint = sortedData[endIdx];
      const startClose = close[startIdx];
      const endClose = close[endIdx];
      
      if (startClose <= 0) continue;
      
      const percentChange = ((endClose - startClose) / startClose) * 100;
      
      cycles.push({
        ticker,
        startIdx,
        endIdx,
        startDate: startDataPoint.date,
        endDate: endDataPoint.date,
        startDateShort: formatDateShort(startDataPoint.date),
        endDateShort: formatDateShort(endDataPoint.date),
        actualDays: endIdx - startIdx,
        percentChange,
      });
    }
  }
  
  // Sort by ticker and start date
  cycles.sort((a, b) => {
    if (a.ticker !== b.ticker) {
      return a.ticker.localeCompare(b.ticker);
    }
    return a.startDate.localeCompare(b.startDate);
  });
  
  return cycles;
}

// Verification function for testing
function verifyLogic() {
  console.log('🧪 Verifying rolling window filter logic...\n');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: future_max calculation
  console.log('Test 1: future_max calculation');
  const prices = new Float64Array([10.0, 12.0, 11.0, 13.0, 11.5, 12.5, 11.0]);
  const futureMax = futureWindowMaxExclusive(prices, 4);
  const expectedMax = 13.0;
  
  if (Math.abs(futureMax[0] - expectedMax) < 0.01) {
    console.log('  ✅ PASSED: future_max[0] =', futureMax[0]);
    testsPassed++;
  } else {
    console.log(`  ❌ FAILED: got ${futureMax[0]}, expected ${expectedMax}`);
    testsFailed++;
  }
  
  // Test 2: future_min calculation
  console.log('\nTest 2: future_min calculation');
  const prices2 = new Float64Array([10.0, 9.5, 9.0, 8.5, 9.2, 9.8, 10.0]);
  const futureMin = futureWindowMinExclusive(prices2, 4);
  const expectedMin = 8.5; // Min of days 1-4
  
  if (Math.abs(futureMin[0] - expectedMin) < 0.01) {
    console.log('  ✅ PASSED: future_min[0] =', futureMin[0]);
    testsPassed++;
  } else {
    console.log(`  ❌ FAILED: got ${futureMin[0]}, expected ${expectedMin}`);
    testsFailed++;
  }
  
  // Test 3: Simple filter test (up direction)
  console.log('\nTest 3: Filter logic (up direction - 10% gain)');
  const testStock: StockData = {
    ticker: 'TEST',
    ipoDate: '2024-01-01',
    data: [
      { date: '2024-01-01', close: 10.0, volume: 1000 },
      { date: '2024-01-02', close: 10.5, volume: 1000 },
      { date: '2024-01-03', close: 10.8, volume: 1000 },
      { date: '2024-01-04', close: 11.0, volume: 1000 }, // 10% gain
    ],
  };
  
  const result = addUpWithinNDaysFlag([testStock], 6, 0.10, 'up');
  if (result.matchingTickers.includes('TEST')) {
    console.log('  ✅ PASSED: Correctly identifies 10% gain');
    testsPassed++;
  } else {
    console.log('  ❌ FAILED: Should match 10% gain');
    testsFailed++;
  }
  
  // Test 4: Filter test (down direction)
  console.log('\nTest 4: Filter logic (down direction - 10% drop)');
  const testStockDown: StockData = {
    ticker: 'TEST_DOWN',
    ipoDate: '2024-01-01',
    data: [
      { date: '2024-01-01', close: 10.0, volume: 1000 },
      { date: '2024-01-02', close: 9.5, volume: 1000 },
      { date: '2024-01-03', close: 9.0, volume: 1000 }, // -10% drop
    ],
  };
  
  const resultDown = addUpWithinNDaysFlag([testStockDown], 6, 0.10, 'down');
  if (resultDown.matchingTickers.includes('TEST_DOWN')) {
    console.log('  ✅ PASSED: Correctly identifies -10% drop');
    testsPassed++;
  } else {
    console.log('  ❌ FAILED: Should match -10% drop');
    testsFailed++;
  }
  
  // Test 5: Stock that doesn't hit target
  console.log('\nTest 5: Stock that doesn\'t hit target');
  const testStockNoHit: StockData = {
    ticker: 'NO_HIT',
    ipoDate: '2024-01-01',
    data: [
      { date: '2024-01-01', close: 10.0, volume: 1000 },
      { date: '2024-01-02', close: 10.2, volume: 1000 },
      { date: '2024-01-03', close: 10.3, volume: 1000 },
      { date: '2024-01-04', close: 10.5, volume: 1000 }, // Only 5% gain
    ],
  };
  
  const resultNoHit = addUpWithinNDaysFlag([testStockNoHit], 6, 0.10, 'up');
  if (!resultNoHit.matchingTickers.includes('NO_HIT')) {
    console.log('  ✅ PASSED: Correctly excludes 5% gain');
    testsPassed++;
  } else {
    console.log('  ❌ FAILED: Should exclude 5% gain');
    testsFailed++;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`Verification Summary: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('='.repeat(60) + '\n');
}

// Worker message handler
self.addEventListener('message', (event: MessageEvent<{
  stocks: StockData[];
  targetPercent: number;
  maxDays: number;
  direction: 'up' | 'down';
  test?: boolean; // Optional test flag
}>) => {
  try {
    // Handle test request
    if (event.data.test) {
      verifyLogic();
      self.postMessage({ success: true, test: true });
      return;
    }
    
    const { stocks, targetPercent, maxDays, direction } = event.data;
    
    // Run filter to get matching tickers
    const { matchingTickers } = addUpWithinNDaysFlag(
      stocks,
      maxDays,
      targetPercent,
      direction
    );
    
    // Compute cycles for matching tickers
    const cycles = computeUpCycles(stocks, matchingTickers, maxDays, targetPercent, direction);
    
    // Group cycles by ticker for easier processing
    const cyclesByTicker = new Map<string, MatchingWindow[]>();
    cycles.forEach(cycle => {
      if (!cyclesByTicker.has(cycle.ticker)) {
        cyclesByTicker.set(cycle.ticker, []);
      }
      // Remove ticker from cycle before adding (MatchingWindow doesn't have ticker field)
      const { ticker, ...cycleWithoutTicker } = cycle;
      cyclesByTicker.get(cycle.ticker)!.push(cycleWithoutTicker as MatchingWindow);
    });
    
    // Convert Map to array of objects for serialization
    const cyclesArray: Array<{ ticker: string; cycles: MatchingWindow[] }> = [];
    cyclesByTicker.forEach((cycles, ticker) => {
      cyclesArray.push({ ticker, cycles });
    });
    
    // Send results back
    self.postMessage({
      success: true,
      matchingTickers,
      cyclesByTicker: cyclesArray,
    });
  } catch (error: any) {
    self.postMessage({
      success: false,
      error: error?.message || 'Unknown error in rolling window filter worker',
      matchingTickers: [],
      cycles: [],
    });
  }
});

