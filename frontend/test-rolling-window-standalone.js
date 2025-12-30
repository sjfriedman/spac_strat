// Standalone test runner for rolling window filter logic
// Can be run with: node test-rolling-window-standalone.js

// Simplified versions of the functions for testing (without TypeScript types)

function futureWindowMaxExclusive(close, N) {
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

function futureWindowMinExclusive(close, N) {
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
      while (tail > head && close[right] <= close[q[tail - 1]]) {
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

function testFilterLogic(stockData, N, pct, direction) {
  if (stockData.length < 2) return false;
  
  const sortedData = [...stockData].sort((a, b) => a.date.localeCompare(b.date));
  const close = new Float64Array(sortedData.map(d => d.close));
  
  let hit = false;
  if (direction === 'up') {
    const futureMax = futureWindowMaxExclusive(close, N);
    for (let i = 0; i < close.length; i++) {
      if (isNaN(futureMax[i])) continue;
      const bestReturn = (futureMax[i] / close[i]) - 1.0;
      if (bestReturn >= pct) {
        hit = true;
        break;
      }
    }
  } else {
    const futureMin = futureWindowMinExclusive(close, N);
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
  
  return hit;
}

// Test cases
console.log('🧪 Running Rolling Window Filter Logic Tests...\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

// Test 1: future_max calculation
console.log('\nTest 1: future_max calculation');
const prices1 = new Float64Array([10.0, 12.0, 11.0, 13.0, 11.5, 12.5, 11.0]);
const futureMax1 = futureWindowMaxExclusive(prices1, 4);
const expected1 = 13.0;
const actual1 = futureMax1[0];
if (Math.abs(actual1 - expected1) < 0.01) {
  console.log(`  ✅ PASSED: future_max[0] = ${actual1.toFixed(2)} (expected ${expected1})`);
  passed++;
} else {
  console.log(`  ❌ FAILED: got ${actual1.toFixed(2)}, expected ${expected1}`);
  failed++;
}

// Test 2: future_min calculation
console.log('\nTest 2: future_min calculation');
const prices2 = new Float64Array([10.0, 9.5, 9.0, 8.5, 9.2, 9.8, 10.0]);
const futureMin2 = futureWindowMinExclusive(prices2, 4);
const expected2 = 8.5;
const actual2 = futureMin2[0];
if (Math.abs(actual2 - expected2) < 0.01) {
  console.log(`  ✅ PASSED: future_min[0] = ${actual2.toFixed(2)} (expected ${expected2})`);
  passed++;
} else {
  console.log(`  ❌ FAILED: got ${actual2.toFixed(2)}, expected ${expected2}`);
  failed++;
}

// Test 3: Up direction - 10% gain
console.log('\nTest 3: Filter logic (up direction - 10% gain)');
const testStock3 = [
  { date: '2024-01-01', close: 10.0 },
  { date: '2024-01-02', close: 10.5 },
  { date: '2024-01-03', close: 10.8 },
  { date: '2024-01-04', close: 11.0 }, // 10% gain
];
const result3 = testFilterLogic(testStock3, 6, 0.10, 'up');
if (result3) {
  console.log('  ✅ PASSED: Correctly identifies 10% gain');
  passed++;
} else {
  console.log('  ❌ FAILED: Should match 10% gain');
  failed++;
}

// Test 4: Down direction - 10% drop
console.log('\nTest 4: Filter logic (down direction - 10% drop)');
const testStock4 = [
  { date: '2024-01-01', close: 10.0 },
  { date: '2024-01-02', close: 9.5 },
  { date: '2024-01-03', close: 9.0 }, // -10% drop
];
const result4 = testFilterLogic(testStock4, 6, 0.10, 'down');
if (result4) {
  console.log('  ✅ PASSED: Correctly identifies -10% drop');
  passed++;
} else {
  console.log('  ❌ FAILED: Should match -10% drop');
  failed++;
}

// Test 5: Stock that doesn't hit target
console.log('\nTest 5: Stock that doesn\'t hit target (5% gain, threshold 10%)');
const testStock5 = [
  { date: '2024-01-01', close: 10.0 },
  { date: '2024-01-02', close: 10.2 },
  { date: '2024-01-03', close: 10.3 },
  { date: '2024-01-04', close: 10.5 }, // Only 5% gain
];
const result5 = testFilterLogic(testStock5, 6, 0.10, 'up');
if (!result5) {
  console.log('  ✅ PASSED: Correctly excludes 5% gain');
  passed++;
} else {
  console.log('  ❌ FAILED: Should exclude 5% gain');
  failed++;
}

// Test 6: Edge case - gain happens on last day
console.log('\nTest 6: Gain happens on last day of window');
const testStock6 = [
  { date: '2024-01-01', close: 10.0 },
  { date: '2024-01-02', close: 10.2 },
  { date: '2024-01-03', close: 10.5 },
  { date: '2024-01-04', close: 10.8 },
  { date: '2024-01-05', close: 11.0 }, // 10% gain on day 4 (within 6-day window)
];
const result6 = testFilterLogic(testStock6, 6, 0.10, 'up');
if (result6) {
  console.log('  ✅ PASSED: Correctly identifies gain at end of window');
  passed++;
} else {
  console.log('  ❌ FAILED: Should match gain at end of window');
  failed++;
}

// Test 7: Multiple gains - should catch first one
console.log('\nTest 7: Multiple gains within window');
const testStock7 = [
  { date: '2024-01-01', close: 10.0 },
  { date: '2024-01-02', close: 11.0 }, // 10% gain on day 1
  { date: '2024-01-03', close: 10.5 },
  { date: '2024-01-04', close: 12.0 }, // 20% gain from day 0
];
const result7 = testFilterLogic(testStock7, 6, 0.10, 'up');
if (result7) {
  console.log('  ✅ PASSED: Correctly identifies multiple gains');
  passed++;
} else {
  console.log('  ❌ FAILED: Should match when multiple gains exist');
  failed++;
}

// Summary
console.log('\n' + '='.repeat(60));
console.log(`Test Summary: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Please review the output above.');
  process.exit(1);
}

