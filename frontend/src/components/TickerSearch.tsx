import { useState, useRef, useEffect } from 'react';
import { StockData } from '../types';

interface TickerSearchProps {
  stocks: StockData[];
  onSelectTicker: (ticker: string) => void;
}

export default function TickerSearch({ stocks, onSelectTicker }: TickerSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTickers, setFilteredTickers] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter tickers based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTickers([]);
      setSelectedIndex(-1);
      return;
    }

    const query = searchQuery.toUpperCase().trim();
    const filtered = stocks
      .map(stock => stock.ticker)
      .filter(ticker => ticker.toUpperCase().includes(query))
      .slice(0, 10); // Limit to 10 results

    setFilteredTickers(filtered);
    setSelectedIndex(-1);
  }, [searchQuery, stocks]);

  // Focus input when search opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setFilteredTickers([]);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => 
        prev < filteredTickers.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < filteredTickers.length) {
        handleSelectTicker(filteredTickers[selectedIndex]);
      } else if (filteredTickers.length === 1) {
        handleSelectTicker(filteredTickers[0]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setSearchQuery('');
    }
  };

  const handleSelectTicker = (ticker: string) => {
    onSelectTicker(ticker);
    setIsOpen(false);
    setSearchQuery('');
    setFilteredTickers([]);
    setSelectedIndex(-1);
  };

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setSearchQuery('');
      setFilteredTickers([]);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleToggle}
        className={`px-4 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2 ${
          isOpen
            ? 'bg-purple-600 text-white hover:bg-purple-700'
            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
        }`}
        title="Search for a ticker"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        Search
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-50">
          <div className="p-3">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type ticker symbol..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          
          {filteredTickers.length > 0 && (
            <div
              ref={dropdownRef}
              className="max-h-60 overflow-y-auto border-t border-gray-800"
            >
              {filteredTickers.map((ticker, idx) => (
                <button
                  key={ticker}
                  onClick={() => handleSelectTicker(ticker)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    idx === selectedIndex
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  {ticker}
                </button>
              ))}
            </div>
          )}

          {searchQuery.trim() && filteredTickers.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500 border-t border-gray-800">
              No tickers found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

