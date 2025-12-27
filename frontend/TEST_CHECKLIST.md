# Testing Checklist

## Setup Tests
- [ ] `npm install` completes without errors
- [ ] `npm run dev` starts successfully
- [ ] App loads at http://localhost:3000
- [ ] No console errors on initial load

## Data Loading Tests
- [ ] Stock data loads from CSV files
- [ ] Volume data loads correctly
- [ ] IPO dates load from JSON
- [ ] All 139 stocks are loaded
- [ ] Charts display with data

## Chart Display Tests
- [ ] 4 charts display in 2x2 grid
- [ ] Each chart shows ticker symbol
- [ ] Each chart shows IPO date
- [ ] Price line chart displays correctly (green line)
- [ ] Volume bar chart displays below (blue bars)
- [ ] IPO reference line shows on chart
- [ ] Min/Max/Current stats show at bottom

## Interaction Tests
- [ ] Hover over chart shows tooltip with:
  - Date
  - Price ($XX.XX)
  - Volume (formatted number)
- [ ] Tooltip appears on both price and volume charts
- [ ] Tooltip styling is correct (dark background, readable)

## Navigation Tests
- [ ] Right arrow (→) moves to next set of 4 stocks
- [ ] Left arrow (←) moves to previous set of 4 stocks
- [ ] Navigation counter updates correctly
- [ ] Can navigate from first to last stocks
- [ ] Navigation wraps correctly at boundaries

## Lock Functionality Tests
- [ ] Click lock icon locks a chart
- [ ] Locked chart stays in position when navigating
- [ ] Lock icon changes appearance when locked (blue)
- [ ] Click lock again unlocks the chart
- [ ] Multiple charts can be locked simultaneously
- [ ] Locked positions persist after page refresh

## Star/Favorites Tests
- [ ] Click star icon adds to favorites
- [ ] Star icon changes appearance when starred (yellow)
- [ ] Click star again removes from favorites
- [ ] Favorites count updates in header
- [ ] Favorites persist after page refresh
- [ ] Multiple stocks can be starred

## Reset Functionality Tests
- [ ] Reset button appears in header
- [ ] Click reset shows confirmation dialog
- [ ] Cancel on dialog does nothing
- [ ] Confirm on dialog resets all favorites
- [ ] Confirm on dialog resets all locks
- [ ] After reset, charts reset to first 4 stocks
- [ ] After reset, favorites count is 0
- [ ] After reset, locked count is 0

## Edge Cases
- [ ] Empty chart position shows "No data"
- [ ] Navigation with all 4 locked doesn't break
- [ ] Navigation at end of list handles correctly
- [ ] Navigation at start of list handles correctly
- [ ] Very long ticker names display correctly
- [ ] Charts handle missing data gracefully

## Performance Tests
- [ ] Page loads in < 3 seconds
- [ ] Navigation is smooth (no lag)
- [ ] Hover tooltips appear instantly
- [ ] No memory leaks during navigation
- [ ] Charts render smoothly

## Browser Compatibility
- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Safari
- [ ] Works in Edge

