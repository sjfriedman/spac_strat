# SPAC Strategy Frontend

Interactive dashboard for visualizing SPAC stock data with professional-grade charts and analytics.

## Features

- **4-Panel Grid Layout**: View 4 stocks simultaneously in a split-screen layout
- **Arrow Key Navigation**: Use ← → keys to navigate through stocks (respects locked positions)
- **Interactive Charts**: Hover over charts to see price and volume at specific dates
- **Dual Chart Display**: Main price line chart with mini volume bar chart below
- **Lock Functionality**: Lock charts in position so they don't move with navigation
- **Favorites System**: Star stocks to mark as favorites (persisted in localStorage)
- **IPO Date Reference**: Visual reference line showing IPO date on each chart
- **Real-time Stats**: Min/Max/Current price displayed for each stock
- **Dark Theme**: Professional dark theme optimized for data visualization

## Quick Start

1. **Install dependencies:**
```bash
cd frontend
npm install
```

2. **Data files are already copied** to `public/data/stock_data/` (or run `./setup.sh` if needed)

3. **Start development server:**
```bash
npm run dev
```

The app will open at `http://localhost:3000`

## Usage

### Navigation
- **← Left Arrow**: Move to previous set of stocks
- **→ Right Arrow**: Move to next set of stocks
- Locked charts stay in place during navigation

### Chart Interactions
- **Hover**: Move mouse over any chart to see:
  - Exact date
  - Price at that date
  - Volume at that date
- **Lock Button** (🔒): Click to lock/unlock a chart position
- **Star Button** (⭐): Click to add/remove from favorites

### Features
- **Locked Charts**: When you lock a chart, it stays in that position even when navigating
- **Favorites**: Starred stocks are saved in localStorage and persist across sessions
- **Smart Navigation**: Arrow keys skip locked positions intelligently

## Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Data Format

The app expects three data files in `public/data/stock_data/`:
- `stock_data.csv` - Price data (date, ticker, close)
- `stock_volume.csv` - Volume data (date, ticker, volume)
- `ipo_dates.json` - IPO date mappings (ticker_to_date, date_to_tickers)

