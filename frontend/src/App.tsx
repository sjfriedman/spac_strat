import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StockData, SPACEvent, PrecomputedChartData, NewsData, NewsEvent, FinancialStatement, EarningsData, MatchingWindow, InsiderTransactionsData, RegressionStatsData } from './types';
import { loadStockData, DataType } from './utils/dataLoader';
import { getFavorites, toggleFavorite, getLocked, toggleLocked, clearStockDataCache } from './utils/storage';
import { preloadSPACEvents } from './utils/spacEvents';
import { preloadAllNews } from './utils/newsLoader';
import { preloadAllFinancialStatements } from './utils/financialStatementsLoader';
import { preloadAllEarnings } from './utils/earningsLoader';
import { preloadAllInsiderTransactions } from './utils/insiderTransactionsLoader';
import { preloadAllRegressionStats } from './utils/regressionStatsLoader';
import { loadPipeData } from './utils/pipeLoader';
import StockChart from './components/StockChart';
import StockDetailModal from './components/StockDetailModal';
import ResetButton from './components/ResetButton';
import TickerSearch from './components/TickerSearch';
import CrossCompanyInsidersModal from './components/CrossCompanyInsidersModal';
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
  const [filterIpoDateDirection, setFilterIpoDateDirection] = useState<'before' | 'after' | null>(null);
  const [filterIpoDate, setFilterIpoDate] = useState<string>('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const [filterWithInsiderTransactions, setFilterWithInsiderTransactions] = useState<boolean>(false);
  const [filterPriceAboveIPO, setFilterPriceAboveIPO] = useState<boolean>(false);
  const [filterIsPipe, setFilterIsPipe] = useState<boolean>(false);
  const [pipeMap, setPipeMap] = useState<Map<string, boolean>>(new Map());
  const [showNoDataWarning, setShowNoDataWarning] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(false);
  const [spacEventsMap, setSpacEventsMap] = useState<Map<string, SPACEvent[]>>(new Map());
  const [newsMap, setNewsMap] = useState<Map<string, NewsData>>(new Map());
  const [financialStatementsMap, setFinancialStatementsMap] = useState<Map<string, FinancialStatement>>(new Map());
  const [earningsMap, setEarningsMap] = useState<Map<string, EarningsData>>(new Map());
  const [insiderTransactionsMap, setInsiderTransactionsMap] = useState<Map<string, InsiderTransactionsData>>(new Map());
  const [regressionStats, setRegressionStats] = useState<RegressionStatsData | null>(null);
  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [showCrossCompanyInsiders, setShowCrossCompanyInsiders] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
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

    // CRITICAL FIX: If business days filter is active and computing or results not ready, return empty array
    // This prevents showing all stocks (587) when filter is computing
    if (hasBusinessDaysFilter && (filterComputing || !rollingWindowResults)) {
      return [];
    }

    // Single pass through stocks with combined filter conditions
    const filtered = stocks.filter(stock => {
      // Early exit for empty stock data
      if (stock.data.length === 0) return false;

      // Apply percentage filter if active
      if (hasPercentFilter) {
        const ipoPrice = precomputedCharts?.get(stock.ticker)?.ipoPrice || stock.data[0].close;
        
        if (hasBusinessDaysFilter) {
          // Check rolling windows: did the stock reach target % in any 1 to N day window?
          // Use worker results if available
          if (rollingWindowResults) {
            if (!rollingWindowResults.matchingTickers.has(stock.ticker)) {
              return false;
            }
          } else {
            // This should never happen due to early return above, but defensive check
            return false;
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

      // Apply insider transactions filter if active
      if (filterWithInsiderTransactions) {
        const insiderData = insiderTransactionsMap?.get(stock.ticker);
        if (!insiderData || !insiderData.transactions || insiderData.transactions.length === 0) {
          return false;
        }
      }

      // Apply price above IPO filter if active
      if (filterPriceAboveIPO) {
        if (stock.data.length === 0) return false;
        const ipoPrice = precomputedCharts?.get(stock.ticker)?.ipoPrice || stock.data[0].close;
        const currentPrice = stock.data[stock.data.length - 1].close;
        if (currentPrice <= ipoPrice) return false;
      }

      // Apply pipe filter if active
      if (filterIsPipe) {
        const isPipe = pipeMap.get(stock.ticker);
        if (!isPipe) return false;
      }

      return true;
    });
    
    // Debug: log filter results with all active filters
    const activeFilters = [];
    if (hasPercentFilter) {
      if (hasBusinessDaysFilter) {
        activeFilters.push(`${filterDirection} ${filterPercent}% within ${filterBusinessDays} days`);
      } else {
        activeFilters.push(`${filterDirection} ${filterPercent}%`);
      }
    }
    if (hasDateFilter) {
      activeFilters.push(`${dataType === 'spac' ? 'IPO' : 'Closing'} date ${filterIpoDateDirection} ${filterIpoDate}`);
    }
    if (filterWithInsiderTransactions) {
      activeFilters.push('Has insider transactions');
    }
    if (filterPriceAboveIPO) {
      activeFilters.push('Price > IPO');
    }
    if (filterIsPipe) {
      activeFilters.push('Is a pipe');
    }
    
    if (activeFilters.length > 0) {
      console.log(`[App] Active filters (${activeFilters.length}): ${activeFilters.join(' AND ')}`);
      console.log(`[App] Filtered stocks: ${filtered.length} out of ${stocks.length}`);
    }
    
    return filtered;
  }, [stocks, filterDirection, filterPercent, filterBusinessDays, filterIpoDateDirection, filterIpoDate, showFavoritesOnly, favorites, precomputedCharts, rollingWindowResults, filterComputing, filterWithInsiderTransactions, filterPriceAboveIPO, filterIsPipe, pipeMap, insiderTransactionsMap]);

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
        console.log(`[App] ✅ Precomputed chart data for ${precomputedMap.size} stocks`);
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
        
        console.log(`[App] Received filter results: ${matchingTickers.length} tickers with at least one cycle (out of all stocks)`);
        
        // Group cycles by ticker (already grouped by worker)
        // Note: Worker computed cycles for ALL stocks, then filtered to only those with at least one cycle
        cyclesByTicker.forEach(({ ticker, cycles }) => {
          // Store cycles for this ticker (all tickers here have at least one cycle)
          cyclesMap.set(ticker, cycles);
        });
        
        console.log(`[App] Filter will show ${matchingTickers.length} filtered stocks with cycles (4 at a time)`);
        
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
      localStorage.removeItem('spac_strat_news_cache');
      localStorage.removeItem('spac_news_cache_version');
      localStorage.removeItem('spac_news_cache_data_type');
    }

    // Preload news data for both SPAC and deSPAC
    preloadAllNews(dataType)
      .then((newsDataMap) => {
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
    
    // Preload insider transactions data for both SPAC and deSPAC
    preloadAllInsiderTransactions(dataType)
      .then((insiderMapData) => {
        console.log(`[App] Loaded insider transactions: ${insiderMapData.size} tickers`);
        if (insiderMapData.size === 0) {
          console.warn(`[App] WARNING: No insider transactions loaded for ${dataType}! Check console for errors.`);
        }
        setInsiderTransactionsMap(insiderMapData);
      })
      .catch(err => {
        console.error('[App] Error loading insider transactions:', err);
        console.error('[App] Error details:', err.message, err.stack);
        setInsiderTransactionsMap(new Map());
      });
    
    // Preload regression statistics
    preloadAllRegressionStats(dataType)
      .then((statsData) => {
        setRegressionStats(statsData);
      })
      .catch(err => {
        console.error('Error loading regression stats:', err);
        setRegressionStats(null);
      });
    
    // Load pipe data (doesn't depend on dataType, same for both)
    loadPipeData()
      .then((pipeData) => {
        console.log(`[App] Loaded pipe data for ${pipeData.size} tickers`);
        setPipeMap(pipeData);
      })
      .catch(err => {
        console.error('[App] Error loading pipe data:', err);
        setPipeMap(new Map());
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
    // Create a Set of tickers in the filtered list for efficient lookup
    const stockListTickers = new Set(stockList.map(s => s.ticker));
    const newPositions: Array<{ ticker: string; locked: boolean; starred: boolean }> = [];
    let availableStockIdx = startIdx;
    
    for (let idx = 0; idx < 4; idx++) {
      // Check if current position should be locked (from previous state)
      // BUT only preserve it if it's in the filtered stock list
      const prevPosition = currentPositions[idx];
      if (prevPosition?.locked && prevPosition.ticker && currentLocked.has(prevPosition.ticker)) {
        // Only preserve locked position if the ticker is in the filtered list
        if (stockListTickers.has(prevPosition.ticker)) {
          newPositions[idx] = {
            ticker: prevPosition.ticker,
            locked: true,
            starred: currentFavorites.has(prevPosition.ticker),
          };
          continue;
        }
        // If locked ticker is not in filtered list, fall through to find a new one
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

  // Update chart positions when filtered stocks change
  // IMPORTANT: Only update if filter is not computing (wait for filter to complete)
  useEffect(() => {
    // If business days filter is active, wait for worker to complete AND results to be available
    const hasBusinessDaysFilter = filterDirection && filterPercent > 0 && filterBusinessDays > 0;
    if (hasBusinessDaysFilter) {
      if (filterComputing || !rollingWindowResults) {
        // Don't update positions while filter is computing or results not ready
        console.log(`[App] Waiting for filter to complete before updating chart positions... (computing: ${filterComputing}, hasResults: ${!!rollingWindowResults})`);
        // Clear positions while waiting to prevent showing stale data
        setChartPositions([
          { ticker: '', locked: false, starred: false },
          { ticker: '', locked: false, starred: false },
          { ticker: '', locked: false, starred: false },
          { ticker: '', locked: false, starred: false },
        ]);
        return;
      }
    }
    
    if (filteredStocks.length > 0) {
      // Use functional setState to avoid stale closure issues
      setChartPositions(prevPositions => {
        const newPositions = updateChartPositions(currentIndex, filteredStocks, prevPositions);
        // Debug: log which tickers are being set
        const newTickers = newPositions.map(p => p.ticker).filter(t => t);
        if (newTickers.length > 0) {
          console.log(`[App] Updating chart positions: index=${currentIndex}, tickers=`, newTickers, `(showing ${newTickers.length} of ${filteredStocks.length} filtered stocks)`);
        }
        return newPositions;
      });
    } else {
      // Clear positions if no filtered stocks
      setChartPositions([
        { ticker: '', locked: false, starred: false },
        { ticker: '', locked: false, starred: false },
        { ticker: '', locked: false, starred: false },
        { ticker: '', locked: false, starred: false },
      ]);
    }
  }, [currentIndex, filteredStocks, updateChartPositions, filterComputing, filterDirection, filterPercent, filterBusinessDays, rollingWindowResults]);

  // Reset index when filter changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [filterDirection, filterPercent, filterBusinessDays, filterIpoDateDirection, filterIpoDate, showFavoritesOnly, filterWithInsiderTransactions, filterPriceAboveIPO, filterIsPipe]);

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
        
        console.log(`[App] Navigation Right: prev=${prev}, newIndex=${newIndex}, maxIndex=${maxIndex}, filteredStocks.length=${filteredStocks.length}, step=${step}`);
        
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

  // Test function for verifying rolling window filter logic (for debugging)
  // NOTE: Must be defined before any early returns to comply with React hooks rules
  const testRollingWindowLogic = useCallback(() => {
    // Test function - can be called from console for debugging if needed
    // Logs removed to reduce console noise
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
              <button
                onClick={() => setShowCrossCompanyInsiders(true)}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium transition-colors flex items-center gap-1.5"
                title="View insiders across multiple companies"
              >
                <span>👥</span>
                <span>Insiders</span>
              </button>
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
                setFilterIpoDateDirection(null);
                setFilterIpoDate('');
                setShowFavoritesOnly(false);
                setFilterWithInsiderTransactions(false);
                setFilterPriceAboveIPO(false);
                setFilterIsPipe(false);
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
              {/* Filters Toggle Button */}
              <div className="mb-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm transition-colors flex items-center gap-2"
                >
                  <span>{showFilters ? '▼' : '▶'}</span>
                  <span>{showFilters ? 'Hide Filters' : 'Show Filters'}</span>
                  {!showFilters && (filterDirection || filterIpoDateDirection || filterWithInsiderTransactions || filterPriceAboveIPO || filterIsPipe) && (
                    <span className="text-blue-400 text-xs">(Active)</span>
                  )}
                </button>
              </div>

              {showFilters && (
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
                    setFilterIpoDateDirection(null);
                    setFilterIpoDate('');
                    setFilterWithInsiderTransactions(false);
                    setFilterPriceAboveIPO(false);
                    setFilterIsPipe(false);
                  }}
                  className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded text-sm hover:bg-gray-700 transition-colors"
                >
                  Clear All
                </button>
              </>
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
          
          {/* Additional Filters Section */}
          <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg p-3 mt-2">
            <span className="text-sm text-gray-300 font-medium">Quick Filters:</span>
            <button
              onClick={() => {
                setFilterWithInsiderTransactions(!filterWithInsiderTransactions);
                setCurrentIndex(0);
              }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                filterWithInsiderTransactions
                  ? 'bg-yellow-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
              title={filterWithInsiderTransactions ? 'Show all stocks' : 'Show only stocks with insider transactions'}
            >
              👤 Has Insider Trades
            </button>
            <button
              onClick={() => {
                setFilterPriceAboveIPO(!filterPriceAboveIPO);
                setCurrentIndex(0);
              }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                filterPriceAboveIPO
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
              title={filterPriceAboveIPO ? 'Show all stocks' : 'Show only stocks trading above IPO price'}
            >
              📈 Price &gt; IPO
            </button>
            <button
              onClick={() => {
                setFilterIsPipe(!filterIsPipe);
                setCurrentIndex(0);
              }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                filterIsPipe
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
              title={filterIsPipe ? 'Show all stocks' : 'Show only stocks that are pipes'}
            >
              🔷 Is a Pipe
            </button>
            {(filterWithInsiderTransactions || filterPriceAboveIPO || filterIsPipe) && (
              <button
                onClick={() => {
                  setFilterWithInsiderTransactions(false);
                  setFilterPriceAboveIPO(false);
                  setFilterIsPipe(false);
                  setCurrentIndex(0);
                }}
                className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded text-sm hover:bg-gray-700 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Charts Grid */}
        {(() => {
          // Create a Set of filtered tickers for efficient lookup
          const filteredTickersSet = new Set(filteredStocks.map(s => s.ticker));
          
          // Filter out empty positions and prepare chart data
          const validCharts = chartPositions
            .map((pos, idx) => {
              if (!pos.ticker) return null;
              
              // CRITICAL: Only render charts for tickers in the filtered list
              if (!filteredTickersSet.has(pos.ticker)) {
                return null;
              }
              
              const stock = getStockByTicker(pos.ticker);
              if (!stock) {
                console.log(`[App] ⚠️ Stock not found for ticker: ${pos.ticker}`);
                return null;
              }
              const precomputedData = precomputedCharts?.get(pos.ticker) || null;
              if (!precomputedData) {
                console.log(`[App] ⚠️ No precomputed data for ticker: ${pos.ticker} (precomputedCharts has ${precomputedCharts?.size || 0} entries)`);
                return null;
              }
              const spacEvents = spacEventsMap?.get(pos.ticker) || [];
              const newsData = newsMap?.get(pos.ticker) || null;
              
              // Convert NewsData to NewsEvent[] for chart display
              // Use the same transformation logic as newsLoader for consistency
              let newsEvents: NewsEvent[] = [];
              
              if (newsData && newsData.feed && newsData.feed.length > 0) {
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
              }
              
              // Get financial statement events for this ticker
              const financialStatementEvents = financialStatementEventsMap?.get(pos.ticker) || [];
              
              // Get insider transaction events for this ticker
              const insiderTransactionData = insiderTransactionsMap?.get(pos.ticker) || null;
              
              // Convert insider transactions to events for chart display
              let insiderTransactionEvents: any[] = [];
              if (insiderTransactionData && insiderTransactionData.transactions && insiderTransactionData.transactions.length > 0) {
                // Group by date and create events
                const transactionsByDate = new Map();
                insiderTransactionData.transactions.forEach(transaction => {
                  if (!transactionsByDate.has(transaction.date)) {
                    transactionsByDate.set(transaction.date, []);
                  }
                  transactionsByDate.get(transaction.date).push(transaction);
                });
                
                // Calculate value percentiles for size categories
                const allValues = insiderTransactionData.transactions.map(t => Math.abs(t.value));
                allValues.sort((a, b) => a - b);
                const p25 = allValues[Math.floor(allValues.length * 0.25)] || 0;
                const p75 = allValues[Math.floor(allValues.length * 0.75)] || 0;
                
                transactionsByDate.forEach((transactions, date) => {
                  const totalValue = transactions.reduce((sum: number, t: any) => sum + Math.abs(t.value), 0);
                  const netShares = transactions.reduce((sum: number, t: any) => {
                    const isBuy = t.transaction_type.toLowerCase().includes('purchase') || 
                                  t.transaction_type.toLowerCase().includes('buy');
                    return sum + (isBuy ? t.shares : -t.shares);
                  }, 0);
                  const uniqueInsiders = new Set(transactions.map((t: any) => t.owner_name)).size;
                  const sizeCategory = totalValue < p25 ? 'small' : (totalValue < p75 ? 'medium' : 'large');
                  
                  insiderTransactionEvents.push({
                    date,
                    transactions,
                    totalValue,
                    netShares,
                    insiderCount: uniqueInsiders,
                    sizeCategory,
                  });
                });
              }
              
              const matchingWindows = matchingWindowsMap?.get(pos.ticker) || null;
              
              return {
                pos,
                idx,
                stock,
                precomputedData,
                spacEvents,
                newsEvents,
                financialStatementEvents,
                insiderTransactionEvents,
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
                      insiderTransactionEvents={chart.insiderTransactionEvents}
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
          {(filterDirection || filterIpoDateDirection || filterWithInsiderTransactions || filterPriceAboveIPO || filterIsPipe || showFavoritesOnly) && ' filtered'}
          {' '}stocks
          {(filterDirection || filterIpoDateDirection || filterWithInsiderTransactions || filterPriceAboveIPO || filterIsPipe) && !showFavoritesOnly && (
            <span className="ml-2 text-blue-400">
              (
              {[
                filterDirection && filterPercent > 0 && (
                  filterBusinessDays > 0 
                    ? `${filterDirection} ${filterPercent}% within ${filterBusinessDays} days`
                    : `${filterDirection} ${filterPercent}%`
                ),
                filterIpoDateDirection && filterIpoDate && (
                  `${dataType === 'spac' ? 'IPO' : 'Closing'} ${filterIpoDateDirection} ${filterIpoDate}`
                ),
                filterWithInsiderTransactions && 'Has insider trades',
                filterPriceAboveIPO && 'Price > IPO',
                filterIsPipe && 'Is a pipe',
              ].filter(Boolean).join(' • ')}
              )
            </span>
          )}
          {showFavoritesOnly && (
            <span className="ml-2 text-yellow-400">(Favorites only)</span>
          )}
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
          insiderTransactionsData={insiderTransactionsMap?.get(selectedStock.ticker) || null}
          regressionStats={regressionStats}
          matchingWindows={matchingWindowsMap?.get(selectedStock.ticker) || null}
          filterDirection={filterDirection}
          onClose={() => setSelectedStock(null)}
        />
      )}

      {/* Cross-Company Insiders Modal */}
      {showCrossCompanyInsiders && (
        <CrossCompanyInsidersModal
          insiderTransactionsMap={insiderTransactionsMap}
          regressionStats={regressionStats}
          onClose={() => setShowCrossCompanyInsiders(false)}
          onSelectTicker={handleSearchSelectTicker}
        />
      )}
    </div>
  );
}

export default App;

