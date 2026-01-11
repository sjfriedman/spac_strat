import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  ComposedChart,
  ScatterChart,
  Scatter,
  Cell,
  Legend,
} from 'recharts';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';
import { StockData, PrecomputedChartData, SPACEvent, StockStatistics, TechnicalIndicators, NewsData, NewsEvent, FinancialStatement, FinancialStatementEvent, EarningsData, MatchingWindow, InsiderTransactionsData, InsiderTransaction, RegressionStatsData } from '../types';
import { extractEarningsByPeriod } from '../utils/earningsLoader';
import { calculateStatistics } from '../utils/statistics';
import { calculateTechnicalIndicators } from '../utils/technicalIndicators';
import { getRegressionForPair, getAccuracyColorClass, getAccuracyIcon, formatCorrelation, formatRSquared } from '../utils/regressionStatsLoader';

// Custom clickable label component for Financial Statement events in modal
const FinancialStatementEventLabelModal = ({ viewBox, event, onClick }: any) => {
  if (!viewBox || !event) return null;
  const { x, y } = viewBox;
  const labelHeight = 18;
  const displayText = event.quarter || event.label;
  const textWidth = Math.max(80, displayText.length * 5.5);
  const rectWidth = textWidth + 10;
  const labelY = y - labelHeight - 5;
  
  return (
    <g>
      <defs>
        <filter id={`financial-modal-shadow-${event.date}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.3)"/>
        </filter>
      </defs>
      <rect
        x={x - rectWidth / 2}
        y={labelY}
        width={rectWidth}
        height={labelHeight}
        fill="rgba(17, 24, 39, 0.95)"
        stroke="#06B6D4"
        strokeWidth={2}
        rx={4}
        filter={`url(#financial-modal-shadow-${event.date})`}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          if (onClick) onClick(event.reportDate);
        }}
      />
      <text
        x={x}
        y={labelY + labelHeight / 2 + 4}
        fill="#06B6D4"
        fontSize={9}
        fontWeight="600"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ letterSpacing: '0.3px', cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          if (onClick) onClick(event.reportDate);
        }}
      >
        {displayText}
      </text>
    </g>
  );
};

// Custom label component for SPAC events (handles multiple events on same day)
const SPACEventLabels = ({ viewBox, events }: any) => {
  if (!viewBox || !events || events.length === 0) return null;
  const { x, y } = viewBox;
  const labelHeight = 18;
  const labelSpacing = 2;
  const totalHeight = events.length * (labelHeight + labelSpacing) - labelSpacing;
  const startY = y - totalHeight - 5;
  
  return (
    <g>
      {events.map((event: any, idx: number) => {
        const eventY = startY + idx * (labelHeight + labelSpacing);
        const textWidth = Math.max(70, event.action.length * 5.5);
        const rectWidth = textWidth + 10;
        
        return (
          <g key={idx}>
            {/* Background with subtle shadow */}
            <defs>
              <filter id={`shadow-modal-${idx}`} x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.3)"/>
              </filter>
            </defs>
            <rect
              x={x - rectWidth / 2}
              y={eventY}
              width={rectWidth}
              height={labelHeight}
              fill="rgba(17, 24, 39, 0.95)"
              stroke={event.color}
              strokeWidth={2}
              rx={4}
              filter={`url(#shadow-modal-${idx})`}
            />
            <text
              x={x}
              y={eventY + labelHeight / 2 + 4}
              fill={event.color}
              fontSize={9}
              fontWeight="600"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ letterSpacing: '0.3px' }}
            >
              {event.action}
            </text>
          </g>
        );
      })}
    </g>
  );
};

interface StockDetailModalProps {
  stock: StockData | null;
  precomputedData: PrecomputedChartData | null;
  spacEvents: SPACEvent[];
  newsData?: NewsData | null;
  financialStatements?: FinancialStatement | null;
  earningsData?: EarningsData | null;
  onClose: () => void;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const dataPoint = payload[0]?.payload;
    
    let formattedDate = label;
    if (dataPoint?.date) {
      const date = new Date(dataPoint.date);
      formattedDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });
    }
    
    const price = dataPoint?.close;
    const volume = dataPoint?.volume;
    const pctChange = dataPoint?.pctChange;
    
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-xl">
        <p className="text-sm font-semibold text-gray-300 mb-2">{formattedDate}</p>
        {price !== undefined && (
          <p className="text-lg font-bold text-green-400">
            ${price.toFixed(2)}
          </p>
        )}
        {pctChange !== undefined && (
          <p className={`text-sm mt-1 ${pctChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}% from IPO
          </p>
        )}
        {volume !== undefined && (
          <p className="text-sm text-blue-400 mt-1">
            Volume: {volume.toLocaleString()}
          </p>
        )}
        {dataPoint?.sma20 !== undefined && !isNaN(dataPoint.sma20) && (
          <p className="text-sm text-purple-400 mt-1">
            SMA 20: ${dataPoint.sma20.toFixed(2)}
          </p>
        )}
        {dataPoint?.sma50 !== undefined && !isNaN(dataPoint.sma50) && (
          <p className="text-sm text-purple-400 mt-1">
            SMA 50: ${dataPoint.sma50.toFixed(2)}
          </p>
        )}
        {dataPoint?.rsi !== undefined && !isNaN(dataPoint.rsi) && (
          <p className="text-sm text-yellow-400 mt-1">
            RSI: {dataPoint.rsi.toFixed(2)}
          </p>
        )}
      </div>
    );
  }
  return null;
};

export default function StockDetailModal({ stock, precomputedData, spacEvents, newsData, financialStatements, earningsData, insiderTransactionsData = null, regressionStats = null, matchingWindows = null, filterDirection = null, onClose }: {
  stock: StockData;
  precomputedData: PrecomputedChartData | null;
  spacEvents: SPACEvent[];
  newsData: NewsData | null;
  financialStatements: FinancialStatement | null;
  earningsData: EarningsData | null;
  insiderTransactionsData?: InsiderTransactionsData | null;
  regressionStats?: RegressionStatsData | null;
  matchingWindows?: MatchingWindow[] | null;
  filterDirection?: 'up' | 'down' | null;
  onClose: () => void;
}) {
  const [showSMA20, setShowSMA20] = useState(false);
  const [showSMA50, setShowSMA50] = useState(false);
  const [showSMA200, setShowSMA200] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [showVolumeAnalysis, setShowVolumeAnalysis] = useState(false);
  const [showNewsLines, setShowNewsLines] = useState(true);
  const [showCycles, setShowCycles] = useState(false);
  const [showFinancialStatements, setShowFinancialStatements] = useState(true);
  const [showIpoPrice, setShowIpoPrice] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [showInsiderTransactions, setShowInsiderTransactions] = useState(true);
  const [showStockPriceOverlay, setShowStockPriceOverlay] = useState(false);
  const [selectedSecurityType, setSelectedSecurityType] = useState<string>('all');
  const [isInteractive, setIsInteractive] = useState(false);
  
  // Insider transactions filter states
  const [selectedInsiders, setSelectedInsiders] = useState<Set<string>>(new Set());
  const [selectedTransactionTypes, setSelectedTransactionTypes] = useState<Set<string>>(new Set());
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [insiderDateRange, setInsiderDateRange] = useState<[string, string] | null>(null);
  const [insiderSortField, setInsiderSortField] = useState<'date' | 'value' | 'shares'>('date');
  const [insiderSortDirection, setInsiderSortDirection] = useState<'asc' | 'desc'>('desc');
  const [insiderPage, setInsiderPage] = useState(0);
  const INSIDER_PAGE_SIZE = 50;
  // Custom slider state - stores indices as [startIndex, endIndex]
  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 100]);
  const [committedSliderRange, setCommittedSliderRange] = useState<[number, number]>([0, 100]);
  const [expandedFinancialPeriods, setExpandedFinancialPeriods] = useState<Set<string>>(new Set());

  const financialStatementsRef = useRef<HTMLDivElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const sliderDragTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (sliderDragTimeoutRef.current) {
        clearTimeout(sliderDragTimeoutRef.current);
      }
    };
  }, []);

  if (!stock || !precomputedData) {
    return null;
  }

  // Calculate statistics
  const statistics = useMemo(() => {
    try {
      return calculateStatistics(stock);
    } catch (err) {
      console.error('Error calculating statistics:', err);
      return null;
    }
  }, [stock]);

  // Calculate technical indicators
  const prices = stock.data.map(d => d.close);
  const indicators = useMemo(() => calculateTechnicalIndicators(prices), [prices]);

  // Enhanced chart data with indicators
  const enhancedChartData = useMemo(() => {
    return precomputedData.chartData.map((point, idx) => ({
      ...point,
      sma20: indicators.sma20[idx],
      sma50: indicators.sma50[idx],
      sma200: indicators.sma200[idx],
      rsi: indicators.rsi[idx],
      macd: indicators.macd.macd[idx],
      signal: indicators.macd.signal[idx],
      histogram: indicators.macd.histogram[idx],
      avgVolume: statistics?.avgVolume || 0,
      volumeSpike: statistics && point.volume > statistics.avgVolume * 2,
    }));
  }, [precomputedData.chartData, indicators, statistics]);

  // Reset zoom when interactive mode is turned off or initialize when turned on
  useEffect(() => {
    if (!isInteractive) {
      const maxIndex = enhancedChartData.length - 1;
      setSliderRange([0, maxIndex]);
      setCommittedSliderRange([0, maxIndex]);
      if (sliderDragTimeoutRef.current) {
        clearTimeout(sliderDragTimeoutRef.current);
        sliderDragTimeoutRef.current = null;
      }
    } else {
      // Initialize slider range when entering zoom mode
      const maxIndex = enhancedChartData.length - 1;
      setSliderRange([0, maxIndex]);
      setCommittedSliderRange([0, maxIndex]);
    }
  }, [isInteractive, enhancedChartData.length]);

  // Filter and adjust chart data based on slider range
  const adjustedChartData = useMemo(() => {
    if (!isInteractive) {
      return enhancedChartData;
    }
    
    const [startIndex, endIndex] = committedSliderRange;
    const basePrice = enhancedChartData[startIndex]?.close;
    console.log('Modal recalculating pctChange:', { 
      startIndex, 
      endIndex,
      basePrice,
      isInteractive,
      firstDate: enhancedChartData[startIndex]?.dateShort,
      lastDate: enhancedChartData[endIndex]?.dateShort
    });
    if (!basePrice) return enhancedChartData;
    
    // Filter to the selected range and recalculate pctChange
    return enhancedChartData.slice(startIndex, endIndex + 1).map(point => ({
      ...point,
      pctChange: ((point.close - basePrice) / basePrice) * 100
    }));
  }, [enhancedChartData, isInteractive, committedSliderRange]);

  // Recalculate pctChange range for the adjusted data
  const adjustedPctChangeRange = useMemo(() => {
    if (!isInteractive) {
      return precomputedData.pctChangeRange;
    }
    
    const pctChanges = adjustedChartData.map(d => d.pctChange);
    return {
      min: Math.min(...pctChanges),
      max: Math.max(...pctChanges)
    };
  }, [adjustedChartData, isInteractive, precomputedData.pctChangeRange]);

  // Get event color
  const getEventColor = (action: string): string => {
    const lowerAction = action.toLowerCase();
    if (lowerAction.includes('merger vote')) return '#EF4444';
    if (lowerAction.includes('extension vote')) return '#F59E0B';
    if (lowerAction.includes('de-spac') || lowerAction.includes('listed')) return '#10B981';
    if (lowerAction.includes('split')) return '#3B82F6';
    if (lowerAction.includes('ipo')) return '#8B5CF6';
    return '#6B7280';
  };

  // Get news sentiment color
  const getNewsSentimentColor = (sentimentLabel: string): string => {
    if (sentimentLabel === 'Bullish') return '#10B981';
    if (sentimentLabel === 'Bearish') return '#EF4444';
    return '#6B7280';
  };

  // Memoized format functions for better performance during zoom
  const formatPrice = useMemo(() => (value: number) => `$${value.toFixed(2)}`, []);
  
  const formatPctChange = useMemo(() => (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  }, []);
  
  const formatVolume = useMemo(() => (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return value.toString();
  }, []);
  
  const formatXAxisTick = useMemo(() => (dateShort: string): string => {
    try {
      const parts = dateShort.split(',');
      if (parts.length < 2) return dateShort;
      const year = parts[1].trim();
      const monthName = parts[0].split(' ')[0];
      const monthMap: Record<string, number> = {
        'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
        'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
      };
      const month = monthMap[monthName];
      if (!month) return dateShort;
      return `${month}/${year}`;
    } catch {
      return dateShort;
    }
  }, []);

  // RSI range for separate chart
  const rsiRange = useMemo(() => {
    const rsiValues = indicators.rsi.filter(v => !isNaN(v));
    if (rsiValues.length === 0) return { min: 0, max: 100 };
    return {
      min: Math.max(0, Math.min(...rsiValues) - 5),
      max: Math.min(100, Math.max(...rsiValues) + 5),
    };
  }, [indicators.rsi]);

  // MACD range
  const macdRange = useMemo(() => {
    const macdValues = [...indicators.macd.macd, ...indicators.macd.signal].filter(v => !isNaN(v));
    if (macdValues.length === 0) return { min: -1, max: 1 };
    const min = Math.min(...macdValues);
    const max = Math.max(...macdValues);
    const range = max - min;
    return {
      min: min - range * 0.1,
      max: max + range * 0.1,
    };
  }, [indicators.macd]);

  // Extract earnings by period
  const earningsByPeriod = useMemo(() => {
    if (!earningsData) return new Map();
    return extractEarningsByPeriod(earningsData);
  }, [earningsData]);

  // ========= Insider Transactions Processing =========
  
  // Color palette for charts
  const INSIDER_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', 
                          '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'];
  
  // Extract unique values for filters
  const uniqueInsiders = useMemo(() => {
    if (!insiderTransactionsData?.transactions) return [];
    const names = new Set<string>();
    insiderTransactionsData.transactions.forEach(t => names.add(t.owner_name));
    return Array.from(names).sort();
  }, [insiderTransactionsData]);

  const uniqueTransactionTypes = useMemo(() => {
    if (!insiderTransactionsData?.transactions) return [];
    const types = new Set<string>();
    insiderTransactionsData.transactions.forEach(t => types.add(t.transaction_type));
    return Array.from(types).sort();
  }, [insiderTransactionsData]);

  const uniquePositions = useMemo(() => {
    if (!insiderTransactionsData?.transactions) return [];
    const positions = new Set<string>();
    insiderTransactionsData.transactions.forEach(t => {
      if (t.position) positions.add(t.position);
    });
    return Array.from(positions).sort();
  }, [insiderTransactionsData]);
  
  // Get available security types with counts (based on current filters)
  const availableSecurityTypes = useMemo(() => {
    if (!insiderTransactionsData?.transactions) return [];
    
    let filtered = insiderTransactionsData.transactions;
    
    // Apply all filters except security type
    if (selectedInsiders.size > 0) {
      filtered = filtered.filter(t => selectedInsiders.has(t.owner_name));
    }
    
    if (selectedTransactionTypes.size > 0) {
      filtered = filtered.filter(t => selectedTransactionTypes.has(t.transaction_type));
    }
    
    if (selectedPositions.size > 0) {
      filtered = filtered.filter(t => selectedPositions.has(t.position));
    }
    
    if (insiderDateRange) {
      const [start, end] = insiderDateRange;
      filtered = filtered.filter(t => t.date >= start && t.date <= end);
    }
    
    // Count by security type
    const typeCounts = new Map<string, number>();
    filtered.forEach(t => {
      const type = t.security_type || 'Unknown';
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    });
    
    // Return sorted by count (descending)
    return Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [insiderTransactionsData, selectedInsiders, selectedTransactionTypes, selectedPositions, insiderDateRange]);
  
  // Set default security type to the one with most transactions
  // Also update if current selection is no longer available
  useEffect(() => {
    if (availableSecurityTypes.length > 0) {
      const availableTypes = availableSecurityTypes.map(st => st.type);
      
      // If current selection is not available (but keep 'all' if user selected it)
      if (selectedSecurityType !== 'all' && !availableTypes.includes(selectedSecurityType)) {
        const mostCommon = availableSecurityTypes[0].type;
        setSelectedSecurityType(mostCommon);
      }
    }
  }, [availableSecurityTypes, selectedSecurityType]);
  
  // Filter and sort transactions
  const filteredInsiderTransactions = useMemo(() => {
    if (!insiderTransactionsData?.transactions) return [];
    
    let filtered = insiderTransactionsData.transactions;
    
    // Apply filters
    if (selectedInsiders.size > 0) {
      filtered = filtered.filter(t => selectedInsiders.has(t.owner_name));
    }
    
    if (selectedTransactionTypes.size > 0) {
      filtered = filtered.filter(t => selectedTransactionTypes.has(t.transaction_type));
    }
    
    if (selectedPositions.size > 0) {
      filtered = filtered.filter(t => selectedPositions.has(t.position));
    }
    
    if (insiderDateRange) {
      const [start, end] = insiderDateRange;
      filtered = filtered.filter(t => t.date >= start && t.date <= end);
    }
    
    // Apply security type filter
    if (selectedSecurityType && selectedSecurityType !== 'all') {
      filtered = filtered.filter(t => (t.security_type || 'Unknown') === selectedSecurityType);
    }
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      if (insiderSortField === 'date') {
        comparison = a.date.localeCompare(b.date);
      } else if (insiderSortField === 'value') {
        comparison = Math.abs(a.value) - Math.abs(b.value);
      } else if (insiderSortField === 'shares') {
        comparison = a.shares - b.shares;
      }
      return insiderSortDirection === 'asc' ? comparison : -comparison;
    });
    
    return sorted;
  }, [insiderTransactionsData, selectedInsiders, selectedTransactionTypes, 
      selectedPositions, insiderDateRange, selectedSecurityType, insiderSortField, insiderSortDirection]);
  
  // Calculate summary statistics
  const insiderSummaryStats = useMemo(() => {
    const netShares = filteredInsiderTransactions.reduce((sum, t) => {
      const isBuy = t.transaction_type.toLowerCase().includes('purchase') || 
                    t.transaction_type.toLowerCase().includes('buy');
      return sum + (isBuy ? t.shares : -t.shares);
    }, 0);
    
    const totalValue = filteredInsiderTransactions.reduce((sum, t) => 
      sum + Math.abs(t.value), 0
    );
    
    const uniqueInsidersCount = new Set(filteredInsiderTransactions.map(t => t.owner_name)).size;
    
    return { netShares, totalValue, uniqueInsidersCount };
  }, [filteredInsiderTransactions]);
  
  // Prepare cumulative ownership data (calculated from transaction history)
  const cumulativeOwnershipData = useMemo(() => {
    if (!filteredInsiderTransactions.length) return { chartData: [], insiders: [], transactionTypes: new Map() };
    
    // Group by insider and calculate cumulative shares from buy/sell transactions
    const insiderHoldings = new Map<string, Map<string, number>>(); // insider -> date -> cumulative shares
    const transactionTypes = new Map<string, Map<string, 'buy' | 'sell'>>(); // insider -> date -> transaction type
    
    // Sort transactions by date
    const sorted = [...filteredInsiderTransactions].sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate cumulative holdings for each insider
    sorted.forEach(t => {
      if (!insiderHoldings.has(t.owner_name)) {
        insiderHoldings.set(t.owner_name, new Map<string, number>());
        transactionTypes.set(t.owner_name, new Map<string, 'buy' | 'sell'>());
      }
      
      const holdings = insiderHoldings.get(t.owner_name)!;
      const types = transactionTypes.get(t.owner_name)!;
      
      // Get the most recent holding value
      const dates = Array.from(holdings.keys()).sort();
      const lastHolding = dates.length > 0 ? holdings.get(dates[dates.length - 1])! : 0;
      
      // Calculate new holding based on transaction type
      const isBuy = t.transaction_type.toLowerCase().includes('buy') || 
                    t.transaction_type.toLowerCase().includes('purchase');
      const newHolding = isBuy ? lastHolding + t.shares : lastHolding - t.shares;
      
      // Store the cumulative holding at this date
      holdings.set(t.date, Math.max(0, newHolding)); // Prevent negative holdings
      // Store transaction type for this date
      types.set(t.date, isBuy ? 'buy' : 'sell');
    });
    
    // Convert to chart format
    const allDates = Array.from(new Set(sorted.map(t => t.date))).sort();
    
    // Create a map of stock prices by date for quick lookup
    const stockPriceMap = new Map<string, number>();
    if (stock?.data) {
      stock.data.forEach(point => {
        const dateStr = point.date.split('T')[0]; // Extract YYYY-MM-DD from date
        stockPriceMap.set(dateStr, point.close);
      });
    }
    
    const chartData = allDates.map(date => {
      const point: any = { date };
      insiderHoldings.forEach((holdings, insider) => {
        // Find the most recent holding at or before this date
        const relevantDates = Array.from(holdings.keys()).filter(d => d <= date).sort();
        if (relevantDates.length > 0) {
          const latestDate = relevantDates[relevantDates.length - 1];
          point[insider] = holdings.get(latestDate)!;
          
          // Store transaction type for this date if there's a transaction on this exact date
          const types = transactionTypes.get(insider)!;
          if (types.has(date)) {
            point[`${insider}_type`] = types.get(date);
          }
        }
      });
      
      // Add stock price for this date (find closest available price)
      // Always include when showStockPriceOverlay is true OR when we'll detect near-zero ownership
      if (stockPriceMap.size > 0) {
        // Try exact match first
        if (stockPriceMap.has(date)) {
          point.stockPrice = stockPriceMap.get(date);
        } else {
          // Find closest date (before or after)
          const stockDates = Array.from(stockPriceMap.keys()).sort();
          const dateObj = new Date(date);
          
          // Find closest date
          let closestDate: string | null = null;
          let minDiff = Infinity;
          
          stockDates.forEach(stockDate => {
            const stockDateObj = new Date(stockDate);
            const diff = Math.abs(dateObj.getTime() - stockDateObj.getTime());
            if (diff < minDiff) {
              minDiff = diff;
              closestDate = stockDate;
            }
          });
          
          // Only use if within 30 days
          if (closestDate && minDiff < 30 * 24 * 60 * 60 * 1000) {
            point.stockPrice = stockPriceMap.get(closestDate);
          }
        }
      }
      
      return point;
    });
    
    return { 
      chartData, 
      insiders: Array.from(insiderHoldings.keys()),
      transactionTypes 
    };
  }, [filteredInsiderTransactions, stock]);
  
  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return selectedInsiders.size > 0 || 
           selectedTransactionTypes.size > 0 || 
           selectedPositions.size > 0 || 
           insiderDateRange !== null ||
           (selectedSecurityType !== 'all' && availableSecurityTypes.length > 1);
  }, [selectedInsiders, selectedTransactionTypes, selectedPositions, insiderDateRange, selectedSecurityType, availableSecurityTypes]);
  
  // Check if ownership is near zero (max ownership < 1000 shares) OR if there's only one transaction
  const isOwnershipNearZero = useMemo(() => {
    if (cumulativeOwnershipData.chartData.length === 0) return false;
    
    // Check if there's only one transaction in the filtered set
    if (filteredInsiderTransactions.length <= 1) return true;
    
    // Check if there's only one unique transaction date with ownership data
    const datesWithData = cumulativeOwnershipData.chartData.filter(point => {
      return cumulativeOwnershipData.insiders.some(insider => point[insider] && point[insider] > 0);
    });
    
    // If only one date has ownership data, show stock price chart
    if (datesWithData.length <= 1) return true;
    
    // Otherwise check if ownership is near zero
    let maxOwnership = 0;
    cumulativeOwnershipData.insiders.forEach(insider => {
      cumulativeOwnershipData.chartData.forEach(point => {
        const value = point[insider] || 0;
        maxOwnership = Math.max(maxOwnership, value);
      });
    });
    
    return maxOwnership < 1000; // Less than 1000 shares
  }, [cumulativeOwnershipData, filteredInsiderTransactions]);
  
  // Get transaction types for stock price data points
  const stockPriceTransactionTypes = useMemo(() => {
    const typeMap = new Map<string, 'buy' | 'sell'>();
    filteredInsiderTransactions.forEach(t => {
      const isBuy = t.transaction_type.toLowerCase().includes('buy') || 
                    t.transaction_type.toLowerCase().includes('purchase');
      typeMap.set(t.date, isBuy ? 'buy' : 'sell');
    });
    return typeMap;
  }, [filteredInsiderTransactions]);
  
  // Create stock price chart data when ownership is near zero
  const stockPriceChartData = useMemo(() => {
    if (!stock?.data || !isOwnershipNearZero) return { chartData: [], prePriceTransactions: [] };
    
    // Get first stock price date
    const firstPriceDate = stock.data[0]?.date.split('T')[0];
    if (!firstPriceDate) return { chartData: [], prePriceTransactions: [] };
    
    // Separate transactions into pre-price and during-price periods
    const prePriceTransactions: Array<{ date: string; transactions: typeof filteredInsiderTransactions; transactionType: 'buy' | 'sell' }> = [];
    const transactionsByDate = new Map<string, typeof filteredInsiderTransactions>();
    
    filteredInsiderTransactions.forEach(t => {
      if (t.date < firstPriceDate) {
        // Pre-price transaction
        const existing = prePriceTransactions.find(p => p.date === t.date);
        if (existing) {
          existing.transactions.push(t);
        } else {
          const isBuy = t.transaction_type.toLowerCase().includes('buy') || 
                        t.transaction_type.toLowerCase().includes('purchase');
          prePriceTransactions.push({
            date: t.date,
            transactions: [t],
            transactionType: isBuy ? 'buy' : 'sell'
          });
        }
      } else {
        // During price period
        if (!transactionsByDate.has(t.date)) {
          transactionsByDate.set(t.date, []);
        }
        transactionsByDate.get(t.date)!.push(t);
      }
    });
    
    // Sort pre-price transactions by date
    prePriceTransactions.sort((a, b) => a.date.localeCompare(b.date));
    
    // Create placeholder data points for pre-price transaction dates (with null stockPrice)
    const prePriceDataPoints = prePriceTransactions.map(preTx => ({
      date: preTx.date,
      stockPrice: null as number | null,
      hasTransaction: true,
      transactionType: preTx.transactionType,
      transactions: preTx.transactions,
      isPrePrice: true,
    }));
    
    // Create chart data from stock price data
    const chartData = stock.data.map(point => {
      const dateStr = point.date.split('T')[0];
      const transactions = transactionsByDate.get(dateStr) || [];
      const hasTransaction = transactions.length > 0;
      const transactionType = hasTransaction 
        ? (transactions[0].transaction_type.toLowerCase().includes('buy') || 
           transactions[0].transaction_type.toLowerCase().includes('purchase') ? 'buy' : 'sell')
        : null;
      
      return {
        date: dateStr,
        stockPrice: point.close,
        hasTransaction,
        transactionType,
        transactions, // Include full transaction details for tooltip
        isPrePrice: false,
      };
    });
    
    // Combine pre-price and price data, sorted by date
    const allChartData = [...prePriceDataPoints, ...chartData].sort((a, b) => a.date.localeCompare(b.date));
    
    return { chartData: allChartData, prePriceTransactions };
  }, [stock, isOwnershipNearZero, filteredInsiderTransactions]);
  
  // Custom dot component for buy/sell indicators on ownership lines
  const TransactionDot = (props: any) => {
    const { cx, cy, payload, dataKey } = props;
    if (!hasActiveFilters) return null;
    
    const transactionType = payload?.[`${dataKey}_type`];
    if (!transactionType) return null;
    
    const color = transactionType === 'buy' ? '#10B981' : '#EF4444';
    const radius = 5;
    
    return (
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        stroke="#1F2937"
        strokeWidth={2}
      />
    );
  };
  
  // Custom dot component for buy/sell indicators on stock price line
  const StockPriceTransactionDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (!hasActiveFilters) return null;
    
    const date = payload?.date;
    if (!date) return null;
    
    const transactionType = stockPriceTransactionTypes.get(date);
    if (!transactionType) return null;
    
    const color = transactionType === 'buy' ? '#10B981' : '#EF4444';
    const radius = 5;
    
    return (
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        stroke="#1F2937"
        strokeWidth={2}
      />
    );
  };
  
  // Paginated transactions
  const paginatedTransactions = useMemo(() => {
    const start = insiderPage * INSIDER_PAGE_SIZE;
    const end = start + INSIDER_PAGE_SIZE;
    return filteredInsiderTransactions.slice(start, end);
  }, [filteredInsiderTransactions, insiderPage]);

  const totalInsiderPages = Math.ceil(filteredInsiderTransactions.length / INSIDER_PAGE_SIZE);
  
  // Helper functions for insider transactions
  const handleInsiderSort = (field: typeof insiderSortField) => {
    if (insiderSortField === field) {
      setInsiderSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setInsiderSortField(field);
      setInsiderSortDirection('desc');
    }
    setInsiderPage(0); // Reset to first page
  };

  const getInsiderSortIcon = (field: typeof insiderSortField) => {
    if (insiderSortField !== field) return '↕';
    return insiderSortDirection === 'asc' ? '↑' : '↓';
  };

  const clearAllInsiderFilters = () => {
    setSelectedInsiders(new Set());
    setSelectedTransactionTypes(new Set());
    setSelectedPositions(new Set());
    setInsiderDateRange(null);
    setSelectedSecurityType('all'); // Will be reset to most common by useEffect
    setInsiderPage(0);
  };

  // Process financial statements to group by quarter/year
  const financialPeriods = useMemo(() => {
    if (!financialStatements) return [];
    
    const periods = new Map<string, {
      quarter: string;
      reportDate: string;
      fiscalDateEnding: string;
      balanceSheet: any;
      cashFlow: any;
      incomeStatement: any;
      reportedEPS: number | null;
      estimatedEPS: number | null;
    }>();
    
    // Helper to get quarter from fiscal date
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
    
    // Process all three statement types
    const statementTypes = [
      { key: 'balanceSheet', data: financialStatements.balanceSheet },
      { key: 'cashFlow', data: financialStatements.cashFlow },
      { key: 'incomeStatement', data: financialStatements.incomeStatement }
    ];
    
    for (const stmtType of statementTypes) {
      const statement = stmtType.data;
      if (!statement) continue;
      
      // Process quarterly reports
      if (statement.quarterlyReports && Array.isArray(statement.quarterlyReports)) {
        for (const report of statement.quarterlyReports) {
          const reportDate = extractReportDate(report);
          const fiscalDateEnding = report.fiscalDateEnding || reportDate;
          const quarter = fiscalDateToQuarterYear(fiscalDateEnding);
          
          if (!reportDate || !quarter) continue;
          
          const periodKey = reportDate;
          if (!periods.has(periodKey)) {
            // Try to match earnings data by quarter and fiscal date
            const earningsKey = `${quarter}-${fiscalDateEnding}`;
            const earnings = earningsByPeriod.get(earningsKey);
            
            periods.set(periodKey, {
              quarter,
              reportDate,
              fiscalDateEnding,
              balanceSheet: null,
              cashFlow: null,
              incomeStatement: null,
              reportedEPS: earnings?.reportedEPS ?? null,
              estimatedEPS: earnings?.estimatedEPS ?? null
            });
          }
          
          const period = periods.get(periodKey)!;
          if (stmtType.key === 'balanceSheet') period.balanceSheet = report;
          if (stmtType.key === 'cashFlow') period.cashFlow = report;
          if (stmtType.key === 'incomeStatement') period.incomeStatement = report;
        }
      }
      
      // Process annual reports
      if (statement.annualReports && Array.isArray(statement.annualReports)) {
        for (const report of statement.annualReports) {
          const reportDate = extractReportDate(report);
          const fiscalDateEnding = report.fiscalDateEnding || reportDate;
          const quarter = fiscalDateToQuarterYear(fiscalDateEnding);
          
          if (!reportDate || !quarter) continue;
          
          const periodKey = reportDate;
          if (!periods.has(periodKey)) {
            // Try to match earnings data by quarter and fiscal date
            const earningsKey = `${quarter}-${fiscalDateEnding}`;
            const earnings = earningsByPeriod.get(earningsKey);
            
            periods.set(periodKey, {
              quarter,
              reportDate,
              fiscalDateEnding,
              balanceSheet: null,
              cashFlow: null,
              incomeStatement: null,
              reportedEPS: earnings?.reportedEPS ?? null,
              estimatedEPS: earnings?.estimatedEPS ?? null
            });
          }
          
          const period = periods.get(periodKey)!;
          if (stmtType.key === 'balanceSheet') period.balanceSheet = report;
          if (stmtType.key === 'cashFlow') period.cashFlow = report;
          if (stmtType.key === 'incomeStatement') period.incomeStatement = report;
        }
      }
    }
    
    // Sort by date (most recent first)
    return Array.from(periods.values()).sort((a, b) => b.reportDate.localeCompare(a.reportDate));
  }, [financialStatements, earningsByPeriod]);
  
  const toggleFinancialPeriod = (periodKey: string) => {
    setExpandedFinancialPeriods(prev => {
      const newSet = new Set(prev);
      if (newSet.has(periodKey)) {
        newSet.delete(periodKey);
      } else {
        newSet.add(periodKey);
      }
      return newSet;
    });
  };

  // Extract financial statement events for chart display
  const financialStatementEvents = useMemo(() => {
    if (!financialStatements) return [];
    
    const events: FinancialStatementEvent[] = [];
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
      { key: 'balanceSheet', data: financialStatements.balanceSheet },
      { key: 'cashFlow', data: financialStatements.cashFlow },
      { key: 'incomeStatement', data: financialStatements.incomeStatement }
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
        ticker: financialStatements.ticker,
        quarter,
        fiscalDateEnding,
        reportDate,
        label
      });
    }
    
    events.sort((a, b) => b.date.localeCompare(a.date));
    return events;
  }, [financialStatements]);

  // Scroll to financial statements section
  const scrollToFinancialPeriod = (reportDate: string) => {
    if (financialStatementsRef.current) {
      // Expand the period if not already expanded
      if (!expandedFinancialPeriods.has(reportDate)) {
        toggleFinancialPeriod(reportDate);
      }
      // Scroll to the section
      setTimeout(() => {
        financialStatementsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

  // Get news events for chart
  const newsEvents = useMemo(() => {
    if (!newsData || !newsData.feed || newsData.feed.length === 0) return [];
    
    return newsData.feed.map(article => {
      const timePublished = article.time_published;
      let date = '';
      if (timePublished && timePublished.length >= 8) {
        const dateStr = timePublished.substring(0, 8);
        date = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
      }
      const tickerSentiment = article.ticker_sentiment?.find(ts => ts.ticker === stock?.ticker);
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
    }).filter(event => event.date !== '');
  }, [newsData, stock]);
  
  // Helper to render financial statement fields dynamically
  const renderStatementFields = (report: any, title: string) => {
    if (!report) return null;
    
    // Get all fields except metadata fields
    const excludeFields = ['fiscalDateEnding', 'reportedCurrency', 'reportDate', 'date'];
    const fields = Object.entries(report)
      .filter(([key, value]) => {
        // Exclude metadata fields
        if (excludeFields.includes(key)) return false;
        // Exclude None, null, or undefined values (but keep 0)
        if (value === null || value === undefined) return false;
        if (typeof value === 'string' && (value.toLowerCase() === 'none' || value === '')) return false;
        return true;
      })
      .sort(([a], [b]) => a.localeCompare(b));
    
    if (fields.length === 0) return null;
    
    return (
      <div className="mb-4">
        <h5 className="text-sm font-semibold text-gray-300 mb-2">{title}</h5>
        <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {fields.map(([key, value]) => (
                <tr key={key} className="border-b border-gray-700">
                  <td className="py-1.5 pr-4 text-gray-400 font-medium">{key}</td>
                  <td className="py-1.5 text-gray-200 text-right">
                    {typeof value === 'string' || typeof value === 'number' 
                      ? (typeof value === 'number' ? value.toLocaleString() : value)
                      : JSON.stringify(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        ref={modalContainerRef}
        className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-7xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 p-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-2xl font-bold text-white">{stock.ticker}</h2>
            <p className="text-sm text-gray-400">IPO: {new Date(stock.ipoDate).toLocaleDateString()}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLegend(!showLegend)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                showLegend
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
              title={showLegend ? 'Hide Legend' : 'Show Legend'}
            >
              {showLegend ? 'Hide Legend' : 'Show Legend'}
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-2"
              title="Close (Esc)"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-6">
          {/* Statistics Table */}
          {statistics && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-4">Performance Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-400 mb-1">IPO Price</p>
                  <p className="text-white font-semibold">${statistics.ipoPrice.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Current Price</p>
                  <p className="text-white font-semibold">${statistics.currentPrice.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Total Return</p>
                  <p className={`font-semibold ${statistics.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {statistics.totalReturnPct >= 0 ? '+' : ''}{statistics.totalReturnPct.toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Total Days</p>
                  <p className="text-white font-semibold">{statistics.totalDays}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Max Price</p>
                  <p className="text-white font-semibold">${statistics.maxPrice.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Min Price</p>
                  <p className="text-white font-semibold">${statistics.minPrice.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Max Drawdown</p>
                  <p className="text-red-400 font-semibold">-{statistics.maxDrawdownPct.toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Volatility (Annualized)</p>
                  <p className="text-white font-semibold">{(statistics.volatility * 100).toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Days to Peak</p>
                  <p className="text-white font-semibold">{statistics.daysToPeak}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Days to Trough</p>
                  <p className="text-white font-semibold">{statistics.daysToTrough}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Recovery Days</p>
                  <p className="text-white font-semibold">{statistics.recoveryDays !== null ? statistics.recoveryDays : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Days Above IPO</p>
                  <p className="text-green-400 font-semibold">{statistics.daysAboveIPO}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Days Below IPO</p>
                  <p className="text-red-400 font-semibold">{statistics.daysBelowIPO}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Avg Volume</p>
                  <p className="text-white font-semibold">{formatVolume(statistics.avgVolume)}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Volume Spikes</p>
                  <p className="text-blue-400 font-semibold">{statistics.volumeSpikes}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Peak Date</p>
                  <p className="text-white font-semibold text-xs">{new Date(statistics.peakDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-gray-400 mb-1">Trough Date</p>
                  <p className="text-white font-semibold text-xs">{new Date(statistics.troughDate).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Analysis Options */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Analysis Options</h3>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-300 mb-2">Technical Indicators</p>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showSMA20}
                      onChange={(e) => setShowSMA20(e.target.checked)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-purple-500 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-300">SMA 20</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showSMA50}
                      onChange={(e) => setShowSMA50(e.target.checked)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-purple-500 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-300">SMA 50</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showSMA200}
                      onChange={(e) => setShowSMA200(e.target.checked)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-purple-500 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-300">SMA 200</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showRSI}
                      onChange={(e) => setShowRSI(e.target.checked)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-yellow-500 focus:ring-yellow-500"
                    />
                    <span className="text-sm text-gray-300">RSI</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showMACD}
                      onChange={(e) => setShowMACD(e.target.checked)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-300">MACD</span>
                  </label>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-300 mb-2">Volume Analysis</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showVolumeAnalysis}
                    onChange={(e) => setShowVolumeAnalysis(e.target.checked)}
                    className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-300">Show Volume Spikes & Average</span>
                </label>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-300 mb-2">Chart Events</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showNewsLines}
                    onChange={(e) => setShowNewsLines(e.target.checked)}
                    className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-green-500 focus:ring-green-500"
                  />
                  <span className="text-sm text-gray-300">Show News Event Lines</span>
                </label>
              </div>
              {matchingWindows && matchingWindows.length > 0 && filterDirection && (
                <div>
                  <p className="text-sm font-medium text-gray-300 mb-2">Cycle Analysis</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showCycles}
                      onChange={(e) => setShowCycles(e.target.checked)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-cyan-500 focus:ring-cyan-500"
                    />
                    <span className="text-sm text-gray-300">Show Matching Cycle Windows</span>
                  </label>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-gray-300 mb-2">Reference Lines</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showIpoPrice}
                      onChange={(e) => setShowIpoPrice(e.target.checked)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-amber-500 focus:ring-amber-500"
                    />
                    <span className="text-sm text-gray-300">Show IPO Price Line</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showFinancialStatements}
                      onChange={(e) => setShowFinancialStatements(e.target.checked)}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-cyan-500 focus:ring-cyan-500"
                    />
                    <span className="text-sm text-gray-300">Show Financial Statement Bubbles (Q#)</span>
                  </label>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-300 mb-2">Chart Controls</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInteractive}
                    onChange={(e) => {
                      setIsInteractive(e.target.checked);
                    }}
                    className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-purple-500 focus:ring-purple-500"
                  />
                  <span className="text-sm text-gray-300">Enable Zoom & Pan</span>
                </label>
              </div>
            </div>
          </div>

          {/* Legend */}
          {showLegend && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-3">Chart Legend</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                {/* Financial Statements Section */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-300 mb-2">Financial Statements</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-0.5 bg-cyan-500"></div>
                      <span className="text-sm text-gray-300">Quarterly Reports</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-cyan-500 rounded"></div>
                      <span className="text-sm text-gray-300">Click to jump to section</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Hover over vertical lines on the chart to see event details. Click financial statement bubbles to jump to that period.
              </p>
            </div>
          )}

          {/* Main Price Chart */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Price Chart</h3>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={adjustedChartData} margin={{ top: 50, right: 10, left: 0, bottom: 5 }} syncId="comprehensiveSync">
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis
                    dataKey="dateShort"
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF', fontSize: 10 }}
                    interval="preserveStartEnd"
                    tickFormatter={formatXAxisTick}
                  />
                  <YAxis
                    domain={[Math.max(0, precomputedData.priceRange.min), precomputedData.priceRange.max]}
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF', fontSize: 10 }}
                    width={70}
                    tickFormatter={formatPrice}
                    orientation="left"
                  />
                  <YAxis
                    yAxisId="right"
                    domain={[adjustedPctChangeRange.min, adjustedPctChangeRange.max]}
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF', fontSize: 10 }}
                    width={70}
                    tickFormatter={formatPctChange}
                    orientation="right"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {showIpoPrice && (
                    <ReferenceLine
                      y={precomputedData.ipoPrice}
                      stroke="#F59E0B"
                      strokeDasharray="2 2"
                    />
                  )}
                  {/* Matching windows highlighting (only when cycle toggle is active) */}
                  {showCycles && matchingWindows && matchingWindows.length > 0 && filterDirection && (
                    <>
                      {matchingWindows.map((window, idx) => {
                        // Find matching dateShort in chartData
                        const startPoint = enhancedChartData.find(d => d.date === window.startDate);
                        const endPoint = enhancedChartData.find(d => d.date === window.endDate);
                        
                        if (!startPoint || !endPoint) {
                          return null;
                        }
                        
                        // Alternate between two shades for easier distinction when windows overlap
                        const isEven = idx % 2 === 0;
                        let fillColor: string;
                        let arrowColor: string;
                        
                        if (filterDirection === 'up') {
                          // Alternate between lighter and darker green with more contrast
                          fillColor = isEven 
                            ? 'rgba(34, 197, 94, 0.3)'      // Brighter green (emerald-500, higher opacity)
                            : 'rgba(5, 150, 105, 0.25)';    // Darker green (emerald-600, lower opacity)
                          arrowColor = '#10B981';  // Green
                        } else {
                          // Alternate between lighter and darker red with more contrast
                          fillColor = isEven
                            ? 'rgba(239, 68, 68, 0.3)'     // Brighter red (red-500, higher opacity)
                            : 'rgba(185, 28, 28, 0.25)';   // Darker red (red-700, lower opacity)
                          arrowColor = '#EF4444';  // Red
                        }
                        
                        return (
                          <React.Fragment key={`window-${window.startIdx}-${window.endIdx}-${idx}`}>
                            <ReferenceArea
                              x1={startPoint.dateShort}
                              x2={endPoint.dateShort}
                              fill={fillColor}
                              stroke="none"
                            />
                            {/* Red/Green arrow at end of matching window */}
                            <ReferenceLine
                              x={endPoint.dateShort}
                              stroke={arrowColor}
                              strokeWidth={3}
                              label={{
                                value: '▼',
                                position: 'top',
                                fill: arrowColor,
                                fontSize: 16,
                                fontWeight: 'bold',
                              }}
                            />
                          </React.Fragment>
                        );
                      })}
                    </>
                  )}
                  {/* SPAC Event lines - grouped by date */}
                  {(() => {
                    // Group events by date
                    const eventsByDate = new Map<string, Array<{ action: string; color: string }>>();
                    spacEvents
                      .filter(event => {
                        const dataPoint = enhancedChartData.find(d => d.date === event.date);
                        return dataPoint !== undefined;
                      })
                      .forEach(event => {
                        if (!eventsByDate.has(event.date)) {
                          eventsByDate.set(event.date, []);
                        }
                        eventsByDate.get(event.date)!.push({
                          action: event.action,
                          color: getEventColor(event.action),
                        });
                      });

                    // Render one ReferenceLine per unique date with grouped labels
                    return Array.from(eventsByDate.entries()).map(([date, events], idx) => {
                      const dataPoint = enhancedChartData.find(d => d.date === date);
                      if (!dataPoint) return null;
                      
                      // Use the color of the first event for the line, or a neutral color if multiple
                      const lineColor = events.length === 1 ? events[0].color : '#9CA3AF';
                      
                      return (
                        <ReferenceLine
                          key={`${date}-${idx}`}
                          x={dataPoint.dateShort}
                          stroke={lineColor}
                          strokeWidth={2}
                          strokeDasharray="4 2"
                          label={<SPACEventLabels events={events} />}
                        />
                      );
                    });
                  })()}
                  {/* Financial Statement Event vertical lines */}
                  {showFinancialStatements && (() => {
                    if (financialStatementEvents.length === 0) return null;
                    
                    return financialStatementEvents
                      .filter(event => {
                        if (!event.date) return false;
                        const dataPoint = enhancedChartData.find(d => d.date === event.date);
                        return dataPoint !== undefined;
                      })
                      .map((event, idx) => {
                        const dataPoint = enhancedChartData.find(d => d.date === event.date);
                        if (!dataPoint) return null;
                        
                        return (
                          <ReferenceLine
                            key={`financial-modal-${event.date}-${idx}`}
                            x={dataPoint.dateShort}
                            stroke="#06B6D4"
                            strokeWidth={2}
                            strokeDasharray="4 2"
                            label={<FinancialStatementEventLabelModal event={event} onClick={scrollToFinancialPeriod} />}
                          />
                        );
                      });
                  })()}
                  {/* News Event vertical lines - conditional on toggle */}
                  {showNewsLines && newsEvents.length > 0 && (() => {
                    // Group news by date
                    const newsByDate = new Map<string, Array<{ title: string; url: string; color: string; sentiment: string; date: string }>>();
                    
                    newsEvents
                      .filter(news => {
                        const dataPoint = enhancedChartData.find(d => d.date === news.date);
                        return dataPoint !== undefined;
                      })
                      .forEach(news => {
                        if (!newsByDate.has(news.date)) {
                          newsByDate.set(news.date, []);
                        }
                        newsByDate.get(news.date)!.push({
                          title: news.title,
                          url: news.url,
                          color: getNewsSentimentColor(news.overall_sentiment_label),
                          sentiment: news.overall_sentiment_label,
                          date: news.date,
                        });
                      });

                    // Render one ReferenceLine per unique date
                    return Array.from(newsByDate.entries()).map(([date, newsItems], idx) => {
                      const dataPoint = enhancedChartData.find(d => d.date === date);
                      if (!dataPoint) return null;
                      
                      // Use the color of the first news item for the line, or neutral if multiple
                      const lineColor = newsItems.length === 1 ? newsItems[0].color : '#9CA3AF';
                      
                      return (
                        <ReferenceLine
                          key={`news-modal-${date}-${idx}`}
                          x={dataPoint.dateShort}
                          stroke={lineColor}
                          strokeWidth={2}
                          strokeDasharray="3 3"
                        />
                      );
                    });
                  })()}
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="#10B981"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#10B981' }}
                    isAnimationActive={false}
                  />
                  {showSMA20 && (
                    <Line
                      type="monotone"
                      dataKey="sma20"
                      stroke="#8B5CF6"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {showSMA50 && (
                    <Line
                      type="monotone"
                      dataKey="sma50"
                      stroke="#A855F7"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {showSMA200 && (
                    <Line
                      type="monotone"
                      dataKey="sma200"
                      stroke="#C084FC"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            
            {/* Custom Range Slider for Zoom */}
            {isInteractive && (
              <div className="mt-4 px-4 pb-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">
                    {enhancedChartData[sliderRange[0]]?.dateShort || 'Start'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {enhancedChartData[sliderRange[1]]?.dateShort || 'End'}
                  </span>
                </div>
                <Slider
                  range
                  min={0}
                  max={enhancedChartData.length - 1}
                  value={sliderRange}
                  onChange={(value) => {
                    // Immediately update display for smooth interaction
                    const newRange = value as [number, number];
                    setSliderRange(newRange);
                    
                    // Clear existing timeout
                    if (sliderDragTimeoutRef.current) {
                      clearTimeout(sliderDragTimeoutRef.current);
                    }
                    
                    // Debounce the expensive recalculation
                    sliderDragTimeoutRef.current = setTimeout(() => {
                      console.log('Committing slider zoom change:', {
                        startIndex: newRange[0],
                        endIndex: newRange[1],
                        startDate: enhancedChartData[newRange[0]]?.dateShort,
                        endDate: enhancedChartData[newRange[1]]?.dateShort
                      });
                      setCommittedSliderRange(newRange);
                    }, 300);
                  }}
                  styles={{
                    track: {
                      backgroundColor: 'rgba(16, 185, 129, 0.3)',
                      height: 8,
                      borderRadius: 10,
                    },
                    tracks: {
                      backgroundColor: 'rgba(16, 185, 129, 0.5)',
                      height: 8,
                      borderRadius: 10,
                    },
                    handle: {
                      backgroundColor: '#10B981',
                      borderColor: '#10B981',
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      opacity: 1,
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                    },
                    rail: {
                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                      height: 8,
                      borderRadius: 10,
                    },
                  }}
                />
              </div>
            )}
          </div>

          {/* Volume Chart with Analysis */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Volume Chart</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={adjustedChartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }} syncId="comprehensiveSync">
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis
                    dataKey="dateShort"
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF', fontSize: 8 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, precomputedData.volumeRange.max]}
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF', fontSize: 8 }}
                    width={50}
                    tickFormatter={formatVolume}
                    orientation="left"
                  />
                  <Bar 
                    dataKey="volume" 
                    fill={(entry: any) => entry.volumeSpike ? '#EF4444' : '#3B82F6'} 
                    radius={[2, 2, 0, 0]} 
                    isAnimationActive={false} 
                  />
                  {showVolumeAnalysis && statistics && (
                    <ReferenceLine
                      y={statistics.avgVolume}
                      stroke="#F59E0B"
                      strokeDasharray="2 2"
                      label={{ value: 'Avg Volume', position: 'right', fill: '#F59E0B', fontSize: 10 }}
                    />
                  )}
                  <Tooltip content={<CustomTooltip />} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RSI Chart (below if enabled) */}
          {showRSI && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-4">RSI (Relative Strength Index)</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={adjustedChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis
                      dataKey="dateShort"
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 10 }}
                      width={50}
                    />
                    <ReferenceLine y={70} stroke="#EF4444" strokeDasharray="2 2" label={{ value: 'Overbought', position: 'right', fill: '#EF4444', fontSize: 10 }} />
                    <ReferenceLine y={30} stroke="#10B981" strokeDasharray="2 2" label={{ value: 'Oversold', position: 'right', fill: '#10B981', fontSize: 10 }} />
                    <Line
                      type="monotone"
                      dataKey="rsi"
                      stroke="#FBBF24"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* MACD Chart (below if enabled) */}
          {showMACD && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-4">MACD (Moving Average Convergence Divergence)</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={adjustedChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis
                      dataKey="dateShort"
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[macdRange.min, macdRange.max]}
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 10 }}
                      width={70}
                    />
                    <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="2 2" />
                    <Line
                      type="monotone"
                      dataKey="macd"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="signal"
                      stroke="#EF4444"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="histogram"
                      fill="#8B5CF6"
                      radius={[2, 2, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* News & Sentiment Timeline */}
          {newsData && newsData.feed && newsData.feed.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-4">News & Sentiment Timeline</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {newsData.feed
                  .sort((a, b) => b.time_published.localeCompare(a.time_published))
                  .map((article, idx) => {
                    // Extract date from time_published
                    const dateStr = article.time_published.substring(0, 8);
                    const formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
                    const formattedTime = article.time_published.substring(9, 13);
                    const displayTime = `${formattedTime.substring(0, 2)}:${formattedTime.substring(2, 4)}`;
                    
                    // Find ticker-specific sentiment
                    const tickerSentiment = article.ticker_sentiment?.find(ts => ts.ticker === stock?.ticker);
                    
                    return (
                      <div
                        key={idx}
                        className="bg-gray-900 border border-gray-700 rounded-lg p-3 hover:border-gray-600 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <a
                              href={article.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-white font-semibold hover:text-blue-400 transition-colors line-clamp-2"
                            >
                              {article.title}
                            </a>
                            <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                              <span>{article.source}</span>
                              {article.category_within_source && (
                                <>
                                  <span>•</span>
                                  <span>{article.category_within_source}</span>
                                </>
                              )}
                              <span>•</span>
                              <span>{formattedDate} {displayTime}</span>
                            </div>
                          </div>
                          <div className="ml-4 flex flex-col items-end gap-1">
                            <span
                              className={`text-xs px-2 py-1 rounded font-medium ${
                                article.overall_sentiment_label === 'Bullish'
                                  ? 'bg-green-600 text-white'
                                  : article.overall_sentiment_label === 'Bearish'
                                  ? 'bg-red-600 text-white'
                                  : 'bg-gray-600 text-white'
                              }`}
                            >
                              {article.overall_sentiment_label}
                            </span>
                            {tickerSentiment && (
                              <span className="text-xs text-gray-400">
                                Ticker: {tickerSentiment.ticker_sentiment_label} ({parseFloat(tickerSentiment.ticker_sentiment_score).toFixed(2)})
                              </span>
                            )}
                          </div>
                        </div>
                        {article.summary && (
                          <p className="text-sm text-gray-300 mt-2 line-clamp-2">{article.summary}</p>
                        )}
                        {article.topics && article.topics.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {article.topics.map((topic, topicIdx) => (
                              <span
                                key={topicIdx}
                                className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded"
                              >
                                {topic.topic} ({parseFloat(topic.relevance_score).toFixed(2)})
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 text-xs text-gray-500">
                          Score: {article.overall_sentiment_score.toFixed(2)}
                          {tickerSentiment && (
                            <>
                              {' • '}
                              Relevance: {parseFloat(tickerSentiment.relevance_score).toFixed(2)}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Insider Transactions Section */}
          {insiderTransactionsData && insiderTransactionsData.transactions.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowInsiderTransactions(!showInsiderTransactions)}
                    className="flex items-center gap-2 text-xl font-bold text-yellow-400 hover:text-yellow-300 transition-colors"
                  >
                    ⭐ Insider Transactions
                    <span className="text-gray-400 text-sm">
                      ({insiderTransactionsData.transactions.length})
                    </span>
                    <svg className={`w-5 h-5 transform transition-transform ${showInsiderTransactions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                
                {showInsiderTransactions && (
                  <button 
                    onClick={clearAllInsiderFilters} 
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>

              {showInsiderTransactions && (
                <>
                  {/* Filter Panel */}
                  <div className="grid grid-cols-4 gap-4 mb-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
                    {/* Insider Names Filter */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2 font-medium">Insiders</label>
                      <select
                        multiple
                        value={Array.from(selectedInsiders)}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                          setSelectedInsiders(new Set(selected));
                          setInsiderPage(0);
                        }}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-gray-300 max-h-32 overflow-y-auto focus:outline-none focus:border-blue-500"
                      >
                        {uniqueInsiders.map(name => (
                          <option key={name} value={name} className="py-1">{name}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">Cmd/Ctrl+Click to select multiple</p>
                    </div>
                    
                    {/* Transaction Types Filter */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2 font-medium">Transaction Types</label>
                      <select
                        multiple
                        value={Array.from(selectedTransactionTypes)}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                          setSelectedTransactionTypes(new Set(selected));
                          setInsiderPage(0);
                        }}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-gray-300 max-h-32 overflow-y-auto focus:outline-none focus:border-blue-500"
                      >
                        {uniqueTransactionTypes.map(type => (
                          <option key={type} value={type} className="py-1">{type}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">Cmd/Ctrl+Click to select multiple</p>
                    </div>
                    
                    {/* Positions Filter */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2 font-medium">Positions</label>
                      <select
                        multiple
                        value={Array.from(selectedPositions)}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                          setSelectedPositions(new Set(selected));
                          setInsiderPage(0);
                        }}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-gray-300 max-h-32 overflow-y-auto focus:outline-none focus:border-blue-500"
                      >
                        {uniquePositions.map(position => (
                          <option key={position} value={position} className="py-1">{position}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">Cmd/Ctrl+Click to select multiple</p>
                    </div>
                    
                    {/* Security Types Filter */}
                    {availableSecurityTypes.length > 0 && (
                      <div>
                        <label className="block text-sm text-gray-400 mb-2 font-medium">Security Type</label>
                        <select
                          value={selectedSecurityType}
                          onChange={(e) => {
                            setSelectedSecurityType(e.target.value);
                            setInsiderPage(0);
                          }}
                          className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
                        >
                          <option value="all" className="py-1">All Types</option>
                          {availableSecurityTypes.map(({ type, count }) => (
                            <option key={type} value={type} className="py-1">
                              {type} ({count})
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Filter by security type</p>
                      </div>
                    )}
                    
                    {/* Date Range Filter */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2 font-medium">Date Range</label>
                      <input
                        type="date"
                        value={insiderDateRange?.[0] || ''}
                        onChange={(e) => {
                          const newStart = e.target.value;
                          setInsiderDateRange(prev => [newStart, prev?.[1] || newStart]);
                          setInsiderPage(0);
                        }}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-gray-300 mb-2 focus:outline-none focus:border-blue-500"
                        placeholder="Start Date"
                      />
                      <input
                        type="date"
                        value={insiderDateRange?.[1] || ''}
                        onChange={(e) => {
                          const newEnd = e.target.value;
                          setInsiderDateRange(prev => [prev?.[0] || newEnd, newEnd]);
                          setInsiderPage(0);
                        }}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
                        placeholder="End Date"
                      />
                    </div>
                  </div>

                  {/* Summary Statistics */}
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Total Transactions</p>
                      <p className="text-2xl font-bold text-white">
                        {filteredInsiderTransactions.length}
                      </p>
                    </div>
                    
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Unique Insiders</p>
                      <p className="text-2xl font-bold text-white">
                        {insiderSummaryStats.uniqueInsidersCount}
                      </p>
                    </div>
                    
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Net Shares</p>
                      <p className={`text-2xl font-bold ${insiderSummaryStats.netShares >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {insiderSummaryStats.netShares >= 0 ? '+' : ''}{insiderSummaryStats.netShares.toLocaleString()}
                      </p>
                    </div>
                    
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Total Value</p>
                      <p className="text-2xl font-bold text-white">
                        ${insiderSummaryStats.totalValue.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Timeline Bubble Plot */}
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-300 mb-3">
                      Transaction Timeline
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          type="category"
                          dataKey="date"
                          name="Date"
                          tick={{ fill: '#9CA3AF', fontSize: 10 }}
                          angle={-45}
                          textAnchor="end"
                        />
                        <YAxis
                          type="number"
                          dataKey="value"
                          name="Value"
                          tick={{ fill: '#9CA3AF', fontSize: 10 }}
                          tickFormatter={(value) => `$${Math.abs(value / 1000).toFixed(0)}K`}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload[0]) {
                              const t = payload[0].payload;
                              return (
                                <div className="bg-gray-800 border border-gray-700 rounded p-3 shadow-xl">
                                  <p className="font-semibold text-white">{t.owner_name}</p>
                                  <p className="text-sm text-gray-300">{t.position}</p>
                                  <p className="text-sm text-gray-300">{t.transaction_type}</p>
                                  <p className="text-xs text-gray-400">{t.security_type}</p>
                                  <p className="text-sm text-gray-300">{t.shares.toLocaleString()} shares @ ${t.price.toFixed(2)}</p>
                                  <p className="text-sm font-bold text-white">${Math.abs(t.value).toLocaleString()}</p>
                                  <p className="text-xs text-gray-500 mt-1">{new Date(t.date).toLocaleDateString()}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Scatter
                          name="Transactions"
                          data={filteredInsiderTransactions.map(t => ({
                            ...t,
                            value: Math.abs(t.value),
                          }))}
                          fill="#8884d8"
                        >
                          {filteredInsiderTransactions.map((t, index) => {
                            const isBuy = t.transaction_type.toLowerCase().includes('purchase') || 
                                          t.transaction_type.toLowerCase().includes('buy');
                            return (
                              <Cell key={index} fill={isBuy ? '#10B981' : '#EF4444'} />
                            );
                          })}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                    <div className="flex items-center justify-center gap-6 mt-2 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        <span className="text-gray-400">Buy/Purchase</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500"></div>
                        <span className="text-gray-400">Sell</span>
                      </div>
                    </div>
                  </div>

                  {/* Cumulative Ownership Chart */}
                  {cumulativeOwnershipData.insiders.length > 0 && (
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-gray-300">
                          {isOwnershipNearZero ? 'Stock Price with Transaction Events' : 'Cumulative Ownership Over Time'}
                        </h3>
                        <div className="flex items-center gap-3">
                          {availableSecurityTypes.length > 0 && (
                            <select
                              value={selectedSecurityType}
                              onChange={(e) => setSelectedSecurityType(e.target.value)}
                              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              title="Filter by security type"
                            >
                              <option value="all">All Types</option>
                              {availableSecurityTypes.map(({ type, count }) => (
                                <option key={type} value={type}>
                                  {type} ({count})
                                </option>
                              ))}
                            </select>
                          )}
                          {!isOwnershipNearZero && (
                            <button
                              onClick={() => setShowStockPriceOverlay(!showStockPriceOverlay)}
                              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                showStockPriceOverlay
                                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                              }`}
                              title={showStockPriceOverlay ? 'Hide stock price overlay' : 'Show stock price overlay'}
                            >
                              {showStockPriceOverlay ? '📈 Hide Price' : '📈 Show Price'}
                            </button>
                          )}
                          {isOwnershipNearZero && (
                            <span className="text-xs text-gray-400 italic">
                              Showing stock price (ownership near zero)
                            </span>
                          )}
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={300}>
                        {isOwnershipNearZero ? (
                          // Stock Price Chart (when ownership is near zero)
                          <LineChart 
                            data={stockPriceChartData.chartData} 
                            margin={{ top: 20, right: 80, bottom: 60, left: 60 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis 
                              dataKey="date" 
                              tick={{ fill: '#9CA3AF', fontSize: 10 }}
                              angle={-45}
                              textAnchor="end"
                              type="category"
                            />
                            <YAxis 
                              tick={{ fill: '#60A5FA', fontSize: 10 }}
                              tickFormatter={(value) => `$${value.toFixed(2)}`}
                              label={{ value: 'Stock Price', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#60A5FA' } }}
                            />
                            <Tooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0]?.payload;
                                  if (!data) return null;
                                  
                                  // Check if this is a pre-price transaction date
                                  const prePriceTx = stockPriceChartData.prePriceTransactions.find(p => p.date === label);
                                  const transactions = data.transactions || prePriceTx?.transactions || [];
                                  
                                  return (
                                    <div className="bg-gray-800 border border-gray-700 rounded p-3 shadow-xl">
                                      <p className="text-sm font-semibold text-white mb-2">{new Date(label).toLocaleDateString()}</p>
                                      {data.stockPrice !== undefined ? (
                                        <p className="text-sm text-blue-400 mb-2">
                                          Stock Price: ${typeof data.stockPrice === 'number' ? data.stockPrice.toFixed(2) : data.stockPrice}
                                        </p>
                                      ) : (
                                        <p className="text-sm text-gray-400 mb-2 italic">
                                          Pre-IPO / Pre-price data
                                        </p>
                                      )}
                                      {transactions.length > 0 && (
                                        <div className="mt-2 pt-2 border-t border-gray-700">
                                          <p className="text-xs text-gray-400 mb-1">Transactions:</p>
                                          {transactions.map((t: any, idx: number) => {
                                            const isBuy = t.transaction_type.toLowerCase().includes('buy') || 
                                                          t.transaction_type.toLowerCase().includes('purchase');
                                            return (
                                              <div key={idx} className="text-xs mt-1">
                                                <span className={isBuy ? 'text-green-400' : 'text-red-400'}>
                                                  {t.transaction_type}
                                                </span>
                                                {' '}
                                                <span className="text-gray-300">{t.owner_name}</span>
                                                {' '}
                                                <span className="text-gray-400">
                                                  {t.shares.toLocaleString()} shares {t.price > 0 ? `@ $${t.price.toFixed(2)}` : ''}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            {/* Pre-price transaction reference lines */}
                            {stockPriceChartData.prePriceTransactions.map((preTx, idx) => {
                              const color = preTx.transactionType === 'buy' ? '#10B981' : '#EF4444';
                              return (
                                <ReferenceLine
                                  key={`pre-${preTx.date}-${idx}`}
                                  x={preTx.date}
                                  stroke={color}
                                  strokeWidth={3}
                                  label={{
                                    value: preTx.transactions.length > 1 
                                      ? `${preTx.transactions.length} ${preTx.transactionType === 'buy' ? 'Buys' : 'Sells'}`
                                      : preTx.transactionType === 'buy' ? 'Buy' : 'Sell',
                                    position: 'top',
                                    fill: color,
                                    fontSize: 11,
                                    fontWeight: 'bold',
                                    offset: 5
                                  }}
                                />
                              );
                            })}
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Line
                              type="monotone"
                              dataKey="stockPrice"
                              stroke="#60A5FA"
                              strokeWidth={2}
                              connectNulls={false}
                              dot={(props: any) => {
                                const { cx, cy, payload } = props;
                                // Don't show dots for pre-price transactions (they have null stockPrice)
                                if (payload.isPrePrice || !payload.hasTransaction || payload.stockPrice === null) return null;
                                
                                const color = payload.transactionType === 'buy' ? '#10B981' : '#EF4444';
                                const radius = 6;
                                
                                return (
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r={radius}
                                    fill={color}
                                    stroke="#1F2937"
                                    strokeWidth={2}
                                  />
                                );
                              }}
                              name="Stock Price"
                            />
                          </LineChart>
                        ) : (
                          // Normal Ownership Chart
                          <ComposedChart data={cumulativeOwnershipData.chartData} margin={{ top: 20, right: showStockPriceOverlay ? 80 : 20, bottom: 60, left: 60 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis 
                              dataKey="date" 
                              tick={{ fill: '#9CA3AF', fontSize: 10 }}
                              angle={-45}
                              textAnchor="end"
                            />
                            <YAxis 
                              yAxisId="shares"
                              tick={{ fill: '#9CA3AF', fontSize: 10 }}
                              tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
                              label={{ value: 'Shares Owned', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#9CA3AF' } }}
                            />
                            {showStockPriceOverlay && (
                              <YAxis 
                                yAxisId="price"
                                orientation="right"
                                tick={{ fill: '#60A5FA', fontSize: 10 }}
                                tickFormatter={(value) => `$${value.toFixed(2)}`}
                                label={{ value: 'Stock Price', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#60A5FA' } }}
                              />
                            )}
                            <Tooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  return (
                                    <div className="bg-gray-800 border border-gray-700 rounded p-3 shadow-xl">
                                      <p className="text-sm font-semibold text-white mb-2">{new Date(label).toLocaleDateString()}</p>
                                      {payload.map((entry, index) => {
                                        if (entry.dataKey === 'stockPrice') {
                                          return (
                                            <p key={index} className="text-sm" style={{ color: entry.color }}>
                                              Stock Price: ${typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
                                            </p>
                                          );
                                        }
                                        return (
                                          <p key={index} className="text-sm" style={{ color: entry.color }}>
                                            {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value} shares
                                          </p>
                                        );
                                      })}
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            {cumulativeOwnershipData.insiders.slice(0, 10).map((insider, idx) => (
                              <Line
                                key={insider}
                                yAxisId="shares"
                                type="monotone"
                                dataKey={insider}
                                stroke={INSIDER_COLORS[idx % INSIDER_COLORS.length]}
                                strokeWidth={2}
                                dot={hasActiveFilters ? (props: any) => {
                                  // Only pass the props we need, excluding key
                                  const { cx, cy, payload } = props;
                                  return <TransactionDot cx={cx} cy={cy} payload={payload} dataKey={insider} />;
                                } : false}
                              />
                            ))}
                            {showStockPriceOverlay && (
                              <Line
                                yAxisId="price"
                                type="monotone"
                                dataKey="stockPrice"
                                stroke="#60A5FA"
                                strokeWidth={2.5}
                                strokeDasharray="5 5"
                                dot={false}
                                name="Stock Price"
                              />
                            )}
                          </ComposedChart>
                        )}
                      </ResponsiveContainer>
                      {(hasActiveFilters || isOwnershipNearZero) && (
                        <div className="flex items-center justify-center gap-6 mt-2 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-gray-700"></div>
                            <span className="text-gray-400">Buy Transaction</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-gray-700"></div>
                            <span className="text-gray-400">Sell Transaction</span>
                          </div>
                        </div>
                      )}
                      {cumulativeOwnershipData.insiders.length > 10 && (
                        <p className="text-sm text-gray-500 italic mt-2 text-center">
                          Showing top 10 insiders. Use filters to view specific insiders.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Transaction Table */}
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-300 mb-3">
                      Transaction Details
                    </h3>
                    
                    <div className="overflow-x-auto border border-gray-700 rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-900 sticky top-0">
                          <tr>
                            <th 
                              className="p-3 text-left cursor-pointer hover:bg-gray-800 transition-colors"
                              onClick={() => handleInsiderSort('date')}
                            >
                              <div className="flex items-center gap-2">
                                Date
                                <span className="text-gray-500">{getInsiderSortIcon('date')}</span>
                              </div>
                            </th>
                            <th className="p-3 text-left">Insider</th>
                            <th className="p-3 text-left">Position</th>
                            <th className="p-3 text-left">Type</th>
                            <th className="p-3 text-left">Security</th>
                            <th 
                              className="p-3 text-right cursor-pointer hover:bg-gray-800 transition-colors"
                              onClick={() => handleInsiderSort('shares')}
                            >
                              <div className="flex items-center justify-end gap-2">
                                Shares
                                <span className="text-gray-500">{getInsiderSortIcon('shares')}</span>
                              </div>
                            </th>
                            <th className="p-3 text-right">Price</th>
                            <th 
                              className="p-3 text-right cursor-pointer hover:bg-gray-800 transition-colors"
                              onClick={() => handleInsiderSort('value')}
                            >
                              <div className="flex items-center justify-end gap-2">
                                Value
                                <span className="text-gray-500">{getInsiderSortIcon('value')}</span>
                              </div>
                            </th>
                            <th 
                              className="p-3 text-center"
                              title="7-day predictive accuracy for this insider-company pair"
                            >
                              Predictive Score
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedTransactions.map((t, idx) => {
                            const isBuy = t.transaction_type.toLowerCase().includes('purchase') || 
                                          t.transaction_type.toLowerCase().includes('buy');
                            
                            // Get regression stats for this insider-company pair
                            const pairStats = getRegressionForPair(t.owner_name, t.ticker, regressionStats);
                            
                            return (
                              <tr key={idx} className="border-t border-gray-800 hover:bg-gray-800/50 transition-colors">
                                <td className="p-3 text-gray-300">{new Date(t.date).toLocaleDateString()}</td>
                                <td className="p-3 font-medium text-white">{t.owner_name}</td>
                                <td className="p-3 text-gray-400">{t.position}</td>
                                <td className="p-3">
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    isBuy ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                                  }`}>
                                    {t.transaction_type}
                                  </span>
                                </td>
                                <td className="p-3 text-gray-400 text-xs">{t.security_type}</td>
                                <td className="p-3 text-right text-gray-300">{t.shares.toLocaleString()}</td>
                                <td className="p-3 text-right text-gray-300">${t.price.toFixed(2)}</td>
                                <td className="p-3 text-right font-semibold text-white">
                                  ${Math.abs(t.value).toLocaleString()}
                                </td>
                                <td className="p-3 text-center">
                                  {pairStats ? (
                                    <div 
                                      className="inline-flex flex-col items-center gap-1 cursor-help"
                                      title={`Correlation: ${formatCorrelation(pairStats.correlation)} | R²: ${formatRSquared(pairStats.r_squared)} | ${pairStats.transaction_count} transactions`}
                                    >
                                      <span className={`font-bold ${getAccuracyColorClass(pairStats.directional_accuracy)}`}>
                                        {getAccuracyIcon(pairStats.directional_accuracy)} {pairStats.directional_accuracy.toFixed(0)}%
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        r={formatCorrelation(pairStats.correlation)}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-gray-600 text-xs">N/A</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    
                    {/* Pagination */}
                    {totalInsiderPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-gray-400">
                          Showing {insiderPage * INSIDER_PAGE_SIZE + 1}-
                          {Math.min((insiderPage + 1) * INSIDER_PAGE_SIZE, filteredInsiderTransactions.length)} of{' '}
                          {filteredInsiderTransactions.length}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setInsiderPage(p => Math.max(0, p - 1))}
                            disabled={insiderPage === 0}
                            className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-300"
                          >
                            Previous
                          </button>
                          <span className="px-3 py-1 text-gray-400">
                            Page {insiderPage + 1} of {totalInsiderPages}
                          </span>
                          <button
                            onClick={() => setInsiderPage(p => Math.min(totalInsiderPages - 1, p + 1))}
                            disabled={insiderPage >= totalInsiderPages - 1}
                            className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-300"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Financial Statements */}
          {financialStatements && financialPeriods.length > 0 && (
            <div ref={financialStatementsRef} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-4">Financial Statements</h3>
              <div className="space-y-2">
                {financialPeriods.map((period) => {
                  const periodKey = period.reportDate;
                  const isExpanded = expandedFinancialPeriods.has(periodKey);
                  
                  // Build label with earnings if available
                  let label = `${period.quarter} - ${period.reportDate}`;
                  const earningsParts: string[] = [];
                  
                  // Helper to format EPS with negative sign before dollar sign
                  const formatEPS = (value: number): string => {
                    const formatted = value.toFixed(2);
                    return value < 0 ? `-$${formatted.substring(1)}` : `$${formatted}`;
                  };
                  
                  if (period.reportedEPS !== null && period.reportedEPS !== undefined) {
                    earningsParts.push(`Actual: ${formatEPS(period.reportedEPS)}`);
                  }
                  
                  if (period.estimatedEPS !== null && period.estimatedEPS !== undefined) {
                    earningsParts.push(`Estimated: ${formatEPS(period.estimatedEPS)}`);
                  }
                  
                  if (earningsParts.length > 0) {
                    label += ` ~ ${earningsParts.join(' | ')}`;
                  }
                  
                  return (
                    <div key={periodKey} className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleFinancialPeriod(periodKey)}
                        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-800 transition-colors"
                      >
                        <span className="text-sm font-semibold text-white">{label}</span>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'transform rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isExpanded && (
                        <div className="px-4 py-3 border-t border-gray-700 space-y-4">
                          {period.balanceSheet && renderStatementFields(period.balanceSheet, 'Balance Sheet')}
                          {period.cashFlow && renderStatementFields(period.cashFlow, 'Cash Flow')}
                          {period.incomeStatement && renderStatementFields(period.incomeStatement, 'Income Statement')}
                          {!period.balanceSheet && !period.cashFlow && !period.incomeStatement && (
                            <p className="text-sm text-gray-400">No financial data available for this period.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

