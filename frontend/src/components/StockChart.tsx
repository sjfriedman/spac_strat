import React, { memo, useState, useRef, useEffect, useMemo } from 'react';
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
  Brush,
} from 'recharts';
import { PrecomputedChartData, SPACEvent, NewsEvent, FinancialStatementEvent, MatchingWindow, InsiderTransactionEvent } from '../types';

// Popup component for showing all SPAC events
const SPACEventPopup = ({ 
  events, 
  position, 
  onClose 
}: { 
  events: Array<{ action: string; color: string; date: string }>;
  position: { x: number; y: number };
  onClose: () => void;
}) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Adjust position to stay within viewport
    if (popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      
      let adjustedX = position.x;
      let adjustedY = position.y;
      
      // Adjust horizontal position
      if (position.x - rect.width / 2 < 10) {
        adjustedX = rect.width / 2 + 10;
      } else if (position.x + rect.width / 2 > viewportWidth - 10) {
        adjustedX = viewportWidth - rect.width / 2 - 10;
      }
      
      // Adjust vertical position (popup appears above, so check top)
      if (position.y - rect.height < 10) {
        adjustedY = position.y + rect.height + 20; // Show below instead
      }
      
      if (adjustedX !== position.x || adjustedY !== position.y) {
        setAdjustedPosition({ x: adjustedX, y: adjustedY });
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, position]);

  return (
    <div
      ref={popupRef}
      className="fixed z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl max-w-sm max-h-96 overflow-hidden flex flex-col"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
        transform: adjustedPosition.y > position.y 
          ? 'translate(-50%, 0)' // Show below
          : 'translate(-50%, -100%)', // Show above
        marginTop: adjustedPosition.y > position.y ? '10px' : '-10px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">
          Events ({events.length})
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
          title="Close"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="overflow-y-auto p-2">
        {events.map((event, idx) => {
          const eventDate = event.date ? new Date(event.date) : null;
          const formattedDate = eventDate ? eventDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
          }) : '';
          
          return (
            <div
              key={idx}
              className="mb-2 p-2 rounded border border-gray-700 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-1 h-full rounded flex-shrink-0"
                  style={{ backgroundColor: event.color, minHeight: '20px' }}
                />
                <div className="flex-1 min-w-0">
                  {formattedDate && (
                    <p className="text-xs text-gray-500 mb-1">{formattedDate}</p>
                  )}
                  <p className="text-xs text-gray-300 flex-1">
                    {event.action}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Custom label component for SPAC events (handles multiple events on same day)
const SPACEventLabels = ({ viewBox, events, onExpandClick, dateKey, hasOverlap }: any) => {
  if (!viewBox || !events || events.length === 0) return null;
  const { x, y } = viewBox;
  const labelHeight = 18;
  const labelSpacing = 2;
  const maxVisible = 2; // Show max 2 items, then show expand button
  
  // If there are more than maxVisible items OR if there's an overlap detected, show compact indicator
  if (events.length > maxVisible || hasOverlap) {
    const count = events.length;
    const text = `${count} ${count === 1 ? 'event' : 'events'}`;
    const textWidth = Math.max(80, text.length * 6);
    const rectWidth = textWidth + 20;
    const indicatorY = y - labelHeight - 5;
    
    return (
      <g>
        <defs>
          <filter id={`spac-expand-shadow-${dateKey}`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.3)"/>
          </filter>
        </defs>
        <rect
          x={x - rectWidth / 2}
          y={indicatorY}
          width={rectWidth}
          height={labelHeight}
          fill="rgba(17, 24, 39, 0.95)"
          stroke="#9CA3AF"
          strokeWidth={2}
          rx={4}
          filter={`url(#spac-expand-shadow-${dateKey})`}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            if (onExpandClick) {
              onExpandClick(x, y, events);
            }
          }}
        />
        <text
          x={x}
          y={indicatorY + labelHeight / 2 + 4}
          fill="#9CA3AF"
          fontSize={9}
          fontWeight="600"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ letterSpacing: '0.3px', cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            if (onExpandClick) {
              onExpandClick(x, y, events);
            }
          }}
        >
          {text}
        </text>
      </g>
    );
  }
  
  // Show all items if there are few enough
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
              <filter id={`shadow-${dateKey}-${idx}`} x="-50%" y="-50%" width="200%" height="200%">
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
              filter={`url(#shadow-${dateKey}-${idx})`}
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

interface StockChartProps {
  precomputedData: PrecomputedChartData | null;
  ipoDate: string;
  position?: number;
  locked: boolean;
  starred: boolean;
  spacEvents?: SPACEvent[];
  newsEvents?: NewsEvent[];
  financialStatementEvents?: FinancialStatementEvent[];
  insiderTransactionEvents?: InsiderTransactionEvent[];
  matchingWindows?: MatchingWindow[] | null;
  filterDirection?: 'up' | 'down' | null;
  onLock: () => void;
  onStar: () => void;
  onClick?: () => void;
}

const CustomTooltip = ({ active, payload, label, newsForDate }: any) => {
  if (active && payload && payload.length) {
    // Get the full data point from the payload
    const dataPoint = payload[0]?.payload;
    
    // Format date with year
    let formattedDate = label;
    if (dataPoint?.date) {
      const date = new Date(dataPoint.date);
      formattedDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });
    }
    
    // Always show both price and volume from the data point
    const price = dataPoint?.close;
    const volume = dataPoint?.volume;
    const pctChange = dataPoint?.pctChange;
    
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-xl max-w-xs">
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
        {newsForDate && newsForDate.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-700">
            <p className="text-xs font-semibold text-gray-400 mb-1">
              News ({newsForDate.length})
            </p>
            {newsForDate.map((news: NewsEvent, idx: number) => (
              <div key={idx} className="mb-1">
                <a
                  href={news.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 underline block truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  {news.title}
                </a>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    news.overall_sentiment_label === 'Bullish' ? 'bg-green-600 text-white' :
                    news.overall_sentiment_label === 'Bearish' ? 'bg-red-600 text-white' :
                    'bg-gray-600 text-white'
                  }`}>
                    {news.overall_sentiment_label}
                  </span>
                  {news.ticker_sentiment && (
                    <span className="text-xs text-gray-400">
                      Ticker: {news.ticker_sentiment.ticker_sentiment_label} ({parseFloat(news.ticker_sentiment.ticker_sentiment_score).toFixed(2)})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return null;
};

// Custom dot component for insider transaction stars
// Custom label component for Financial Statement events
const FinancialStatementEventLabel = ({ viewBox, event }: any) => {
  if (!viewBox || !event) return null;
  const { x, y } = viewBox;
  const labelHeight = 18;
  // Use only quarter/year for chart bubbles (e.g., "Q1 2025")
  const displayText = event.quarter || event.label;
  const textWidth = Math.max(80, displayText.length * 5.5);
  const rectWidth = textWidth + 10;
  const labelY = y - labelHeight - 5;
  
  return (
    <g>
      <defs>
        <filter id={`financial-shadow-${event.date}`} x="-50%" y="-50%" width="200%" height="200%">
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
        filter={`url(#financial-shadow-${event.date})`}
      />
      <text
        x={x}
        y={labelY + labelHeight / 2 + 4}
        fill="#06B6D4"
        fontSize={9}
        fontWeight="600"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ letterSpacing: '0.3px' }}
      >
        {displayText}
      </text>
    </g>
  );
};

const StockChart = memo(function StockChart({
  precomputedData,
  ipoDate,
  locked,
  starred,
  spacEvents = [],
  newsEvents = [],
  financialStatementEvents = [],
  insiderTransactionEvents = [],
  matchingWindows = null,
  filterDirection = null,
  onLock,
  onStar,
  onClick,
}: StockChartProps) {
  const [spacPopupState, setSpacPopupState] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    events: Array<{ action: string; color: string; date: string }>;
  } | null>(null);
  const [isInteractive, setIsInteractive] = useState(false);
  // Separate "display" zoom (updates immediately) from "committed" zoom (updates after drag ends)
  const [displayZoomStartIndex, setDisplayZoomStartIndex] = useState<number>(0);
  const [displayZoomEndIndex, setDisplayZoomEndIndex] = useState<number | null>(null);
  const [committedZoomStartIndex, setCommittedZoomStartIndex] = useState<number>(0);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const brushDragTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset zoom when interactive mode is turned off
  useEffect(() => {
    if (!isInteractive) {
      setDisplayZoomStartIndex(0);
      setDisplayZoomEndIndex(null);
      setCommittedZoomStartIndex(0);
      if (brushDragTimeoutRef.current) {
        clearTimeout(brushDragTimeoutRef.current);
        brushDragTimeoutRef.current = null;
      }
    }
  }, [isInteractive]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (brushDragTimeoutRef.current) {
        clearTimeout(brushDragTimeoutRef.current);
      }
    };
  }, []);

  if (!precomputedData) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 h-full flex items-center justify-center">
        <p className="text-gray-500">No data</p>
      </div>
    );
  }

  const { chartData, priceRange, volumeRange, pctChangeRange, ipoPrice, stats } = precomputedData;

  // Adjust chart data to recalculate pctChange based on zoom window
  // Use committedZoomStartIndex to avoid recalculating during drag
  const adjustedChartData = useMemo(() => {
    if (!isInteractive) {
      return chartData;
    }
    
    const basePrice = chartData[committedZoomStartIndex]?.close;
    console.log('Recalculating pctChange:', { 
      committedZoomStartIndex, 
      basePrice,
      isInteractive,
      firstDate: chartData[committedZoomStartIndex]?.dateShort 
    });
    if (!basePrice) return chartData;
    
    return chartData.map(point => ({
      ...point,
      pctChange: ((point.close - basePrice) / basePrice) * 100
    }));
  }, [chartData, isInteractive, committedZoomStartIndex]);

  // Recalculate pctChange range for the adjusted data
  const adjustedPctChangeRange = useMemo(() => {
    if (!isInteractive) {
      return pctChangeRange;
    }
    
    const pctChanges = adjustedChartData.map(d => d.pctChange);
    return {
      min: Math.min(...pctChanges),
      max: Math.max(...pctChanges)
    };
  }, [adjustedChartData, isInteractive, pctChangeRange]);

  // Memoized formatter functions for better performance during zoom
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

  const calculateSPACLabelWidth = useMemo(() => (text: string, charWidth: number = 5.5): number => {
    return Math.max(70, text.length * charWidth) + 10;
  }, []);

  // Detect overlaps between SPAC event labels from nearby dates
  const detectSPACOverlaps = useMemo(() => {
    const overlapMap = new Map<string, boolean>();
    if (!chartData || chartData.length === 0) return overlapMap;

    const eventsWithIndices: Array<{ date: string; index: number; maxWidth: number; items: any[] }> = [];
    
    spacEvents.forEach(event => {
      const dataIndex = chartData.findIndex(d => d.date === event.date);
      if (dataIndex === -1) return;
      
      const existing = eventsWithIndices.find(e => e.date === event.date);
      if (existing) {
        existing.items.push(event);
        const itemWidth = calculateSPACLabelWidth(event.action);
        existing.maxWidth = Math.max(existing.maxWidth, itemWidth);
      } else {
        eventsWithIndices.push({
          date: event.date,
          index: dataIndex,
          maxWidth: calculateSPACLabelWidth(event.action),
          items: [event]
        });
      }
    });

    eventsWithIndices.sort((a, b) => a.index - b.index);

    const overlapThreshold = 10;

    for (let i = 0; i < eventsWithIndices.length; i++) {
      const current = eventsWithIndices[i];
      const currentHalfWidth = current.maxWidth / 2;

      for (let j = i + 1; j < eventsWithIndices.length; j++) {
        const nearby = eventsWithIndices[j];
        const distance = nearby.index - current.index;
        
        if (distance > overlapThreshold) break;

        const nearbyHalfWidth = nearby.maxWidth / 2;
        const estimatedSpacing = 60;
        const xDistance = distance * estimatedSpacing;
        
        if (currentHalfWidth + nearbyHalfWidth > xDistance) {
          overlapMap.set(current.date, true);
          overlapMap.set(nearby.date, true);
        }
      }
    }

    return overlapMap;
  }, [chartData, spacEvents]);

  // Memoized format functions for Y-axis (performance optimization)
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

  // Color mapping for different event types
  const getEventColor = (action: string): string => {
    const lowerAction = action.toLowerCase();
    if (lowerAction.includes('merger vote')) return '#EF4444'; // red
    if (lowerAction.includes('extension vote')) return '#F59E0B'; // amber
    if (lowerAction.includes('de-spac') || lowerAction.includes('listed')) return '#10B981'; // green
    if (lowerAction.includes('split')) return '#3B82F6'; // blue
    if (lowerAction.includes('ipo')) return '#8B5CF6'; // purple
    return '#6B7280'; // gray default
  };

  // Get sentiment color for news
  const getNewsSentimentColor = (sentimentLabel: string): string => {
    if (sentimentLabel === 'Bullish') return '#10B981'; // green
    if (sentimentLabel === 'Bearish') return '#EF4444'; // red
    return '#6B7280'; // gray for neutral
  };

  // Get news for a specific date (for tooltip)
  const getNewsForDate = (date: string): NewsEvent[] => {
    return newsEvents.filter(news => news.date === date);
  };

  // Handle SPAC event expand click
  const handleSpacExpandClick = (svgX: number, svgY: number, events: Array<{ action: string; color: string; date: string }>) => {
    if (!chartContainerRef.current) return;
    
    // Find the SVG element within the chart
    const svgElement = chartContainerRef.current.querySelector('svg');
    if (!svgElement) return;
    
    // Get the SVG's bounding box
    const svgRect = svgElement.getBoundingClientRect();
    
    // Get the SVG's viewBox to understand the coordinate system
    const viewBox = svgElement.viewBox.baseVal;
    const svgWidth = viewBox.width || svgRect.width;
    const svgHeight = viewBox.height || svgRect.height;
    
    // Convert SVG coordinates to screen coordinates
    const scaleX = svgRect.width / svgWidth;
    const scaleY = svgRect.height / svgHeight;
    
    const screenX = svgRect.left + (svgX * scaleX);
    const screenY = svgRect.top + (svgY * scaleY);
    
    setSpacPopupState({
      isOpen: true,
      position: { x: screenX, y: screenY },
      events: events,
    });
  };

  const handleCloseSpacPopup = () => {
    setSpacPopupState(null);
  };

  // Add rounded corners to brush elements
  useEffect(() => {
    if (isInteractive && chartContainerRef.current) {
      // Round the brush slide area
      const brushSlideRects = chartContainerRef.current.querySelectorAll('.recharts-brush-slide rect');
      brushSlideRects.forEach((rect) => {
        rect.setAttribute('rx', '10');
        rect.setAttribute('ry', '10');
      });
      
      // Round the brush background
      const brushBgRects = chartContainerRef.current.querySelectorAll('.recharts-brush rect');
      brushBgRects.forEach((rect) => {
        rect.setAttribute('rx', '10');
        rect.setAttribute('ry', '10');
      });
    }
  }, [isInteractive, chartData]);

  return (
    <div 
      ref={chartContainerRef}
      className="bg-gray-900 border border-gray-800 rounded-lg p-4 h-full flex flex-col relative"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-bold text-white">{precomputedData.ticker}</h3>
          <span className="text-xs text-gray-400">IPO: {new Date(ipoDate).toLocaleDateString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onStar}
            className={`p-1.5 rounded transition-colors ${
              starred
                ? 'text-yellow-400 hover:text-yellow-300'
                : 'text-gray-500 hover:text-gray-400'
            }`}
            title={starred ? 'Unstar' : 'Star'}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </button>
          <button
            onClick={onLock}
            className={`p-1.5 rounded transition-colors ${
              locked
                ? 'text-blue-400 hover:text-blue-300'
                : 'text-gray-500 hover:text-gray-400'
            }`}
            title={locked ? 'Unlock' : 'Lock'}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              {locked ? (
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              ) : (
                <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
              )}
            </svg>
          </button>
          {/* Insider Transactions Indicator */}
          {insiderTransactionEvents && insiderTransactionEvents.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClick?.(); // Open the modal to show insider transactions
              }}
              className="p-1.5 rounded transition-colors text-yellow-400 hover:text-yellow-300"
              title={`${insiderTransactionEvents.length} insider transaction event(s) - click to view details`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!isInteractive) {
                // Entering zoom mode - initialize brush indices
                setDisplayZoomStartIndex(0);
                setDisplayZoomEndIndex(chartData.length - 1);
                setCommittedZoomStartIndex(0);
              }
              setIsInteractive(!isInteractive);
            }}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              isInteractive
                ? 'bg-purple-600 text-white hover:bg-purple-700'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            title={isInteractive ? 'Exit zoom mode' : 'Enable zoom & pan'}
          >
            {isInteractive ? '✕ Zoom' : '🔍 Zoom'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            title="Open detailed view"
          >
            📊 Details
          </button>
        </div>
      </div>

      {/* Price Chart */}
      <div className="flex-1 min-h-0 mb-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={adjustedChartData} margin={{ top: 50, right: 10, left: 0, bottom: 5 }} syncId={`stock-${precomputedData.ticker}`}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="dateShort"
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF', fontSize: 10 }}
              interval="preserveStartEnd"
              tickFormatter={formatXAxisTick}
            />
            <YAxis
              domain={[Math.max(0, priceRange.min), priceRange.max]}
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
            <Tooltip 
              content={(props: any) => {
                const date = props.payload?.[0]?.payload?.date;
                const newsForDate = date ? getNewsForDate(date) : [];
                return <CustomTooltip {...props} newsForDate={newsForDate} />;
              }} 
            />
            <ReferenceLine
              y={ipoPrice}
              stroke="#F59E0B"
              strokeDasharray="2 2"
            />
            {/* Matching windows highlighting (only when business days filter is active) */}
            {matchingWindows && matchingWindows.length > 0 && filterDirection && (
              <>
                {matchingWindows.map((window, idx) => {
                  // Find matching dateShort in chartData
                  const startPoint = chartData.find(d => d.date === window.startDate);
                  const endPoint = chartData.find(d => d.date === window.endDate);
                  
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
            {/* SPAC Event vertical lines - grouped by date */}
            {(() => {
              // Group events by date
              const eventsByDate = new Map<string, Array<{ action: string; color: string; date: string }>>();
              spacEvents
                .filter(event => {
                  const dataPoint = chartData.find(d => d.date === event.date);
                  return dataPoint !== undefined;
                })
                .forEach(event => {
                  if (!eventsByDate.has(event.date)) {
                    eventsByDate.set(event.date, []);
                  }
                  eventsByDate.get(event.date)!.push({
                    action: event.action,
                    color: getEventColor(event.action),
                    date: event.date,
                  });
                });

              // Render one ReferenceLine per unique date with grouped labels
              return Array.from(eventsByDate.entries()).map(([date, events], idx) => {
                const dataPoint = chartData.find(d => d.date === date);
                if (!dataPoint) return null;
                
                // Use the color of the first event for the line, or a neutral color if multiple
                const lineColor = events.length === 1 ? events[0].color : '#9CA3AF';
                
                // Check if this date has overlaps with nearby dates
                const hasOverlap = detectSPACOverlaps.has(date);
                
                return (
                  <ReferenceLine
                    key={`${date}-${idx}`}
                    x={dataPoint.dateShort}
                    stroke={lineColor}
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    label={
                      <SPACEventLabels 
                        events={events}
                        date={date}
                        onExpandClick={handleSpacExpandClick}
                        dateKey={`${date}-${idx}`}
                        hasOverlap={hasOverlap}
                      />
                    }
                  />
                );
              });
            })()}
            {/* News Event vertical lines - grouped by date */}
            {(() => {
              // Group news by date
              const newsByDate = new Map<string, Array<{ title: string; url: string; color: string; sentiment: string; date: string }>>();
              
              newsEvents
                .filter(news => {
                  if (!news.date) return false;
                  const dataPoint = chartData.find(d => d.date === news.date);
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

              // Render one ReferenceLine per unique date (no labels, just the vertical line)
              return Array.from(newsByDate.entries()).map(([date, newsItems], idx) => {
                const dataPoint = chartData.find(d => d.date === date);
                if (!dataPoint) return null;
                
                // Use the color of the first news item for the line, or neutral if multiple
                const lineColor = newsItems.length === 1 ? newsItems[0].color : '#9CA3AF';
                
                return (
                  <ReferenceLine
                    key={`news-${date}-${idx}`}
                    x={dataPoint.dateShort}
                    stroke={lineColor}
                    strokeWidth={2}
                    strokeDasharray="3 3"
                  />
                );
              });
            })()}
            {/* Financial Statement Event vertical lines */}
            {(() => {
              return financialStatementEvents
                .filter(event => {
                  const dataPoint = chartData.find(d => d.date === event.date);
                  return dataPoint !== undefined;
                })
                .map((event, idx) => {
                  const dataPoint = chartData.find(d => d.date === event.date);
                  if (!dataPoint) return null;
                  
                  return (
                    <ReferenceLine
                      key={`financial-${event.date}-${idx}`}
                      x={dataPoint.dateShort}
                      stroke="#06B6D4"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      label={<FinancialStatementEventLabel event={event} />}
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
            {/* Interactive zoom brush */}
            {isInteractive && (
              <Brush
                dataKey="dateShort"
                data={chartData}
                height={30}
                stroke="#10B981"
                fill="rgba(16, 185, 129, 0.1)"
                tickFormatter={formatXAxisTick}
                travellerWidth={10}
                startIndex={displayZoomStartIndex}
                endIndex={displayZoomEndIndex ?? undefined}
                onChange={(brushArea: any) => {
                  if (brushArea && brushArea.startIndex !== undefined) {
                    // Immediately update display indices for smooth visual feedback
                    setDisplayZoomStartIndex(brushArea.startIndex);
                    setDisplayZoomEndIndex(brushArea.endIndex);
                    
                    // Clear any pending timeout
                    if (brushDragTimeoutRef.current) {
                      clearTimeout(brushDragTimeoutRef.current);
                    }
                    
                    // Debounce the expensive recalculation
                    // Only commit the new start index after 300ms of no changes
                    brushDragTimeoutRef.current = setTimeout(() => {
                      console.log('Committing zoom change:', { 
                        startIndex: brushArea.startIndex, 
                        endIndex: brushArea.endIndex,
                        basePrice: chartData[brushArea.startIndex]?.close,
                        date: chartData[brushArea.startIndex]?.dateShort
                      });
                      setCommittedZoomStartIndex(brushArea.startIndex);
                    }, 300);
                  }
                }}
                traveller={(props: any) => {
                  const { x, y, width, height } = props;
                  return (
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill="#10B981"
                      stroke="none"
                      rx={10}
                      ry={10}
                    />
                  );
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Volume Chart */}
      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={adjustedChartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }} syncId={`stock-${precomputedData.ticker}`}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="dateShort"
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF', fontSize: 8 }}
              interval="preserveStartEnd"
              hide
            />
            <YAxis
              domain={[0, volumeRange.max]}
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF', fontSize: 8 }}
              width={50}
              tickFormatter={formatVolume}
              orientation="left"
            />
            <Bar dataKey="volume" fill="#3B82F6" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Tooltip 
              content={(props: any) => {
                const date = props.payload?.[0]?.payload?.date;
                const newsForDate = date ? getNewsForDate(date) : [];
                return <CustomTooltip {...props} newsForDate={newsForDate} />;
              }} 
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Stats */}
      <div className="flex gap-4 mt-2 text-xs text-gray-400">
        <span>Min: ${stats.min.toFixed(2)}</span>
        <span>Max: ${stats.max.toFixed(2)}</span>
        <span>Current: ${stats.current.toFixed(2)}</span>
      </div>

      {/* SPAC Event Popup */}
      {spacPopupState && spacPopupState.isOpen && (
        <SPACEventPopup
          events={spacPopupState.events}
          position={spacPopupState.position}
          onClose={handleCloseSpacPopup}
        />
      )}
    </div>
  );
});

export default StockChart;

