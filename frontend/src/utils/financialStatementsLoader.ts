// Utility to load and cache financial statements data

import { FinancialStatement, FinancialStatementEvent } from '../types';
import { DataType } from './dataLoader';

const FINANCIAL_STATEMENTS_CACHE_KEY = 'spac_strat_financial_statements_cache';
const FINANCIAL_STATEMENTS_CACHE_VERSION = '1.0.0';

// Map of ticker -> financial statements data for that ticker
let financialStatementsCache: Map<string, FinancialStatement> | null = null;
let cacheDataType: DataType | null = null;

/**
 * Calculate quarter from month (1-12)
 */
function getQuarter(month: number): number {
  if (month >= 1 && month <= 3) return 1;
  if (month >= 4 && month <= 6) return 2;
  if (month >= 7 && month <= 9) return 3;
  if (month >= 10 && month <= 12) return 4;
  return 1; // Default to Q1
}

/**
 * Convert fiscal date ending (YYYY-MM-DD) to quarter/year string
 */
function fiscalDateToQuarterYear(fiscalDateEnding: string): string {
  if (!fiscalDateEnding || fiscalDateEnding.length < 10) {
    return '';
  }
  
  try {
    const date = new Date(fiscalDateEnding);
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // getMonth() returns 0-11
    const quarter = getQuarter(month);
    
    return `Q${quarter} ${year}`;
  } catch (err) {
    console.warn(`Error parsing fiscal date: ${fiscalDateEnding}`, err);
    return '';
  }
}

/**
 * Extract report date from financial statement report
 * Alpha Vantage may have different field names, so we try multiple
 */
function extractReportDate(report: any): string {
  // Try different possible field names
  if (report.reportDate) {
    return report.reportDate;
  }
  if (report.fiscalDateEnding) {
    return report.fiscalDateEnding;
  }
  if (report.date) {
    return report.date;
  }
  return '';
}

/**
 * Extract events from financial statements
 * Groups by report date (all three statements released together)
 */
function extractEvents(financialStatements: FinancialStatement): FinancialStatementEvent[] {
  const events: FinancialStatementEvent[] = [];
  const reportDates = new Set<string>();
  
  // Collect all unique report dates from all three statement types
  const statementTypes = [
    { key: 'balanceSheet', name: 'Balance Sheet' },
    { key: 'cashFlow', name: 'Cash Flow' },
    { key: 'incomeStatement', name: 'Income Statement' }
  ];
  
  for (const stmtType of statementTypes) {
    const statement = financialStatements[stmtType.key as keyof FinancialStatement];
    if (!statement) continue;
    
    // Check quarterly reports
    if (statement.quarterlyReports && Array.isArray(statement.quarterlyReports)) {
      for (const report of statement.quarterlyReports) {
        const reportDate = extractReportDate(report);
        if (reportDate) {
          reportDates.add(reportDate);
        }
      }
    }
    
    // Check annual reports
    if (statement.annualReports && Array.isArray(statement.annualReports)) {
      for (const report of statement.annualReports) {
        const reportDate = extractReportDate(report);
        if (reportDate) {
          reportDates.add(reportDate);
        }
      }
    }
  }
  
  // Create events for each unique report date
  for (const reportDate of reportDates) {
    // Find a report with this date to get fiscal date ending
    let fiscalDateEnding = '';
    let foundReport: any = null;
    
    for (const stmtType of statementTypes) {
      const statement = financialStatements[stmtType.key as keyof FinancialStatement];
      if (!statement) continue;
      
      // Check quarterly reports
      if (statement.quarterlyReports && Array.isArray(statement.quarterlyReports)) {
        foundReport = statement.quarterlyReports.find((r: any) => extractReportDate(r) === reportDate);
        if (foundReport && foundReport.fiscalDateEnding) {
          fiscalDateEnding = foundReport.fiscalDateEnding;
          break;
        }
      }
      
      // Check annual reports
      if (statement.annualReports && Array.isArray(statement.annualReports)) {
        foundReport = statement.annualReports.find((r: any) => extractReportDate(r) === reportDate);
        if (foundReport && foundReport.fiscalDateEnding) {
          fiscalDateEnding = foundReport.fiscalDateEnding;
          break;
        }
      }
    }
    
    // If no fiscal date ending found, use report date
    if (!fiscalDateEnding) {
      fiscalDateEnding = reportDate;
    }
    
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
  
  // Sort by date (most recent first)
  events.sort((a, b) => b.date.localeCompare(a.date));
  
  return events;
}

/**
 * Load financial statements data for a single ticker
 */
async function loadFinancialStatementsForTicker(ticker: string, dataType: DataType): Promise<FinancialStatement | null> {
  // Try raw data directory first (where the script saves)
  const rawUrl = `/data/raw_stock_data/${dataType}/financial_statements/${ticker}.json`;
  
  try {
    const response = await fetch(rawUrl, { cache: 'no-store' });
    if (!response.ok) {
      // File doesn't exist - ticker has no financial statements or hasn't been fetched yet
      return null;
    }
    
    const data = await response.json();
    
    // Ensure ticker is set
    return {
      ...data,
      ticker,
    };
  } catch (err) {
    console.warn(`Error loading financial statements for ${ticker}:`, err);
    return null;
  }
}

/**
 * Load all financial statements data for all tickers (preload)
 * This will attempt to load financial statements for all tickers found in dates.json
 */
async function loadAllFinancialStatements(dataType: DataType): Promise<Map<string, FinancialStatement>> {
  // Check cache first
  try {
    const cachedVersion = localStorage.getItem('spac_financial_statements_cache_version');
    const cachedDataType = localStorage.getItem('spac_financial_statements_cache_data_type');
    if (cachedVersion === FINANCIAL_STATEMENTS_CACHE_VERSION && cachedDataType === dataType) {
      const cached = localStorage.getItem(FINANCIAL_STATEMENTS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const statementsMap = new Map<string, FinancialStatement>();
        Object.entries(parsed).forEach(([k, v]) => {
          statementsMap.set(k, v as FinancialStatement);
        });
        return statementsMap;
      }
    }
  } catch (err) {
    console.warn('Error reading cached financial statements:', err);
  }

  // Load dates.json to get list of tickers
  const datesUrl = `/data/stock_data/${dataType}/dates.json`;
  let tickers: string[] = [];
  
  try {
    const datesResponse = await fetch(datesUrl, { cache: 'no-store' });
    if (datesResponse.ok) {
      const datesData = await datesResponse.json();
      tickers = Object.keys(datesData.ticker_to_date || {});
    }
  } catch (err) {
    console.warn('Error loading dates.json:', err);
  }

  // Load financial statements for all tickers in parallel
  const statementsMap = new Map<string, FinancialStatement>();
  const loadPromises = tickers.map(async (ticker) => {
    const statementsData = await loadFinancialStatementsForTicker(ticker, dataType);
    if (statementsData) {
      statementsMap.set(ticker, statementsData);
    }
  });

  await Promise.all(loadPromises);

  // Cache the result
  try {
    const cacheObj = Object.fromEntries(statementsMap);
    localStorage.setItem(FINANCIAL_STATEMENTS_CACHE_KEY, JSON.stringify(cacheObj));
    localStorage.setItem('spac_financial_statements_cache_version', FINANCIAL_STATEMENTS_CACHE_VERSION);
    localStorage.setItem('spac_financial_statements_cache_data_type', dataType);
  } catch (err) {
    // Handle quota exceeded errors gracefully - financial statements will load fresh each time
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      console.warn('Financial statements cache quota exceeded - data will load fresh each time. This is not critical.');
    } else {
      console.warn('Error caching financial statements:', err);
    }
  }

  return statementsMap;
}

/**
 * Get financial statements data for a specific ticker (from cache or load on demand)
 */
export async function getFinancialStatementsForTicker(ticker: string, dataType: DataType): Promise<FinancialStatement | null> {
  // Check cache first
  if (financialStatementsCache && cacheDataType === dataType) {
    const cached = financialStatementsCache.get(ticker);
    if (cached) {
      return cached;
    }
  }
  
  // Load on demand
  const statementsData = await loadFinancialStatementsForTicker(ticker, dataType);
  if (statementsData && financialStatementsCache && cacheDataType === dataType) {
    financialStatementsCache.set(ticker, statementsData);
  }
  
  return statementsData;
}

/**
 * Get financial statement events (transformed format) for a specific ticker
 */
export async function getFinancialStatementEventsForTicker(ticker: string, dataType: DataType): Promise<FinancialStatementEvent[]> {
  const statementsData = await getFinancialStatementsForTicker(ticker, dataType);
  if (!statementsData) {
    return [];
  }
  
  return extractEvents(statementsData);
}

/**
 * Preload all financial statements data for a data type
 */
export async function preloadAllFinancialStatements(dataType: DataType): Promise<Map<string, FinancialStatement>> {
  if (!financialStatementsCache || cacheDataType !== dataType) {
    financialStatementsCache = await loadAllFinancialStatements(dataType);
    cacheDataType = dataType;
  }
  return financialStatementsCache || new Map();
}

/**
 * Get all financial statements data (from cache)
 */
export function getAllFinancialStatements(): Map<string, FinancialStatement> {
  return financialStatementsCache || new Map();
}

/**
 * Clear financial statements cache (useful for testing or when data is updated)
 */
export function clearFinancialStatementsCache(): void {
  financialStatementsCache = null;
  cacheDataType = null;
  try {
    localStorage.removeItem(FINANCIAL_STATEMENTS_CACHE_KEY);
    localStorage.removeItem('spac_financial_statements_cache_version');
    localStorage.removeItem('spac_financial_statements_cache_data_type');
  } catch (err) {
    console.warn('Error clearing financial statements cache:', err);
  }
}

