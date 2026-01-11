import Papa from 'papaparse';

/**
 * Load and parse is_pipe.csv to get a map of ticker -> isPipe (boolean)
 * Returns a Map where keys are ticker symbols and values are booleans (true = is a pipe)
 */
export async function loadPipeData(): Promise<Map<string, boolean>> {
  const url = `/data/8k/is_pipe.csv`;
  
  console.log(`[Pipe Loader] Loading from: ${url}`);
  
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      console.error(`[Pipe Loader] HTTP ${response.status}: File not found or error loading ${url}`);
      return new Map();
    }
    
    const csvText = await response.text();
    console.log(`[Pipe Loader] Loaded ${csvText.length} bytes from ${url}`);
    
    if (!csvText || csvText.trim().length === 0) {
      console.error(`[Pipe Loader] CSV file is empty: ${url}`);
      return new Map();
    }
    
    // Parse CSV using PapaParse
    const parsed = Papa.parse(csvText, { 
      header: true, 
      skipEmptyLines: true,
      transformHeader: (header) => header.trim()
    });
    
    const pipeMap = new Map<string, boolean>();
    
    parsed.data.forEach((row: any) => {
      const ticker = row.ticker?.trim();
      if (!ticker) return;
      
      // The 'spac' column contains True/False as strings
      const spacValue = row.spac?.toString().trim();
      const isPipe = spacValue === 'True' || spacValue === 'true' || spacValue === '1';
      
      pipeMap.set(ticker, isPipe);
    });
    
    console.log(`[Pipe Loader] Loaded pipe data for ${pipeMap.size} tickers`);
    return pipeMap;
  } catch (error) {
    console.error(`[Pipe Loader] Error loading pipe data:`, error);
    return new Map();
  }
}

