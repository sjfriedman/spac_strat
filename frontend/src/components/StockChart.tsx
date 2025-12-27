import { memo } from 'react';
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
} from 'recharts';
import { PrecomputedChartData, SPACEvent } from '../types';

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
              <filter id={`shadow-${idx}`} x="-50%" y="-50%" width="200%" height="200%">
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
              filter={`url(#shadow-${idx})`}
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
  onLock: () => void;
  onStar: () => void;
  onClick?: () => void;
}

const CustomTooltip = ({ active, payload, label }: any) => {
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
      </div>
    );
  }
  return null;
};

const StockChart = memo(function StockChart({
  precomputedData,
  ipoDate,
  locked,
  starred,
  spacEvents = [],
  onLock,
  onStar,
  onClick,
}: StockChartProps) {
  if (!precomputedData) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 h-full flex items-center justify-center">
        <p className="text-gray-500">No data</p>
      </div>
    );
  }

  const { chartData, priceRange, volumeRange, pctChangeRange, ipoPrice, stats } = precomputedData;

  // Format price for Y-axis
  const formatPrice = (value: number) => {
    return `$${value.toFixed(2)}`;
  };

  // Format percentage change for Y-axis
  const formatPctChange = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  };

  // Format volume for Y-axis (e.g., 1.2M, 500K)
  const formatVolume = (value: number) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toString();
  };

  // Get event dates that are in the chart data
  const eventDates = new Set(
    spacEvents
      .map(event => event.date)
      .filter(date => chartData.some(d => d.date === date))
  );

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

  return (
    <div 
      className="bg-gray-900 border border-gray-800 rounded-lg p-4 h-full flex flex-col cursor-pointer hover:border-gray-700 transition-colors"
      onClick={onClick}
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
        </div>
      </div>

      {/* Price Chart */}
      <div className="flex-1 min-h-0 mb-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 50, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="dateShort"
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF', fontSize: 10 }}
              interval="preserveStartEnd"
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
              domain={[pctChangeRange.min, pctChangeRange.max]}
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF', fontSize: 10 }}
              width={70}
              tickFormatter={formatPctChange}
              orientation="right"
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={ipoPrice}
              stroke="#F59E0B"
              strokeDasharray="2 2"
            />
            {/* SPAC Event vertical lines - grouped by date */}
            {(() => {
              // Group events by date
              const eventsByDate = new Map<string, Array<{ action: string; color: string }>>();
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
                  });
                });

              // Render one ReferenceLine per unique date with grouped labels
              return Array.from(eventsByDate.entries()).map(([date, events], idx) => {
                const dataPoint = chartData.find(d => d.date === date);
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
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Volume Chart */}
      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
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
            <Tooltip content={<CustomTooltip />} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Stats */}
      <div className="flex gap-4 mt-2 text-xs text-gray-400">
        <span>Min: ${stats.min.toFixed(2)}</span>
        <span>Max: ${stats.max.toFixed(2)}</span>
        <span>Current: ${stats.current.toFixed(2)}</span>
      </div>
    </div>
  );
});

export default StockChart;

