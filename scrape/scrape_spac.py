"""
Script to scrape SPAC calendar data from listingtrack.io
Uses Playwright (persistent Chrome profile) to navigate the calendar and extract ticker/action data
"""

import asyncio
import json
import os
import re
from datetime import datetime
from typing import List, Dict, Tuple, Set

import pandas as pd
from playwright.async_api import async_playwright, Page

# ========= Constants =========

CALENDAR_URL = "https://www.listingtrack.io/spacs/calendar?view=calendar"
CHROME_USER_DATA_DIR = os.path.expanduser("~/Library/Application Support/ListingTrackScraperProfile")

# Timeouts and delays
PAGE_LOAD_TIMEOUT = 60000
NETWORK_IDLE_TIMEOUT = 15000
MODAL_WAIT_TIMEOUT = 3000
BUTTON_CLICK_TIMEOUT = 3000
SCROLL_DELAY = 0.5
MODAL_OPEN_DELAY = 2.5
NAVIGATION_DELAY = 2
CAPTCHA_CHECK_INTERVAL = 5

# Limits
MAX_NAVIGATION_ATTEMPTS = 50
MAX_MORE_BUTTON_ROUNDS = 10
MAX_DATA_ENTRIES = 100000

# Selectors
GRIDCELL_SELECTOR = '[role="gridcell"]'
HEADING_SELECTOR = 'h6'
MODAL_SELECTORS = [
    '.fc-popover',
    '[role="dialog"]',
    '.MuiDialog-container',
    '[class*="MuiDialog"]',
    '[class*="modal"]',
    '[class*="dialog"]',
    '[class*="popup"]',
    '.fc-more-popover',
    '.fc-popover-body'
]
CLOSE_BUTTON_SELECTORS = [
    'button[title="Close"]',
    'button:has-text("Close")',
    '[aria-label*="close" i]',
    'button[aria-label*="Close" i]'
]
CAPTCHA_SELECTORS = [
    'text=/let\'s confirm you are human/i',
    'text=/human verification/i',
    '[role="dialog"]:has-text("human")',
    'button:has-text("Begin")'
]

# Regex patterns
TICKER_ACTION_PATTERNS = [
    r'([A-Z][A-Z0-9.]{0,5})\s*\(([^)]+)\)',
    r'([A-Z][A-Z0-9.]{0,5})\s+\(([^)]+)\)',
    r'([A-Z][A-Z0-9.]{0,5})\(([^)]+)\)'
]
MORE_BUTTON_PATTERN = r'\+?\d+\s*more'
DAY_PATTERN = r'^(\d{1,2})'
MONTH_YEAR_PATTERN = r'(\w+)\s+(\d{4})'
DATE_ARIA_PATTERN = r'(\w+)\s+(\d{1,2}),\s+(\d{4})'

# Output paths
# Get project root directory (parent of scrape folder)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'data', 'spac_calendar')

# ========= Helpers =========

def _chrome_user_data_dir() -> str:
    """Get stable Chrome profile directory"""
    os.makedirs(CHROME_USER_DATA_DIR, exist_ok=True)
    return CHROME_USER_DATA_DIR

async def _safe_close(obj, attr="close"):
    """Safely close an object if it has a close method"""
    if obj is None:
        return
    try:
        if hasattr(obj, attr):
            await getattr(obj, attr)()
    except Exception:
        pass

def _parse_month_year(text: str) -> Tuple[int, int]:
    """Parse month name and year from text"""
    match = re.search(MONTH_YEAR_PATTERN, text)
    if not match:
        return None, None
    
    month_name, year = match.group(1), int(match.group(2))
    try:
        month_num = datetime.strptime(month_name[:3], '%b').month
    except ValueError:
        try:
            month_num = datetime.strptime(month_name, '%B').month
        except ValueError:
            return None, None
    return month_num, year

async def _get_cell_date_from_data_attr(cell: any) -> datetime:
    """Get the actual date from cell's data-date attribute (format: YYYY-MM-DD)"""
    try:
        data_date = await cell.get_attribute('data-date')
        if data_date:
            # Parse YYYY-MM-DD format
            return datetime.strptime(data_date, '%Y-%m-%d')
    except Exception:
        pass
    return None

# ========= Scraper =========

class SPACCalendarScraper:
    def __init__(self, start_date: datetime, end_date: datetime, max_months_back: int = None):
        self.start_date = start_date
        self.end_date = end_date
        self.max_months_back = max_months_back
        self.data: List[Dict[str, str]] = []
        self.monthly_data: Dict[str, Dict] = {}

    async def _get_cells_with_dates(self, page: Page, target_month: int, target_year: int) -> List[Tuple[datetime, any]]:
        """Get all calendar cells with their actual dates from data-date attribute, filtered to target month"""
        cells = await page.query_selector_all(GRIDCELL_SELECTOR)
        cells_with_dates = []
        
        for cell in cells:
            try:
                cell_date = await _get_cell_date_from_data_attr(cell)
                if cell_date and cell_date.month == target_month and cell_date.year == target_year:
                    cells_with_dates.append((cell_date, cell))
            except Exception:
                continue
        
        # Sort by date
        cells_with_dates.sort(key=lambda x: x[0])
        return cells_with_dates

    async def _close_modal(self, page: Page) -> None:
        """Close modal using various methods"""
        try:
            close_button = await page.query_selector(', '.join(CLOSE_BUTTON_SELECTORS))
            if close_button and await close_button.is_visible():
                await close_button.click(timeout=BUTTON_CLICK_TIMEOUT)
                await asyncio.sleep(SCROLL_DELAY)
                return
        except Exception:
            pass
        
        # Fallback to Escape key
        try:
            await page.keyboard.press('Escape')
            await asyncio.sleep(SCROLL_DELAY)
        except Exception:
            pass

    async def _find_modal(self, page: Page) -> any:
        """Find modal using multiple selectors with shorter timeout"""
        # Try with shorter timeout first (1 second per selector)
        for selector in MODAL_SELECTORS:
            try:
                modal = await page.wait_for_selector(selector, timeout=1000, state='visible')
                if modal:
                    return modal
            except Exception:
                continue
        
        # Fallback: search for popover elements without waiting
        try:
            fc_elements = await page.query_selector_all('[class*="fc-"]')
            popover_candidates = []
            
            for elem in fc_elements[:50]:
                try:
                    class_name = await elem.get_attribute('class')
                    is_visible = await elem.is_visible()
                    if is_visible and class_name and 'popover' in class_name.lower():
                        text = await elem.inner_text()
                        popover_candidates.append((elem, text))
                except Exception:
                    continue
            
            if popover_candidates:
                popover_candidates.sort(key=lambda x: len(x[1]), reverse=True)
                return popover_candidates[0][0]
        except Exception:
            pass
        
        return None

    async def _extract_entries_from_text(self, text: str, date_str: str) -> List[Tuple[str, str, str]]:
        """Extract ticker/action pairs from text, returns list of tuples (date, ticker, action)"""
        entries = []
        for pattern in TICKER_ACTION_PATTERNS:
            for match in re.finditer(pattern, text):
                ticker, action = match.group(1).strip(), match.group(2).strip()
                if (ticker and action and len(ticker) <= 6 and len(action) > 0 and
                    'more' not in action.lower() and '+' not in ticker):
                    entries.append((date_str, ticker, action))
        return entries

    async def extract_from_modal(self, page: Page, date: datetime) -> List[Tuple[str, str, str]]:
        """Extract entries from modal popup, returns list of tuples (date, ticker, action)"""
        await asyncio.sleep(SCROLL_DELAY)
        
        modal = await self._find_modal(page)
        if not modal:
            return []
        
        try:
            modal_text = await modal.inner_text()
            date_str = date.strftime('%Y-%m-%d')
            entries = await self._extract_entries_from_text(modal_text, date_str)
            return entries
        except Exception:
            return []

    async def _click_more_button(self, page: Page, target_cell: any, date_key: str) -> bool:
        """Click the '+X more' button in a cell - it's an <a> tag with class fc-daygrid-more-link"""
        try:
            # The "+X more" button is an <a> tag with class fc-daygrid-more-link
            more_link = await target_cell.query_selector('a.fc-daygrid-more-link')
            
            if not more_link:
                more_link = await target_cell.query_selector('.fc-more-link')
            
            if not more_link:
                more_link = await target_cell.query_selector(f'a:has-text(/{MORE_BUTTON_PATTERN}/i)')
            
            if not more_link:
                return False
            
            await more_link.scroll_into_view_if_needed()
            await asyncio.sleep(SCROLL_DELAY)
            
            # Try clicking the link directly
            try:
                await more_link.click(timeout=BUTTON_CLICK_TIMEOUT)
                return True
            except Exception:
                # Fallback to mouse click at center
                try:
                    box = await more_link.bounding_box()
                    if box:
                        await page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
                        return True
                except Exception:
                    pass
                return False
        except Exception:
            return False

    async def _process_single_more_button(self, page: Page, cell_date: datetime,
                                         month_data: Dict, clicked_buttons: Set[str]) -> None:
        """Process a single '+X more' button for a specific date"""
        date_key = cell_date.strftime('%Y-%m-%d')
        button_key = f"{date_key}_more"
        
        if button_key in clicked_buttons:
            return
        
        clicked_buttons.add(button_key)
        
        # Re-query for fresh cell reference using actual date
        cells = await page.query_selector_all(GRIDCELL_SELECTOR)
        target_cell = None
        
        for cell in cells:
            try:
                cell_date_from_data = await _get_cell_date_from_data_attr(cell)
                if cell_date_from_data and cell_date_from_data.date() == cell_date.date():
                    target_cell = cell
                    break
            except Exception:
                continue
        
        if not target_cell:
            return
        
        # Click the button
        if not await self._click_more_button(page, target_cell, date_key):
            return
        
        await asyncio.sleep(MODAL_OPEN_DELAY)
        
        # Extract entries from modal
        modal_entries = await self.extract_from_modal(page, cell_date)
        if not modal_entries:
            await self._close_modal(page)
            return
        
        # Add unique entries
        if date_key not in month_data['dates']:
            month_data['dates'][date_key] = {'entries': [], 'count': 0}
        
        date_entries_set: Set[Tuple[str, str]] = set()
        for existing_entry in month_data['dates'][date_key]['entries']:
            # existing_entry is now (date, ticker, action)
            date_entries_set.add((existing_entry[1].upper(), existing_entry[2]))
        
        added_count = 0
        for entry in modal_entries:
            # entry is (date, ticker, action)
            entry_key = (entry[1].upper(), entry[2])
            if entry_key not in date_entries_set:
                date_entries_set.add(entry_key)
                month_data['dates'][date_key]['entries'].append(entry)
                month_data['dates'][date_key]['count'] += 1
                # Keep dict format for CSV compatibility
                self.data.append({'date': entry[0], 'ticker': entry[1], 'action': entry[2]})
                added_count += 1
        
        await self._close_modal(page)

    async def process_more_buttons(self, page: Page, month_data: Dict, year: int,
                                   month_num: int, clicked_buttons: Set[str]) -> None:
        """Find and process all '+X more' buttons for the target month"""
        cells_with_dates = await self._get_cells_with_dates(page, month_num, year)
        
        dates_to_process = []
        for cell_date, cell in cells_with_dates:
            try:
                cell_text = await cell.inner_text()
                if not re.search(MORE_BUTTON_PATTERN, cell_text, re.IGNORECASE):
                    continue
                
                if not (self.start_date <= cell_date <= self.end_date):
                    continue
                
                dates_to_process.append(cell_date)
            except Exception:
                continue
        
        if not dates_to_process:
            return
        
        for cell_date in dates_to_process:
            try:
                await self._process_single_more_button(page, cell_date, month_data, clicked_buttons)
            except Exception:
                await self._close_modal(page)

    async def _extract_visible_entries(self, page: Page, year: int, month_num: int,
                                      month_data: Dict) -> None:
        """Extract visible entries from calendar cells, only for the target month"""
        cells_with_dates = await self._get_cells_with_dates(page, month_num, year)
        
        for cell_date, cell in cells_with_dates:
            try:
                cell_text = await cell.inner_text()
                if not cell_text or not cell_text.strip():
                    continue
                
                date_key = cell_date.strftime('%Y-%m-%d')
                
                if not (self.start_date <= cell_date <= self.end_date):
                    continue
                
                if date_key not in month_data['dates']:
                    month_data['dates'][date_key] = {'entries': [], 'count': 0}
                
                date_entries_set: Set[Tuple[str, str]] = set()
                for existing_entry in month_data['dates'][date_key]['entries']:
                    # existing_entry is now (date, ticker, action)
                    date_entries_set.add((existing_entry[1].upper(), existing_entry[2]))
                
                entries = await self._extract_entries_from_text(cell_text, date_key)
                for entry in entries:
                    # entry is (date, ticker, action)
                    entry_key = (entry[1].upper(), entry[2])
                    if entry_key not in date_entries_set:
                        date_entries_set.add(entry_key)
                        month_data['dates'][date_key]['entries'].append(entry)
                        month_data['dates'][date_key]['count'] += 1
                        # Keep dict format for CSV compatibility
                        self.data.append({'date': entry[0], 'ticker': entry[1], 'action': entry[2]})
            except Exception:
                continue

    async def extract_calendar_entries(self, page: Page, current_view_date: datetime) -> Dict[str, Dict]:
        """Extract entries for current month"""
        month_data = {'dates': {}, 'count': 0}
        clicked_buttons: Set[str] = set()
        
        try:
            await page.wait_for_load_state('networkidle', timeout=NETWORK_IDLE_TIMEOUT)
            await asyncio.sleep(2)
            
            heading = await page.query_selector(HEADING_SELECTOR)
            if not heading:
                return month_data
            
            heading_text = await heading.inner_text()
            month_num, year = _parse_month_year(heading_text)
            if not month_num or not year:
                return month_data
            
            # Extract visible entries
            await self._extract_visible_entries(page, year, month_num, month_data)
            
            # Process '+X more' buttons
            for round_num in range(1, MAX_MORE_BUTTON_ROUNDS + 1):
                buttons_before = len(clicked_buttons)
                await self.process_more_buttons(page, month_data, year, month_num, clicked_buttons)
                buttons_after = len(clicked_buttons)
                
                if buttons_after == buttons_before:
                    break
            
            month_data['count'] = sum(d['count'] for d in month_data['dates'].values())
            return month_data
        except Exception:
            return month_data

    async def get_current_view_date(self, page: Page) -> datetime:
        """Get the currently displayed month/year from the page"""
        try:
            heading = await page.query_selector(HEADING_SELECTOR)
            if heading:
                text = await heading.inner_text()
                month_num, year = _parse_month_year(text)
                if month_num and year:
                    return datetime(year, month_num, 1)
            
            # Fallback: check data-date attributes
            cells = await page.query_selector_all(GRIDCELL_SELECTOR)
            for cell in cells[:10]:
                try:
                    cell_date = await _get_cell_date_from_data_attr(cell)
                    if cell_date:
                        return cell_date.replace(day=1)
                except Exception:
                    continue
        except Exception:
            pass
        
        return datetime.now()

    async def _navigate_to_month(self, page: Page, target_month: datetime) -> bool:
        """Navigate to target month"""
        max_attempts = MAX_NAVIGATION_ATTEMPTS
        for attempt in range(max_attempts):
            actual_view_date = await self.get_current_view_date(page)
            
            if (actual_view_date.month == target_month.month and
                actual_view_date.year == target_month.year):
                return True
            
            if actual_view_date <= target_month:
                return False
            
            # Find and click previous month button
            prev_button = None
            try:
                buttons = await page.query_selector_all('button')
                h6_elem = await page.query_selector(HEADING_SELECTOR)
                if h6_elem:
                    h6_bbox = await h6_elem.bounding_box()
                    if h6_bbox:
                        for btn in buttons:
                            try:
                                btn_bbox = await btn.bounding_box()
                                if (btn_bbox and btn_bbox['x'] < h6_bbox['x'] and
                                    abs(btn_bbox['y'] - h6_bbox['y']) < 50):
                                    prev_button = btn
                                    break
                            except Exception:
                                continue
            except Exception:
                pass
            
            if not prev_button:
                try:
                    svg_buttons = await page.query_selector_all('button:has(svg)')
                    h6_elem = await page.query_selector(HEADING_SELECTOR)
                    if h6_elem:
                        h6_bbox = await h6_elem.bounding_box()
                        if h6_bbox:
                            for btn in svg_buttons:
                                try:
                                    btn_bbox = await btn.bounding_box()
                                    if btn_bbox and btn_bbox['x'] < h6_bbox['x']:
                                        prev_button = btn
                                        break
                                except Exception:
                                    continue
                except Exception:
                    pass
            
            try:
                if prev_button:
                    await prev_button.scroll_into_view_if_needed()
                    await prev_button.click(timeout=BUTTON_CLICK_TIMEOUT)
                else:
                    await page.keyboard.press('ArrowLeft')
                await asyncio.sleep(NAVIGATION_DELAY)
            except Exception:
                await page.keyboard.press('ArrowLeft')
                await asyncio.sleep(NAVIGATION_DELAY)
        
        return False

    async def scrape_date_range(self, page: Page) -> None:
        """Scrape calendar data for the specified date range"""
        current_view_date = await self.get_current_view_date(page)
        start_month = current_view_date.replace(day=1)
        print(f"Starting from month: {current_view_date.strftime('%Y-%m')}")
        
        # Determine end month
        if self.max_months_back is None:
            end_month = self.start_date.replace(day=1)
            print(f"Will scrape backwards to: {self.start_date.strftime('%Y-%m')}")
        else:
            if self.max_months_back == 0:
                end_month = start_month
            else:
                months_to_go_back = self.max_months_back - 1
                end_month = start_month
                for _ in range(months_to_go_back):
                    if end_month.month == 1:
                        end_month = end_month.replace(year=end_month.year - 1, month=12, day=1)
                    else:
                        end_month = end_month.replace(month=end_month.month - 1, day=1)
        
        current_month = start_month
        months_scraped = 0
        
        while current_month >= end_month:
            if not await self._navigate_to_month(page, current_month):
                break
            
            print(f"Scraping {current_month.strftime('%Y-%m')}...", end=' ', flush=True)
            month_data = await self.extract_calendar_entries(page, current_month)
            
            month_key = current_month.strftime('%Y-%m')
            if month_data and month_data.get('count', 0) > 0:
                self.monthly_data[month_key] = month_data
                print(f"✓ {month_data['count']} entries")
            else:
                if month_key not in self.monthly_data:
                    self.monthly_data[month_key] = {'dates': {}, 'count': 0}
                print("✓ 0 entries")
            
            months_scraped += 1
            
            if (self.max_months_back is not None and
                months_scraped >= (self.max_months_back if self.max_months_back > 0 else 1)):
                break
            
            # Move to previous month
            if current_month.month == 1:
                current_month = current_month.replace(year=current_month.year - 1, month=12, day=1)
            else:
                current_month = current_month.replace(month=current_month.month - 1, day=1)
            
            if len(self.data) > MAX_DATA_ENTRIES:
                print(f"\nReached data limit ({MAX_DATA_ENTRIES} entries), stopping")
                break

    async def check_for_captcha(self, page: Page) -> bool:
        """Check if captcha/verification page is showing"""
        try:
            title = await page.title()
            if 'human verification' in title.lower() or 'verify' in title.lower():
                return True
            
            for selector in CAPTCHA_SELECTORS:
                try:
                    elem = await page.query_selector(selector)
                    if elem and await elem.is_visible():
                        return True
                except Exception:
                    continue
        except Exception:
            pass
        return False

    async def wait_for_user_ready(self, page: Page) -> None:
        """Wait for user to complete setup and be ready to scrape"""
        print("\n" + "="*60)
        print("Browser is open. Please:")
        print("1) Complete any captcha/login if needed")
        print("2) Navigate to the END month you want to scrape")
        print("3) Return here and press ENTER")
        print("="*60 + "\n")
        
        if await self.check_for_captcha(page):
            print("Captcha detected. Waiting for you to complete it...")
            while await self.check_for_captcha(page):
                await asyncio.sleep(CAPTCHA_CHECK_INTERVAL)
                print("  Still waiting for captcha completion...")
            print("Captcha completed! ✓")
        
        await asyncio.to_thread(input, "Press ENTER when ready to start scraping... ")
        print("\nStarting to scrape...\n")

    async def run(self) -> pd.DataFrame:
        """Run the scraper"""
        context = None
        page = None
        keep_alive_task = None

        async def keep_browser_alive(ctx, pg, interval=3):
            while True:
                try:
                    await asyncio.sleep(interval)
                    if ctx and pg:
                        try:
                            await pg.evaluate('() => document.title')
                        except Exception:
                            pass
                    else:
                        break
                except (asyncio.CancelledError, Exception):
                    break

        async with async_playwright() as p:
            try:
                print("Launching persistent Chrome context...")
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=_chrome_user_data_dir(),
                    channel="chrome",
                    headless=False,
                    slow_mo=50,
                    viewport={"width": 1440, "height": 900},
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--disable-dev-shm-usage",
                        "--no-sandbox",
                        "--disable-gpu",
                    ],
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                )
                print("Persistent context ready!")

                page = context.pages[0] if context.pages else await context.new_page()
                keep_alive_task = asyncio.create_task(keep_browser_alive(context, page))

                print("Navigating to calendar page...")
                try:
                    await page.goto(CALENDAR_URL, wait_until="domcontentloaded", timeout=PAGE_LOAD_TIMEOUT)
                    print("Page loaded successfully!")
                except Exception as e:
                    print(f"Navigation warning: {e}")
                    await asyncio.sleep(3)

                await self.wait_for_user_ready(page)
                await self.scrape_date_range(page)

            except KeyboardInterrupt:
                print("\nScraping interrupted by user")
            except Exception as e:
                print(f"Error during scraping: {e}")
                import traceback
                traceback.print_exc()
            finally:
                if keep_alive_task:
                    keep_alive_task.cancel()
                    try:
                        await keep_alive_task
                    except Exception:
                        pass
                if context:
                    await _safe_close(page, "close")
                    await _safe_close(context, "close")

        # Create DataFrame from collected data
        if self.data:
            df = pd.DataFrame(self.data)
            df['date'] = pd.to_datetime(df['date'])
            df = df.drop_duplicates(subset=['date', 'ticker', 'action'], keep='first')
            df = df.set_index('date').sort_index()
            return df
        else:
            return pd.DataFrame(columns=['ticker', 'action'])


# ========= Entrypoint =========

async def main():
    start_date = datetime(2020, 1, 1)
    end_date = datetime.now()
    max_months_back = None  # Set to None to scrape all, or a number for testing
    
    scraper = SPACCalendarScraper(start_date, end_date, max_months_back=max_months_back)
    df = await scraper.run()

    print(f"\nScraping complete!")
    print(f"Total entries: {len(df)}")
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Save data by month/year
    print(f"\nSaving data by month/year to {OUTPUT_DIR}/...")
    saved_files = []
    
    for month_key in sorted(scraper.monthly_data.keys()):
        month_info = scraper.monthly_data[month_key]
        
        # Parse month and year from month_key (format: 'YYYY-MM')
        year, month = month_key.split('-')
        month_num = int(month)
        year_num = int(year)
        
        # Create filename: spac_calendar_m{month}_y{year}
        filename_base = f'spac_calendar_m{month_num}_y{year_num}'
        csv_path = os.path.join(OUTPUT_DIR, f'{filename_base}.csv')
        json_path = os.path.join(OUTPUT_DIR, f'{filename_base}.json')
        
        # Extract entries for this month and create DataFrame
        month_entries = []
        for date_key, date_data in month_info['dates'].items():
            for entry in date_data['entries']:
                # entry is (date, ticker, action)
                month_entries.append({
                    'date': entry[0],
                    'ticker': entry[1],
                    'action': entry[2]
                })
        
        if month_entries:
            # Create DataFrame for this month
            month_df = pd.DataFrame(month_entries)
            month_df['date'] = pd.to_datetime(month_df['date'])
            month_df = month_df.drop_duplicates(subset=['date', 'ticker', 'action'], keep='first')
            month_df = month_df.set_index('date').sort_index()
            
            # Save CSV
            month_df.to_csv(csv_path)
            
            # Save JSON (just this month's data)
            with open(json_path, 'w') as f:
                json.dump({month_key: month_info}, f, indent=2)
            
            saved_files.append((csv_path, json_path, len(month_df)))
            print(f"  {month_key}: {len(month_df)} entries -> {filename_base}.csv & .json")
        else:
            # Still save empty JSON for months with no data
            with open(json_path, 'w') as f:
                json.dump({month_key: month_info}, f, indent=2)
            print(f"  {month_key}: 0 entries -> {filename_base}.json (empty)")
    
    print(f"\nSaved {len(saved_files)} month files to {OUTPUT_DIR}/")
    print(f"\nMonthly Summary:")
    for month_key in sorted(scraper.monthly_data.keys()):
        month_info = scraper.monthly_data[month_key]
        print(f"  {month_key}: {month_info['count']} total entries across {len(month_info['dates'])} dates")
    
    return df

if __name__ == '__main__':
    asyncio.run(main())
