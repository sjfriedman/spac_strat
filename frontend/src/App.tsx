import { useState, useEffect, useCallback, useMemo } from 'react';
import { StockData, SPACEvent } from './types';
import { loadStockData } from './utils/dataLoader';
import { getFavorites, toggleFavorite, getLocked, toggleLocked, clearStockDataCache } from './utils/storage';
import { precomputeChartData } from './utils/chartPrecompute';
import { preloadSPACEvents, getSPACEventsForTicker } from './utils/spacEvents';
import StockChart from './components/StockChart';
import StockDetailModal from './components/StockDetailModal';
import ResetButton from './components/ResetButton';

function App() {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [filterDirection, setFilterDirection] = useState<'up' | 'down' | null>(null);
  const [filterPercent, setFilterPercent] = useState<number>(0);
  const [filterPercentInput, setFilterPercentInput] = useState<string>('');
  const [filterHistoric, setFilterHistoric] = useState<boolean>(false);
  const [filterIpoDateDirection, setFilterIpoDateDirection] = useState<'before' | 'after' | null>(null);
  const [filterIpoDate, setFilterIpoDate] = useState<string>('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const [showNoDataWarning, setShowNoDataWarning] = useState<boolean>(false);
  const [spacEventsMap, setSpacEventsMap] = useState<Map<string, SPACEvent[]>>(new Map());
  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [chartPositions, setChartPositions] = useState<Array<{ ticker: string; locked: boolean; starred: boolean }>>([
    { ticker: '', locked: false, starred: false },
    { ticker: '', locked: false, starred: false },
    { ticker: '', locked: false, starred: false },
    { ticker: '', locked: false, starred: false },
  ]);

  // Pre-compute all chart data once when stocks load
  const precomputedCharts = useMemo(() => {
    if (!stocks || stocks.length === 0) return new Map();
    return precomputeChartData(stocks);
  }, [stocks]);

  // Filter stocks based on percentage change from IPO and IPO date
  const filteredStocks = useMemo(() => {
    // If favorites only is enabled, ignore all other filters and just show favorites
    if (showFavoritesOnly) {
      return stocks.filter(stock => favorites.has(stock.ticker));
    }

    let result = stocks;

    // Apply percentage filter
    if (filterDirection && filterPercent > 0) {
      result = result.filter(stock => {
        if (stock.data.length === 0) return false;
        
        const ipoPrice = precomputedCharts?.get(stock.ticker)?.ipoPrice || stock.data[0].close;
        
        if (filterHistoric) {
          // Check historic: was the stock EVER up/down by X% at any point in history
          if (filterDirection === 'up') {
            // Check if stock was EVER up X% (max price >= IPO * (1 + X/100))
            const maxPrice = Math.max(...stock.data.map(d => d.close));
            const maxPercentChange = ((maxPrice - ipoPrice) / ipoPrice) * 100;
            return maxPercentChange >= filterPercent;
          } else {
            // Check if stock was EVER down X% (min price <= IPO * (1 - X/100))
            const minPrice = Math.min(...stock.data.map(d => d.close));
            const minPercentChange = ((minPrice - ipoPrice) / ipoPrice) * 100;
            return minPercentChange <= -filterPercent;
          }
        } else {
          // Check current: is the stock currently up/down by X%
          const currentPrice = stock.data[stock.data.length - 1].close;
          const percentChange = ((currentPrice - ipoPrice) / ipoPrice) * 100;

          if (filterDirection === 'up') {
            // Stock is up X% (current >= IPO * (1 + X/100))
            return percentChange >= filterPercent;
          } else {
            // Stock is down X% (current <= IPO * (1 - X/100))
            return percentChange <= -filterPercent;
          }
        }
      });
    }

    // Apply IPO date filter
    if (filterIpoDateDirection && filterIpoDate) {
      const filterDate = new Date(filterIpoDate);
      result = result.filter(stock => {
        const ipoDate = new Date(stock.ipoDate);
        if (filterIpoDateDirection === 'before') {
          return ipoDate < filterDate;
        } else {
          return ipoDate > filterDate;
        }
      });
    }

    return result;
  }, [stocks, filterDirection, filterPercent, filterHistoric, filterIpoDateDirection, filterIpoDate, showFavoritesOnly, favorites, precomputedCharts]);

  useEffect(() => {
    // Check for clearCache query parameter (from run.sh)
    const urlParams = new URLSearchParams(window.location.search);
    const shouldClearCache = urlParams.get('clearCache') === 'true';
    
    if (shouldClearCache) {
      console.log('Clearing stock data cache (run.sh mode)');
      clearStockDataCache();
      // Remove the query parameter from URL without reload
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    
    // Load data (use cache unless we just cleared it)
    loadStockData(!shouldClearCache)
      .then(data => {
        setStocks(data);
        setLoading(false);
        // Initialize chart positions
        const initialPositions = updateChartPositions(0, data, chartPositions);
        setChartPositions(initialPositions);
      })
      .catch(err => {
        console.error('Error loading data:', err);
        setLoading(false);
      });

    // Load saved preferences
    setFavorites(getFavorites());
    setLocked(getLocked());

    // Preload SPAC events
    preloadSPACEvents()
      .then(eventsMap => {
        if (eventsMap) {
          setSpacEventsMap(eventsMap);
        }
      })
      .catch(err => {
        console.error('Error loading SPAC events:', err);
        // Set empty map on error to prevent undefined issues
        setSpacEventsMap(new Map());
      });
  }, []);

  const updateChartPositions = useCallback((startIdx: number, stockList: StockData[], currentPositions: Array<{ ticker: string; locked: boolean; starred: boolean }>) => {
    const currentLocked = getLocked();
    const currentFavorites = getFavorites();
    const newPositions: Array<{ ticker: string; locked: boolean; starred: boolean }> = [];
    let availableStockIdx = startIdx;
    
    for (let idx = 0; idx < 4; idx++) {
      // Check if current position should be locked (from previous state)
      const prevPosition = currentPositions[idx];
      if (prevPosition?.locked && prevPosition.ticker && currentLocked.has(prevPosition.ticker)) {
        newPositions[idx] = {
          ticker: prevPosition.ticker,
          locked: true,
          starred: currentFavorites.has(prevPosition.ticker),
        };
        continue;
      }
      
      // Find next available stock that's not already displayed and not locked
      while (availableStockIdx < stockList.length) {
        const candidateTicker = stockList[availableStockIdx].ticker;
        const alreadyDisplayed = newPositions.some(p => p.ticker === candidateTicker);
        
        if (!alreadyDisplayed && !currentLocked.has(candidateTicker)) {
          newPositions[idx] = {
            ticker: candidateTicker,
            locked: currentLocked.has(candidateTicker),
            starred: currentFavorites.has(candidateTicker),
          };
          availableStockIdx++;
          break;
        }
        availableStockIdx++;
      }
      
      if (availableStockIdx >= stockList.length && !newPositions[idx]) {
        newPositions[idx] = { ticker: '', locked: false, starred: false };
      }
    }
    
    return newPositions;
  }, []);

  useEffect(() => {
    if (filteredStocks.length > 0) {
      const newPositions = updateChartPositions(currentIndex, filteredStocks, chartPositions);
      setChartPositions(newPositions);
    }
  }, [currentIndex, filteredStocks.length, updateChartPositions]);

  // Reset index when filter changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [filterDirection, filterPercent, filterHistoric, filterIpoDateDirection, filterIpoDate, showFavoritesOnly]);

  const handleKeyPress = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      setCurrentIndex(prev => {
        const lockedCount = chartPositions.filter(p => p.locked).length;
        const step = Math.max(1, 4 - lockedCount);
        const newIndex = Math.max(0, prev - step);
        
        // Show warning if already at start
        if (newIndex === prev && prev === 0) {
          setShowNoDataWarning(true);
          setTimeout(() => setShowNoDataWarning(false), 2000);
        }
        
        return newIndex;
      });
    } else if (e.key === 'ArrowRight') {
      setCurrentIndex(prev => {
        const lockedCount = chartPositions.filter(p => p.locked).length;
        const step = Math.max(1, 4 - lockedCount);
        const maxIndex = Math.max(0, filteredStocks.length - 4);
        const newIndex = Math.min(maxIndex, prev + step);
        
        // Show warning if already at end
        if (newIndex === prev && prev >= maxIndex) {
          setShowNoDataWarning(true);
          setTimeout(() => setShowNoDataWarning(false), 2000);
        }
        
        return newIndex;
      });
    }
  }, [chartPositions, filteredStocks.length]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  const handleLock = (position: number) => {
    const ticker = chartPositions[position].ticker;
    if (!ticker) return;
    
    toggleLocked(ticker);
    const newLocked = getLocked();
    setLocked(newLocked);
    
    setChartPositions(prev => {
      const newPos = [...prev];
      newPos[position] = {
        ...newPos[position],
        locked: !newPos[position].locked,
      };
      return newPos;
    });
  };

  const handleStar = (position: number) => {
    const ticker = chartPositions[position].ticker;
    if (!ticker) return;
    
    toggleFavorite(ticker);
    const newFavorites = getFavorites();
    setFavorites(newFavorites);
    
    setChartPositions(prev => {
      const newPos = [...prev];
      newPos[position] = {
        ...newPos[position],
        starred: !newPos[position].starred,
      };
      return newPos;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading stock data...</p>
        </div>
      </div>
    );
  }

  const getStockByTicker = (ticker: string): StockData | null => {
    return stocks.find(s => s.ticker === ticker) || null;
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 relative">
      {/* No Data Warning Toast */}
      {showNoDataWarning && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-top-2">
          <div className="bg-red-600 text-white px-6 py-3 rounded-lg shadow-xl border border-red-700 flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">No more data in this direction</span>
          </div>
        </div>
      )}
      
      <div className="max-w-[1920px] mx-auto">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-3xl font-bold text-white">SPAC Strategy Dashboard</h1>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span>Total Stocks: {filteredStocks.length} {(filterDirection || showFavoritesOnly) && `(${stocks.length} total)`}</span>
              <span>Favorites: {favorites.size}</span>
              <span>Locked: {locked.size}</span>
              <button
                onClick={() => {
                  setShowFavoritesOnly(!showFavoritesOnly);
                  setCurrentIndex(0);
                }}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  showFavoritesOnly
                    ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
                title={showFavoritesOnly ? 'Show all stocks' : 'Show only favorites'}
              >
                ⭐ Favorites Only
              </button>
              <span className="text-xs">← → Arrow keys to navigate</span>
              <ResetButton onReset={() => {
                setFavorites(new Set());
                setLocked(new Set());
                setCurrentIndex(0);
                setFilterDirection(null);
                setFilterPercent(0);
                setFilterPercentInput('');
                setFilterHistoric(false);
                setFilterIpoDateDirection(null);
                setFilterIpoDate('');
                setShowFavoritesOnly(false);
                if (filteredStocks.length > 0) {
                  const newPositions = updateChartPositions(0, filteredStocks, chartPositions);
                  setChartPositions(newPositions);
                }
              }} />
            </div>
          </div>
          
          {/* Filter Section */}
          <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg p-3">
            <span className="text-sm text-gray-300 font-medium">Filter:</span>
            <button
              onClick={() => {
                if (filterDirection === 'up') {
                  setFilterDirection(null);
                  setFilterPercent(0);
                  setFilterPercentInput('');
                } else {
                  setFilterDirection('up');
                  setFilterPercentInput(filterPercent > 0 ? filterPercent.toString() : '');
                }
              }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                filterDirection === 'up'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Up ≥
            </button>
            <button
              onClick={() => {
                if (filterDirection === 'down') {
                  setFilterDirection(null);
                  setFilterPercent(0);
                  setFilterPercentInput('');
                } else {
                  setFilterDirection('down');
                  setFilterPercentInput(filterPercent > 0 ? filterPercent.toString() : '');
                }
              }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                filterDirection === 'down'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Down ≤
            </button>
            {filterDirection && (
              <>
                <span className="text-gray-500">by</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={filterPercentInput}
                  onChange={(e) => {
                    // Only allow numbers and decimal point
                    const value = e.target.value.replace(/[^0-9.]/g, '');
                    // Prevent multiple decimal points
                    const parts = value.split('.');
                    if (parts.length > 2) return;
                    setFilterPercentInput(value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const num = parseFloat(filterPercentInput) || 0;
                      setFilterPercent(num);
                    }
                  }}
                  placeholder="0"
                  className="w-20 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <span className="text-gray-500">%</span>
                <button
                  onClick={() => {
                    const num = parseFloat(filterPercentInput) || 0;
                    setFilterPercent(num);
                  }}
                  className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition-colors font-medium"
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    setFilterDirection(null);
                    setFilterPercent(0);
                    setFilterPercentInput('');
                    setFilterHistoric(false);
                    setFilterIpoDateDirection(null);
                    setFilterIpoDate('');
                  }}
                  className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded text-sm hover:bg-gray-700 transition-colors"
                >
                  Clear All
                </button>
              </>
            )}
            {filterDirection && (
              <label className="flex items-center gap-2 ml-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterHistoric}
                  onChange={(e) => setFilterHistoric(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-800 border-gray-700 text-green-500 focus:ring-2 focus:ring-green-500 focus:ring-offset-0"
                />
                <span className="text-sm text-gray-300">Historic</span>
              </label>
            )}
          </div>
          
          {/* IPO Date Filter Section */}
          <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg p-3 mt-2">
            <span className="text-sm text-gray-300 font-medium">IPO Date:</span>
            <button
              onClick={() => {
                if (filterIpoDateDirection === 'before') {
                  setFilterIpoDateDirection(null);
                  setFilterIpoDate('');
                } else {
                  setFilterIpoDateDirection('before');
                }
              }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                filterIpoDateDirection === 'before'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Before
            </button>
            <button
              onClick={() => {
                if (filterIpoDateDirection === 'after') {
                  setFilterIpoDateDirection(null);
                  setFilterIpoDate('');
                } else {
                  setFilterIpoDateDirection('after');
                }
              }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                filterIpoDateDirection === 'after'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              After
            </button>
            {filterIpoDateDirection && (
              <>
                <input
                  type="date"
                  value={filterIpoDate}
                  onChange={(e) => setFilterIpoDate(e.target.value)}
                  className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => {
                    setFilterIpoDateDirection(null);
                    setFilterIpoDate('');
                  }}
                  className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded text-sm hover:bg-gray-700 transition-colors"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-2 gap-4 h-[calc(100vh-120px)]">
          {chartPositions.map((pos, idx) => {
            const stock = getStockByTicker(pos.ticker);
            const precomputedData = pos.ticker ? (precomputedCharts?.get(pos.ticker) || null) : null;
            const spacEvents = pos.ticker ? (spacEventsMap?.get(pos.ticker) || []) : [];
            return (
              <StockChart
                key={`${pos.ticker}-${idx}`}
                precomputedData={precomputedData}
                ipoDate={stock?.ipoDate || ''}
                position={idx}
                locked={pos.locked}
                starred={pos.starred}
                spacEvents={spacEvents}
                onLock={() => handleLock(idx)}
                onStar={() => handleStar(idx)}
                onClick={() => {
                  if (stock) {
                    setSelectedStock(stock);
                  }
                }}
              />
            );
          })}
        </div>

        {/* Navigation Info */}
        <div className="mt-4 text-center text-sm text-gray-500">
          Showing stocks {currentIndex + 1}-{Math.min(currentIndex + 4, filteredStocks.length)} of {filteredStocks.length}
        </div>
      </div>

      {/* Stock Detail Modal */}
      {selectedStock && (
        <StockDetailModal
          stock={selectedStock}
          precomputedData={precomputedCharts?.get(selectedStock.ticker) || null}
          spacEvents={spacEventsMap?.get(selectedStock.ticker) || []}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  );
}

export default App;

