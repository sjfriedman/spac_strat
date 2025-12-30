import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StockData, SPACEvent, PrecomputedChartData, NewsData, NewsEvent, FinancialStatement, EarningsData, MatchingWindow } from './types';
import { loadStockData, DataType } from './utils/dataLoader';
import { getFavorites, toggleFavorite, getLocked, toggleLocked, clearStockDataCache } from './utils/storage';
import { preloadSPACEvents } from './utils/spacEvents';
import { preloadAllNews } from './utils/newsLoader';
import { preloadAllFinancialStatements } from './utils/financialStatementsLoader';
import { preloadAllEarnings } from './utils/earningsLoader';
import StockChart from './components/StockChart';
import StockDetailModal from './components/StockDetailModal';
import ResetButton from './components/ResetButton';
import TickerSearch from './components/TickerSearch';
import './utils/testRollingWindow'; // Load test utilities

function App() {
  const [dataType, setDataType] = useState<DataType>('despac');
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [filterDirection, setFilterDirection] = useState<'up' | 'down' | null>(null);
  const [filterPercent, setFilterPercent] = useState<number>(0);
  const [filterPercentInput, setFilterPercentInput] = useState<string>('');
  const [filterBusinessDays, setFilterBusinessDays] = useState<number>(0);
  const [filterBusinessDaysInput, setFilterBusinessDaysInput] = useState<string>('');
  const [filterHistoric, setFilterHistoric] = useState<boolean>(false);
  const [filterIpoDateDirection, setFilterIpoDateDirection] = useState<'before' | 'after' | null>(null);
  const [filterIpoDate, setFilterIpoDate] = useState<string>('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const [showNoDataWarning, setShowNoDataWarning] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(false);
  const [spacEventsMap, setSpacEventsMap] = useState<Map<string, SPACEvent[]>>(new Map());
  const [newsMap, setNewsMap] = useState<Map<string, NewsData>>(new Map());
  const [financialStatementsMap, setFinancialStatementsMap] = useState<Map<string, FinancialStatement>>(new Map());
  const [earningsMap, setEarningsMap] = useState<Map<string, EarningsData>>(new Map());
  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [chartPositions, setChartPositions] = useState<Array<{ ticker: string; locked: boolean; starred: boolean }>>([
    { ticker: '', locked: false, starred: false },
    { ticker: '', locked: false, starred: false },
    { ticker: '', locked: false, starred: false },
    { ticker: '', locked: false, starred: false },
  ]);
  const [precomputedCharts, setPrecomputedCharts] = useState<Map<string, PrecomputedChartData>>(new Map());
  const [precomputing, setPrecomputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const filterWorkerRef = useRef<Worker | null>(null);
  const [filterComputing, setFilterComputing] = useState(false);
  const [rollingWindowResults, setRollingWindowResults] = useState<{
    matchingTickers: Set<string>;
    cycles: Map<string, MatchingWindow[]>;
  } | null>(null);


  // Filter stocks based on percentage change from reference date (IPO for SPAC, Closing Date for De-SPAC)
  // Optimized: single pass with early exits and combined conditions
  const filteredStocks = useMemo(() => {
    // If favorites only is enabled, ignore all other filters and just show favorites
    if (showFavoritesOnly) {
      return stocks.filter(stock => favorites.has(stock.ticker));
    }

    // Pre-compute filter values outside the filter function
    const hasPercentFilter = filterDirection && filterPercent > 0;
    const hasBusinessDaysFilter = hasPercentFilter && filterBusinessDays > 0;
    const hasDateFilter = filterIpoDateDirection && filterIpoDate;
    const filterDate = hasDateFilter ? new Date(filterIpoDate) : null;

    // Single pass through stocks with combined filter conditions
    return stocks.filter(stock => {
      // Early exit for empty stock data
      if (stock.data.length === 0) return false;

      // Apply percentage filter if active
      if (hasPercentFilter) {
        const ipoPrice = precomputedCharts?.get(stock.ticker)?.ipoPrice || stock.data[0].close;
        
        if (hasBusinessDaysFilter) {
          // Check rolling windows: did the stock reach target % in any 1 to N day window?
          // Use worker results if available, otherwise skip (will be filtered when worker completes)
          if (rollingWindowResults) {
            if (!rollingWindowResults.matchingTickers.has(stock.ticker)) {
              return false;
            }
          } else {
            // Worker is computing, skip for now (will re-filter when results arrive)
            // This prevents showing wrong results during computation
            return false;
          }
        } else if (filterHistoric) {
          // Check historic: was the stock EVER up/down by X% at any point in history
          // Compute min/max once per stock instead of in separate filter passes
          const prices = stock.data.map(d => d.close);
          const maxPrice = Math.max(...prices);
          const minPrice = Math.min(...prices);
          
          if (filterDirection === 'up') {
            const maxPercentChange = ((maxPrice - ipoPrice) / ipoPrice) * 100;
            if (maxPercentChange < filterPercent) return false;
          } else {
            const minPercentChange = ((minPrice - ipoPrice) / ipoPrice) * 100;
            if (minPercentChange > -filterPercent) return false;
          }
        } else {
          // Check current: is the stock currently up/down by X%
          const currentPrice = stock.data[stock.data.length - 1].close;
          const percentChange = ((currentPrice - ipoPrice) / ipoPrice) * 100;

          if (filterDirection === 'up') {
            if (percentChange < filterPercent) return false;
          } else {
            if (percentChange > -filterPercent) return false;
          }
        }
      }

      // Apply IPO date filter if active (combined in same pass)
      if (hasDateFilter && filterDate) {
        const ipoDate = new Date(stock.ipoDate);
        if (filterIpoDateDirection === 'before') {
          if (ipoDate >= filterDate) return false;
        } else {
          if (ipoDate <= filterDate) return false;
        }
      }

      return true;
    });
  }, [stocks, filterDirection, filterPercent, filterBusinessDays, filterHistoric, filterIpoDateDirection, filterIpoDate, showFavoritesOnly, favorites, precomputedCharts, rollingWindowResults]);

  // Use cycles from worker results for matching windows
  const matchingWindowsMap = useMemo(() => {
    const windowsMap = new Map<string, MatchingWindow[]>();
    
    if (!filterDirection || filterPercent <= 0 || filterBusinessDays <= 0) {
      return windowsMap; // Return empty map when filter is not active
    }

    // Use cycles from worker results
    if (rollingWindowResults) {
      rollingWindowResults.cycles.forEach((windows, ticker) => {
        windowsMap.set(ticker, windows);
      });
    }

    return windowsMap;
  }, [filterDirection, filterPercent, filterBusinessDays, rollingWindowResults]);

  // Initialize Web Worker
  useEffect(() => {
    // Create worker instance
    workerRef.current = new Worker(
      new URL('./workers/chartPrecompute.worker.ts', import.meta.url),
      { type: 'module' }
    );

    // Handle worker messages
    workerRef.current.onmessage = (event: MessageEvent<{ success: boolean; data?: Record<string, PrecomputedChartData>; error?: string }>) => {
      const { success, data, error } = event.data;
      if (success && data) {
        // Convert object back to Map
        const precomputedMap = new Map<string, PrecomputedChartData>();
        Object.entries(data).forEach(([key, value]) => {
          precomputedMap.set(key, value);
        });
        setPrecomputedCharts(precomputedMap);
        setPrecomputing(false);
      } else if (error) {
        console.error('Error in precomputation worker:', error);
        setPrecomputing(false);
        // Fallback to empty map on error
        setPrecomputedCharts(new Map());
      }
    };

    // Handle worker errors
    workerRef.current.onerror = (error) => {
      console.error('Worker error:', error);
      setPrecomputing(false);
      setPrecomputedCharts(new Map());
    };

    // Cleanup worker on unmount
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Initialize Rolling Window Filter Worker
  useEffect(() => {
    // Create worker instance
    filterWorkerRef.current = new Worker(
      new URL('./workers/rollingWindowFilter.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    // Run verification test on worker initialization (for debugging)
    if (filterWorkerRef.current && process.env.NODE_ENV === 'development') {
      filterWorkerRef.current.postMessage({ test: true });
    }

    // Handle worker messages
    filterWorkerRef.current.onmessage = (event: MessageEvent<{
      success: boolean;
      matchingTickers?: string[];
      cyclesByTicker?: Array<{ ticker: string; cycles: MatchingWindow[] }>;
      error?: string;
      test?: boolean;
    }>) => {
      // Handle test response
      if (event.data.test) {
        return;
      }
      const { success, matchingTickers, cyclesByTicker, error } = event.data;
      if (success && matchingTickers && cyclesByTicker) {
        // Convert arrays to Maps/Sets for efficient lookup
        const matchingTickersSet = new Set(matchingTickers);
        const cyclesMap = new Map<string, MatchingWindow[]>();
        
        // Group cycles by ticker (already grouped by worker)
        cyclesByTicker.forEach(({ ticker, cycles }) => {
          if (cycles.length > 0) {
            cyclesMap.set(ticker, cycles);
          }
        });
        
        setRollingWindowResults({
          matchingTickers: matchingTickersSet,
          cycles: cyclesMap,
        });
        setFilterComputing(false);
      } else if (error) {
        console.error('Error in rolling window filter worker:', error);
        setFilterComputing(false);
        setRollingWindowResults(null);
      }
    };

    // Handle worker errors
    filterWorkerRef.current.onerror = (error) => {
      console.error('Rolling window filter worker error:', error);
      setFilterComputing(false);
      setRollingWindowResults(null);
    };

    // Cleanup worker on unmount
    return () => {
      if (filterWorkerRef.current) {
        filterWorkerRef.current.terminate();
        filterWorkerRef.current = null;
      }
    };
  }, []);

  // Trigger filter computation when business days filter changes
  useEffect(() => {
    if (!filterWorkerRef.current || !stocks || stocks.length === 0) {
      return;
    }

    const hasBusinessDaysFilter = filterDirection && filterPercent > 0 && filterBusinessDays > 0;
    
    if (hasBusinessDaysFilter) {
      setFilterComputing(true);
      setRollingWindowResults(null); // Clear old results
      
      filterWorkerRef.current.postMessage({
        stocks,
        targetPercent: filterPercent / 100, // Convert percentage to decimal
        maxDays: filterBusinessDays,
        direction: filterDirection,
      });
    } else {
      // Clear results when filter is not active
      setRollingWindowResults(null);
      setFilterComputing(false);
    }
  }, [stocks, filterDirection, filterPercent, filterBusinessDays]);

  // Trigger filter computation when business days filter changes
  useEffect(() => {
    if (!filterWorkerRef.current || !stocks || stocks.length === 0) {
      return;
    }

    const hasBusinessDaysFilter = filterDirection && filterPercent > 0 && filterBusinessDays > 0;
    
    if (hasBusinessDaysFilter) {
      setFilterComputing(true);
      setRollingWindowResults(null); // Clear old results
      
      filterWorkerRef.current.postMessage({
        stocks,
        targetPercent: filterPercent / 100, // Convert percentage to decimal
        maxDays: filterBusinessDays,
        direction: filterDirection,
      });
    } else {
      // Clear results when filter is not active
      setRollingWindowResults(null);
      setFilterComputing(false);
    }
  }, [stocks, filterDirection, filterPercent, filterBusinessDays]);

  // Trigger precomputation when stocks change
  useEffect(() => {
    if (!stocks || stocks.length === 0) {
      setPrecomputedCharts(new Map());
      return;
    }

    if (workerRef.current) {
      setPrecomputing(true);
      workerRef.current.postMessage({ stocks });
    }
  }, [stocks]);

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
    
    setLoading(true);
    
    // Load data (use cache unless we just cleared it)
    loadStockData(dataType, !shouldClearCache)
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

    // Preload SPAC events (only for SPAC data type)
    if (dataType === 'spac') {
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
    } else {
      // Clear SPAC events for De-SPAC
      setSpacEventsMap(new Map());
    }

    // Clear news cache if clearCache param is present (check existing urlParams from earlier)
    const shouldClearNewsCache = new URLSearchParams(window.location.search).get('clearCache') === 'true';
    if (shouldClearNewsCache) {
      console.log('[App] Clearing news cache...');
      localStorage.removeItem('spac_strat_news_cache');
      localStorage.removeItem('spac_news_cache_version');
      localStorage.removeItem('spac_news_cache_data_type');
    }

    // Preload news data for both SPAC and deSPAC
    preloadAllNews(dataType)
      .then((newsDataMap) => {
        console.log(`[App] Loaded news data for ${newsDataMap.size} tickers`);
        // Debug: check if USAR is in the map
        if (newsDataMap.has('USAR')) {
          const usarNews = newsDataMap.get('USAR');
          console.log(`[App] ✅ USAR news data loaded:`, usarNews ? {
            hasFeed: !!usarNews.feed,
            feedLength: usarNews.feed?.length || 0,
            ticker: usarNews.ticker,
            firstArticle: usarNews.feed?.[0] ? {
              title: usarNews.feed[0].title,
              date: usarNews.feed[0].time_published
            } : null
          } : 'null');
        } else {
          console.log(`[App] ❌ USAR not found in newsDataMap. Available tickers (first 20):`, Array.from(newsDataMap.keys()).slice(0, 20));
        }
        setNewsMap(newsDataMap);
      })
      .catch(err => {
        console.error('Error loading news:', err);
        setNewsMap(new Map());
      });

    // Preload financial statements data for both SPAC and deSPAC
    preloadAllFinancialStatements(dataType)
      .then((statementsMap) => {
        setFinancialStatementsMap(statementsMap);
      })
      .catch(err => {
        console.error('Error loading financial statements:', err);
        setFinancialStatementsMap(new Map());
      });
    
    // Preload earnings data for both SPAC and deSPAC
    preloadAllEarnings(dataType)
      .then((earningsMapData) => {
        setEarningsMap(earningsMapData);
      })
      .catch(err => {
        console.error('Error loading earnings:', err);
        setEarningsMap(new Map());
      });
  }, [dataType]);

  // Extract financial statement events from the map synchronously
  const financialStatementEventsMap = useMemo(() => {
    const eventsMap = new Map<string, any[]>();
    
    financialStatementsMap.forEach((statements, ticker) => {
      // Extract events using the same logic as the loader
      const events: any[] = [];
      const reportDates = new Set<string>();
      
      const getQuarter = (month: number): number => {
        if (month >= 1 && month <= 3) return 1;
        if (month >= 4 && month <= 6) return 2;
        if (month >= 7 && month <= 9) return 3;
        if (month >= 10 && month <= 12) return 4;
        return 1;
      };
      
      const fiscalDateToQuarterYear = (fiscalDateEnding: string): string => {
        if (!fiscalDateEnding || fiscalDateEnding.length < 10) return '';
        try {
          const date = new Date(fiscalDateEnding);
          const year = date.getFullYear();
          const month = date.getMonth() + 1;
          const quarter = getQuarter(month);
          return `Q${quarter} ${year}`;
        } catch {
          return '';
        }
      };
      
      const extractReportDate = (report: any): string => {
        return report.reportDate || report.fiscalDateEnding || report.date || '';
      };
      
      const statementTypes = [
        { key: 'balanceSheet', data: statements.balanceSheet },
        { key: 'cashFlow', data: statements.cashFlow },
        { key: 'incomeStatement', data: statements.incomeStatement }
      ];
      
      for (const stmtType of statementTypes) {
        const statement = stmtType.data;
        if (!statement) continue;
        
        if (statement.quarterlyReports && Array.isArray(statement.quarterlyReports)) {
          for (const report of statement.quarterlyReports) {
            const reportDate = extractReportDate(report);
            if (reportDate) reportDates.add(reportDate);
          }
        }
        
        if (statement.annualReports && Array.isArray(statement.annualReports)) {
          for (const report of statement.annualReports) {
            const reportDate = extractReportDate(report);
            if (reportDate) reportDates.add(reportDate);
          }
        }
      }
      
      for (const reportDate of reportDates) {
        let fiscalDateEnding = '';
        let foundReport: any = null;
        
        for (const stmtType of statementTypes) {
          const statement = stmtType.data;
          if (!statement) continue;
          
          if (statement.quarterlyReports && Array.isArray(statement.quarterlyReports)) {
            foundReport = statement.quarterlyReports.find((r: any) => extractReportDate(r) === reportDate);
            if (foundReport && foundReport.fiscalDateEnding) {
              fiscalDateEnding = foundReport.fiscalDateEnding;
              break;
            }
          }
          
          if (statement.annualReports && Array.isArray(statement.annualReports)) {
            foundReport = statement.annualReports.find((r: any) => extractReportDate(r) === reportDate);
            if (foundReport && foundReport.fiscalDateEnding) {
              fiscalDateEnding = foundReport.fiscalDateEnding;
              break;
            }
          }
        }
        
        if (!fiscalDateEnding) fiscalDateEnding = reportDate;
        
        const quarter = fiscalDateToQuarterYear(fiscalDateEnding);
        const label = quarter ? `${quarter} - ${reportDate}` : reportDate;
        
        events.push({
          date: reportDate,
          ticker,
          quarter,
          fiscalDateEnding,
          reportDate,
          label
        });
      }
      
      events.sort((a, b) => b.date.localeCompare(a.date));
      
      if (events.length > 0) {
        eventsMap.set(ticker, events);
      }
    });
    
    return eventsMap;
  }, [financialStatementsMap]);

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
  }, [filterDirection, filterPercent, filterBusinessDays, filterHistoric, filterIpoDateDirection, filterIpoDate, showFavoritesOnly]);

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

  // Test function for verifying rolling window filter logic
  // NOTE: Must be defined before any early returns to comply with React hooks rules
  const testRollingWindowLogic = useCallback(() => {
    console.log('🧪 Testing Rolling Window Filter Logic...\n');
    
    // Test 1: Simple 10% gain
    const testStock1: StockData = {
      ticker: 'TEST1',
      ipoDate: '2024-01-01',
      data: [
        { date: '2024-01-01', close: 10.0, volume: 1000 },
        { date: '2024-01-02', close: 10.5, volume: 1000 },
        { date: '2024-01-03', close: 10.8, volume: 1000 },
        { date: '2024-01-04', close: 11.0, volume: 1000 }, // 10% gain
        { date: '2024-01-05', close: 10.9, volume: 1000 },
      ],
    };
    
    if (filterWorkerRef.current) {
      filterWorkerRef.current.postMessage({
        stocks: [testStock1],
        targetPercent: 0.10,
        maxDays: 6,
        direction: 'up' as const,
      });
      
      // Set up one-time listener for test
      const testHandler = (event: MessageEvent) => {
        if (event.data.success && event.data.matchingTickers) {
          const matches = event.data.matchingTickers.includes('TEST1');
          console.log('Test 1 - 10% gain:', matches ? '✅ PASSED' : '❌ FAILED');
          filterWorkerRef.current?.removeEventListener('message', testHandler);
        }
      };
      filterWorkerRef.current.addEventListener('message', testHandler);
    }
    
    console.log('Run testRollingWindowLogic() in console for full test suite');
  }, []);
  
  // Expose test function to window for console access
  // NOTE: Must be defined before any early returns to comply with React hooks rules
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).testRollingWindowLogic = testRollingWindowLogic;
    }
  }, [testRollingWindowLogic]);

  if (loading || precomputing) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p className="text-gray-400">
            {loading ? 'Loading stock data...' : 'Precomputing chart data...'}
          </p>
        </div>
      </div>
    );
  }

  // Show filter computing indicator (overlay, not full screen)
  const showFilterComputing = filterComputing && filterDirection && filterPercent > 0 && filterBusinessDays > 0;

  const getStockByTicker = (ticker: string): StockData | null => {
    return stocks.find(s => s.ticker === ticker) || null;
  };

  const handleSearchSelectTicker = (ticker: string) => {
    // Find the first unlocked position or empty position
    const currentLocked = getLocked();
    const currentFavorites = getFavorites();
    
    setChartPositions(prev => {
      const newPos = [...prev];
      
      // Find first unlocked/empty position
      for (let i = 0; i < newPos.length; i++) {
        if (!newPos[i].locked && !currentLocked.has(newPos[i].ticker)) {
          newPos[i] = {
            ticker: ticker,
            locked: false,
            starred: currentFavorites.has(ticker),
          };
          break;
        }
      }
      
      return newPos;
    });
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 relative">
      {/* Filter Computing Indicator */}
      {showFilterComputing && (
        <div className="fixed top-4 right-4 z-50 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-xl border border-blue-700 flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          <span className="font-medium">Computing filter...</span>
        </div>
      )}
      
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
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-bold text-white">SPAC Strategy Dashboard</h1>
              {/* Data Type Selector */}
              <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg p-1">
                <button
                  onClick={() => {
                    setDataType('despac');
                    setCurrentIndex(0);
                  }}
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                    dataType === 'despac'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  De-SPAC
                </button>
                <button
                  onClick={() => {
                    setDataType('spac');
                    setCurrentIndex(0);
                  }}
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                    dataType === 'spac'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  SPAC
                </button>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <TickerSearch stocks={stocks} onSelectTicker={handleSearchSelectTicker} />
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
              <button
                onClick={() => setShowLegend(!showLegend)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  showLegend
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
                title={showLegend ? 'Hide Legend' : 'Show Legend'}
              >
                {showLegend ? 'Hide Legend' : 'Add Legend'}
              </button>
              <ResetButton onReset={() => {
                setFavorites(new Set());
                setLocked(new Set());
                setCurrentIndex(0);
                setFilterDirection(null);
                setFilterPercent(0);
                setFilterPercentInput('');
                setFilterBusinessDays(0);
                setFilterBusinessDaysInput('');
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
          
          {/* Legend or Filter Section */}
          {showLegend ? (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-3">Chart Legend</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* SPAC Events Section */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-300 mb-2">SPAC Events</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-red-500"></div>
                      <span className="text-sm text-gray-300">Merger Vote</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-amber-500"></div>
                      <span className="text-sm text-gray-300">Extension Vote</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-green-500"></div>
                      <span className="text-sm text-gray-300">De-SPAC / Listed</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-blue-500"></div>
                      <span className="text-sm text-gray-300">Split</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-purple-500"></div>
                      <span className="text-sm text-gray-300">IPO</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-gray-500"></div>
                      <span className="text-sm text-gray-300">Other Events</span>
                    </div>
                  </div>
                </div>
                {/* News Events Section */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-300 mb-2">News Events</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-green-500"></div>
                      <span className="text-sm text-gray-300">Bullish Sentiment</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-red-500"></div>
                      <span className="text-sm text-gray-300">Bearish Sentiment</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-gray-500"></div>
                      <span className="text-sm text-gray-300">Neutral Sentiment</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Hover over vertical lines on the chart to see event details. Filters remain active while legend is shown.
              </p>
            </div>
          ) : (
            <>
              {/* Filter Section */}
              <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg p-3">
            <span className="text-sm text-gray-300 font-medium">Filter:</span>
            <button
              onClick={() => {
                if (filterDirection === 'up') {
                  setFilterDirection(null);
                  setFilterPercent(0);
                  setFilterPercentInput('');
                  setFilterBusinessDays(0);
                  setFilterBusinessDaysInput('');
                } else {
                  setFilterDirection('up');
                  setFilterPercentInput(filterPercent > 0 ? filterPercent.toString() : '');
                  setFilterBusinessDaysInput(filterBusinessDays > 0 ? filterBusinessDays.toString() : '');
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
                  setFilterBusinessDays(0);
                  setFilterBusinessDaysInput('');
                } else {
                  setFilterDirection('down');
                  setFilterPercentInput(filterPercent > 0 ? filterPercent.toString() : '');
                  setFilterBusinessDaysInput(filterBusinessDays > 0 ? filterBusinessDays.toString() : '');
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
                <span className="text-gray-500">within</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={filterBusinessDaysInput}
                  onChange={(e) => {
                    // Only allow positive integers
                    const value = e.target.value.replace(/[^0-9]/g, '');
                    setFilterBusinessDaysInput(value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const num = parseInt(filterBusinessDaysInput) || 0;
                      setFilterBusinessDays(num);
                    }
                  }}
                  placeholder="0"
                  className="w-20 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <span className="text-gray-500">business days</span>
                <button
                  onClick={() => {
                    const num = parseFloat(filterPercentInput) || 0;
                    setFilterPercent(num);
                    const daysNum = parseInt(filterBusinessDaysInput) || 0;
                    setFilterBusinessDays(daysNum);
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
                    setFilterBusinessDays(0);
                    setFilterBusinessDaysInput('');
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
          
          {/* Date Filter Section (IPO for SPAC, Closing Date for De-SPAC) */}
          <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg p-3 mt-2">
            <span className="text-sm text-gray-300 font-medium">
              {dataType === 'spac' ? 'IPO Date:' : 'Closing Date:'}
            </span>
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
            </>
          )}
        </div>

        {/* Charts Grid */}
        {(() => {
          // Filter out empty positions and prepare chart data
          const validCharts = chartPositions
            .map((pos, idx) => {
              if (!pos.ticker) return null;
              const stock = getStockByTicker(pos.ticker);
              const precomputedData = precomputedCharts?.get(pos.ticker) || null;
              const spacEvents = spacEventsMap?.get(pos.ticker) || [];
              const newsData = newsMap?.get(pos.ticker) || null;
              
              // Debug: log news data retrieval
              if (pos.ticker === 'USAR') {
                console.log(`[App] USAR news data lookup:`, {
                  newsMapSize: newsMap?.size || 0,
                  hasNewsData: !!newsData,
                  hasFeed: !!newsData?.feed,
                  feedLength: newsData?.feed?.length || 0,
                  ticker: newsData?.ticker
                });
              }
              
              // Convert NewsData to NewsEvent[] for chart display
              // Use the same transformation logic as newsLoader for consistency
              let newsEvents: NewsEvent[] = [];
              
              if (newsData && newsData.feed && newsData.feed.length > 0) {
                if (pos.ticker === 'USAR') {
                  console.log(`[App] Transforming ${newsData.feed.length} USAR news articles`);
                }
                
                const transformed = newsData.feed.map(article => {
                  // Extract date using same logic as newsLoader
                  const timePublished = article.time_published;
                  let date = '';
                  if (timePublished && timePublished.length >= 8) {
                    const dateStr = timePublished.substring(0, 8);
                    date = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
                  }
                  const tickerSentiment = article.ticker_sentiment?.find(ts => ts.ticker === pos.ticker);
                  return {
                    date,
                    time_published: article.time_published,
                    title: article.title,
                    url: article.url,
                    source: article.source,
                    category_within_source: article.category_within_source,
                    topics: article.topics,
                    overall_sentiment_score: article.overall_sentiment_score,
                    overall_sentiment_label: article.overall_sentiment_label,
                    ticker_sentiment: tickerSentiment ? {
                      ticker: tickerSentiment.ticker,
                      relevance_score: tickerSentiment.relevance_score,
                      ticker_sentiment_score: tickerSentiment.ticker_sentiment_score,
                      ticker_sentiment_label: tickerSentiment.ticker_sentiment_label,
                    } : undefined,
                  };
                });
                
                // Filter out events with invalid dates
                newsEvents = transformed.filter(event => event.date !== '');
                
                if (pos.ticker === 'USAR') {
                  console.log(`[App] USAR newsEvents after transformation:`, {
                    totalArticles: newsData.feed.length,
                    transformed: transformed.length,
                    withValidDates: newsEvents.length,
                    sampleDates: newsEvents.slice(0, 3).map(e => e.date)
                  });
                }
              } else {
                if (pos.ticker === 'USAR') {
                  console.log(`[App] USAR newsData is empty or invalid:`, {
                    hasNewsData: !!newsData,
                    hasFeed: !!newsData?.feed,
                    feedLength: newsData?.feed?.length || 0
                  });
                }
              }
              
              // Get financial statement events for this ticker
              const financialStatementEvents = financialStatementEventsMap?.get(pos.ticker) || [];
              
              const matchingWindows = matchingWindowsMap?.get(pos.ticker) || null;
              
              return {
                pos,
                idx,
                stock,
                precomputedData,
                spacEvents,
                newsEvents,
                financialStatementEvents,
                matchingWindows,
              };
            })
            .filter((chart): chart is NonNullable<typeof chart> => chart !== null);

          const chartCount = validCharts.length;
          
          // Determine grid columns based on chart count
          let gridColsClass = 'grid-cols-2'; // default for 2 or 4 charts
          if (chartCount === 1) {
            gridColsClass = 'grid-cols-1';
          } else if (chartCount === 3) {
            gridColsClass = 'grid-cols-2'; // 2 columns, third will span
          }

          return (
            <div className={`grid ${gridColsClass} gap-4 h-[calc(100vh-120px)]`}>
              {validCharts.map((chart, displayIdx) => {
                const isThirdInThree = chartCount === 3 && displayIdx === 2;
                return (
                  <div
                    key={`${chart.pos.ticker}-${chart.idx}`}
                    className={isThirdInThree ? 'col-span-2' : ''}
                  >
                    <StockChart
                      precomputedData={chart.precomputedData}
                      ipoDate={chart.stock?.ipoDate || ''}
                      position={chart.idx}
                      locked={chart.pos.locked}
                      starred={chart.pos.starred}
                      spacEvents={chart.spacEvents}
                      newsEvents={chart.newsEvents}
                      financialStatementEvents={chart.financialStatementEvents}
                      matchingWindows={chart.matchingWindows}
                      filterDirection={filterDirection}
                      onLock={() => handleLock(chart.idx)}
                      onStar={() => handleStar(chart.idx)}
                      onClick={() => {
                        if (chart.stock) {
                          setSelectedStock(chart.stock);
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          );
        })()}

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
          newsData={newsMap?.get(selectedStock.ticker) || null}
          financialStatements={financialStatementsMap?.get(selectedStock.ticker) || null}
          earningsData={earningsMap?.get(selectedStock.ticker) || null}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  );
}

export default App;

