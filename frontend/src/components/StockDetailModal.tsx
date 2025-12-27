import { useState, useMemo, useEffect } from 'react';
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
  ComposedChart,
} from 'recharts';
import { StockData, PrecomputedChartData, SPACEvent, StockStatistics, TechnicalIndicators } from '../types';
import { calculateStatistics } from '../utils/statistics';
import { calculateTechnicalIndicators } from '../utils/technicalIndicators';

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

export default function StockDetailModal({ stock, precomputedData, spacEvents, onClose }: StockDetailModalProps) {
  const [showSMA20, setShowSMA20] = useState(false);
  const [showSMA50, setShowSMA50] = useState(false);
  const [showSMA200, setShowSMA200] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [showVolumeAnalysis, setShowVolumeAnalysis] = useState(false);

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

  // Format functions
  const formatPrice = (value: number) => `$${value.toFixed(2)}`;
  const formatPctChange = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  };
  const formatVolume = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return value.toString();
  };

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
        className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-7xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 p-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-2xl font-bold text-white">{stock.ticker}</h2>
            <p className="text-sm text-gray-400">IPO: {new Date(stock.ipoDate).toLocaleDateString()}</p>
          </div>
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
            </div>
          </div>

          {/* Main Price Chart */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Price Chart</h3>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={enhancedChartData} margin={{ top: 50, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="dateShort"
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF', fontSize: 10 }}
                    interval="preserveStartEnd"
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
                    domain={[precomputedData.pctChangeRange.min, precomputedData.pctChangeRange.max]}
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF', fontSize: 10 }}
                    width={70}
                    tickFormatter={formatPctChange}
                    orientation="right"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine
                    y={precomputedData.ipoPrice}
                    stroke="#F59E0B"
                    strokeDasharray="2 2"
                  />
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
          </div>

          {/* Volume Chart with Analysis */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Volume Chart</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={enhancedChartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
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
                  <LineChart data={enhancedChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
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
                  <ComposedChart data={enhancedChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
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
        </div>
      </div>
    </div>
  );
}

