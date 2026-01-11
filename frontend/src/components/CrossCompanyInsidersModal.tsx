import { useMemo, useState } from 'react';
import { InsiderTransactionsData, RegressionStatsData } from '../types';
import { getRegressionForInsider, getAccuracyColorClass, getAccuracyIcon, formatCorrelation, formatRSquared } from '../utils/regressionStatsLoader';

interface CrossCompanyInsidersModalProps {
  insiderTransactionsMap: Map<string, InsiderTransactionsData>;
  regressionStats: RegressionStatsData | null;
  onClose: () => void;
  onSelectTicker: (ticker: string) => void;
}

interface CrossCompanyInsider {
  name: string;
  companies: string[];
  totalTransactions: number;
  totalValue: number;
  recentTransaction: {
    date: string;
    ticker: string;
    type: string;
    value: number;
  };
  directionalAccuracy?: number;
  correlation?: number;
  rSquared?: number;
}

export default function CrossCompanyInsidersModal({
  insiderTransactionsMap,
  regressionStats,
  onClose,
  onSelectTicker,
}: CrossCompanyInsidersModalProps) {
  const [sortBy, setSortBy] = useState<'companies' | 'transactions' | 'value' | 'accuracy' | 'correlation'>('companies');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [minCompanies, setMinCompanies] = useState(2);
  const [showOnlyPredictive, setShowOnlyPredictive] = useState(false);

  // Analyze all insider transactions to find people in multiple companies
  const crossCompanyInsiders = useMemo(() => {
    console.log(`[CrossCompanyInsiders] Processing ${insiderTransactionsMap.size} tickers`);
    
    const insiderMap = new Map<string, {
      companies: Set<string>;
      transactions: number;
      totalValue: number;
      recentTransaction: any;
    }>();

    // Process all transactions
    let totalTransactions = 0;
    insiderTransactionsMap.forEach((data, ticker) => {
      if (!data || !data.transactions || data.transactions.length === 0) {
        console.warn(`[CrossCompanyInsiders] No transactions for ticker: ${ticker}`);
        return;
      }
      totalTransactions += data.transactions.length;
      data.transactions.forEach(transaction => {
        const name = transaction.owner_name;
        
        if (!insiderMap.has(name)) {
          insiderMap.set(name, {
            companies: new Set(),
            transactions: 0,
            totalValue: 0,
            recentTransaction: transaction,
          });
        }

        const insider = insiderMap.get(name)!;
        insider.companies.add(ticker);
        insider.transactions++;
        insider.totalValue += Math.abs(transaction.value);

        // Track most recent transaction
        if (transaction.date > insider.recentTransaction.date) {
          insider.recentTransaction = { ...transaction, ticker };
        }
      });
    });

    console.log(`[CrossCompanyInsiders] Processed ${totalTransactions} total transactions, found ${insiderMap.size} unique insiders`);

    // Convert to array and filter for multi-company insiders
    const result: CrossCompanyInsider[] = [];
    insiderMap.forEach((data, name) => {
      if (data.companies.size >= minCompanies) {
        // Get regression stats for this insider
        const insiderStats = getRegressionForInsider(name, regressionStats);
        
        result.push({
          name,
          companies: Array.from(data.companies).sort(),
          totalTransactions: data.transactions,
          totalValue: data.totalValue,
          recentTransaction: {
            date: data.recentTransaction.date,
            ticker: data.recentTransaction.ticker,
            type: data.recentTransaction.transaction_type,
            value: data.recentTransaction.value,
          },
          directionalAccuracy: insiderStats?.directional_accuracy,
          correlation: insiderStats?.correlation,
          rSquared: insiderStats?.r_squared,
        });
      }
    });

    console.log(`[CrossCompanyInsiders] Found ${result.length} insiders in ${minCompanies}+ companies`);
    return result;
  }, [insiderTransactionsMap, minCompanies, regressionStats]);

  // Filter and sort
  const filteredAndSorted = useMemo(() => {
    let filtered = crossCompanyInsiders;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(insider =>
        insider.name.toLowerCase().includes(query) ||
        insider.companies.some(c => c.toLowerCase().includes(query))
      );
    }

    // Apply predictive filter (>60% accuracy)
    if (showOnlyPredictive) {
      filtered = filtered.filter(insider => 
        insider.directionalAccuracy !== undefined && insider.directionalAccuracy > 60
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'companies') {
        comparison = a.companies.length - b.companies.length;
      } else if (sortBy === 'transactions') {
        comparison = a.totalTransactions - b.totalTransactions;
      } else if (sortBy === 'value') {
        comparison = a.totalValue - b.totalValue;
      } else if (sortBy === 'accuracy') {
        const accA = a.directionalAccuracy ?? -1;
        const accB = b.directionalAccuracy ?? -1;
        comparison = accA - accB;
      } else if (sortBy === 'correlation') {
        const corrA = a.correlation ?? -999;
        const corrB = b.correlation ?? -999;
        comparison = corrA - corrB;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [crossCompanyInsiders, searchQuery, sortBy, sortDirection, showOnlyPredictive]);

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: typeof sortBy) => {
    if (sortBy !== field) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">Cross-Company Insiders</h2>
            <p className="text-sm text-gray-400 mt-1">
              {filteredAndSorted.length} insiders found in {minCompanies}+ companies
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-700 space-y-3">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or ticker..."
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Min Companies:</label>
              <select
                value={minCompanies}
                onChange={(e) => setMinCompanies(parseInt(e.target.value))}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={2}>2+</option>
                <option value={3}>3+</option>
                <option value={4}>4+</option>
                <option value={5}>5+</option>
                <option value={10}>10+</option>
              </select>
            </div>
            <button
              onClick={() => setShowOnlyPredictive(!showOnlyPredictive)}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                showOnlyPredictive
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
              title="Show only insiders with >60% accuracy"
            >
              ✓ Predictive Only
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredAndSorted.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400">No cross-company insiders found</p>
              <p className="text-sm text-gray-500 mt-2">
                {searchQuery ? 'Try adjusting your search' : 'Try lowering the minimum companies filter'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAndSorted.map((insider, idx) => (
                <div
                  key={idx}
                  className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-white">{insider.name}</h3>
                        {insider.directionalAccuracy !== undefined && (
                          <div 
                            className={`px-3 py-1 rounded text-sm font-bold ${getAccuracyColorClass(insider.directionalAccuracy)} bg-gray-900`}
                            title={`Correlation: ${formatCorrelation(insider.correlation)} | R²: ${formatRSquared(insider.rSquared)}`}
                          >
                            {getAccuracyIcon(insider.directionalAccuracy)} {insider.directionalAccuracy.toFixed(0)}% Accuracy
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm">
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400">Companies:</span>
                          <span className="text-blue-400 font-semibold">{insider.companies.length}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400">Transactions:</span>
                          <span className="text-green-400 font-semibold">{insider.totalTransactions}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400">Total Value:</span>
                          <span className="text-yellow-400 font-semibold">
                            ${(insider.totalValue / 1000000).toFixed(2)}M
                          </span>
                        </div>
                        {insider.correlation !== undefined && insider.correlation !== null && (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400">Correlation:</span>
                            <span className="text-purple-400 font-semibold">{formatCorrelation(insider.correlation)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Most Recent</p>
                      <p className="text-sm text-gray-300">{new Date(insider.recentTransaction.date).toLocaleDateString()}</p>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        insider.recentTransaction.type.toLowerCase().includes('buy') ||
                        insider.recentTransaction.type.toLowerCase().includes('purchase')
                          ? 'bg-green-600 text-white'
                          : 'bg-red-600 text-white'
                      }`}>
                        {insider.recentTransaction.type}
                      </span>
                      <p className="text-xs text-gray-400 mt-1">{insider.recentTransaction.ticker}</p>
                    </div>
                  </div>

                  {/* Companies List */}
                  <div className="flex flex-wrap gap-2">
                    {insider.companies.map((ticker) => (
                      <button
                        key={ticker}
                        onClick={() => {
                          onSelectTicker(ticker);
                          onClose();
                        }}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
                      >
                        {ticker}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with sorting */}
        <div className="p-4 border-t border-gray-700">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-400">Sort by:</span>
            <button
              onClick={() => handleSort('companies')}
              className={`px-3 py-1 rounded transition-colors ${
                sortBy === 'companies'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              # Companies {getSortIcon('companies')}
            </button>
            <button
              onClick={() => handleSort('transactions')}
              className={`px-3 py-1 rounded transition-colors ${
                sortBy === 'transactions'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              # Transactions {getSortIcon('transactions')}
            </button>
            <button
              onClick={() => handleSort('value')}
              className={`px-3 py-1 rounded transition-colors ${
                sortBy === 'value'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Total Value {getSortIcon('value')}
            </button>
            <button
              onClick={() => handleSort('accuracy')}
              className={`px-3 py-1 rounded transition-colors ${
                sortBy === 'accuracy'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
              title="Sort by predictive accuracy (7-day)"
            >
              Best Predictors {getSortIcon('accuracy')}
            </button>
            <button
              onClick={() => handleSort('correlation')}
              className={`px-3 py-1 rounded transition-colors ${
                sortBy === 'correlation'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
              title="Sort by correlation coefficient"
            >
              Highest Correlation {getSortIcon('correlation')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

