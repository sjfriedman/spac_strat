// Run this in browser console to reset all data
console.log('Resetting all SPAC Strategy data...');
localStorage.removeItem('spac_strat_favorites');
localStorage.removeItem('spac_strat_locked');
console.log('✓ Favorites cleared');
console.log('✓ Locked positions cleared');
console.log('Refreshing page...');
setTimeout(() => location.reload(), 500);
