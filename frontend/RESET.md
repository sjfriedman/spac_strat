# Reset Instructions

## Reset All Data (Browser Console)

Open your browser's developer console (F12) and run:

```javascript
localStorage.removeItem('spac_strat_favorites');
localStorage.removeItem('spac_strat_locked');
location.reload();
```

## Or Use the Reset Button

Click the "Reset All" button in the top-right corner of the dashboard.

## Manual Reset Steps

1. Open browser DevTools (F12)
2. Go to Application/Storage tab
3. Find Local Storage
4. Delete keys:
   - `spac_strat_favorites`
   - `spac_strat_locked`
5. Refresh the page

