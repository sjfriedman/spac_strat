
import pandas as pd
import numpy as np

# This file is meant to be used *with* your existing dynamic_helper.py.
# It imports the existing dynamic_helper class and adds strategy-builder functions
# that return the same output schema as find_backspread_ids:
# index = (id, date, trade_filter_id)
# cols  = ["ticker", "quantity", "direction"]

from dynamic_helper import dynamic_helper


def _empty_positions() -> pd.DataFrame:
    """Empty positions DF with the standard output schema."""
    return (
        pd.DataFrame(columns=["ticker", "quantity", "direction"])
        .set_index(pd.MultiIndex.from_arrays([[], [], []], names=["id", "date", "trade_filter_id"]))
    )


def _base_req(trade_filter: pd.DataFrame) -> pd.DataFrame:
    """
    Standard request builder:
    - one row per episode/trade
    - uses episode_end_date as the trade date (matches existing code)
    """
    req = trade_filter[["ticker", "episode_end_date"]].copy()
    req = req.rename(columns={"episode_end_date": "date"})
    req["date"] = pd.to_datetime(req["date"])
    req["trade_filter_id"] = np.arange(len(req), dtype=np.int64)
    return req


def _select_pct(
    options_data: pd.DataFrame,
    req: pd.DataFrame,
    option_type: str,
    pct_target: float,
    days_till_expiration_target: int,
    price_col: str,
    exclude_ids=None,
) -> pd.DataFrame:
    r = req[["trade_filter_id", "ticker", "date"]].copy()
    r["pct_target"] = float(pct_target)
    r["days_till_expiration_target"] = int(days_till_expiration_target)
    return dynamic_helper.select_option_contracts_batch(
        options_data,
        r,
        option_type=option_type,
        target_kind="pct",
        price_col=price_col,
        exclude_ids=exclude_ids,
    )


def _select_price(
    options_data: pd.DataFrame,
    req: pd.DataFrame,
    option_type: str,
    price_target: float | pd.Series,
    days_till_expiration_target: int,
    price_col: str,
    exclude_ids=None,
) -> pd.DataFrame:
    r = req[["trade_filter_id", "ticker", "date"]].copy()
    r["price_target"] = price_target
    r["days_till_expiration_target"] = int(days_till_expiration_target)
    return dynamic_helper.select_option_contracts_batch(
        options_data,
        r,
        option_type=option_type,
        target_kind="price",
        price_col=price_col,
        exclude_ids=exclude_ids,
    )


def _valid_intersection(*sels: pd.DataFrame) -> pd.Index:
    """Trade ids present in all selection DFs."""
    if not sels:
        return pd.Index([], name="trade_filter_id")
    idx = sels[0].index
    for s in sels[1:]:
        idx = idx.intersection(s.index)
    return idx


def _pos_from_sel(sel: pd.DataFrame, qty: int, direction: str) -> pd.DataFrame:
    pos = sel.reset_index()[["trade_filter_id", "ticker", "date", "id"]].copy()
    pos["quantity"] = int(qty)
    pos["direction"] = str(direction)
    return pos


def _drop_tids(sels: list[pd.DataFrame], bad_tids: pd.Index) -> list[pd.DataFrame]:
    if bad_tids is None or len(bad_tids) == 0:
        return sels
    out = []
    for s in sels:
        out.append(s.drop(bad_tids, errors="ignore"))
    return out


def _check_price_lt(a: pd.DataFrame, b: pd.DataFrame, price_col: str) -> pd.Index:
    """
    Return trade_filter_ids where a[price_col] >= b[price_col] (i.e., NOT cheaper).
    """
    if (price_col not in a.columns) or (price_col not in b.columns):
        return pd.Index([], name="trade_filter_id")
    ap = pd.to_numeric(a[price_col], errors="coerce")
    bp = pd.to_numeric(b[price_col], errors="coerce")
    bad = (ap >= bp).fillna(False)
    return bad[bad].index


def _check_price_gt(a: pd.DataFrame, b: pd.DataFrame, price_col: str) -> pd.Index:
    """
    Return trade_filter_ids where a[price_col] <= b[price_col] (i.e., NOT more expensive).
    """
    if (price_col not in a.columns) or (price_col not in b.columns):
        return pd.Index([], name="trade_filter_id")
    ap = pd.to_numeric(a[price_col], errors="coerce")
    bp = pd.to_numeric(b[price_col], errors="coerce")
    bad = (ap <= bp).fillna(False)
    return bad[bad].index


def _check_strike_order(
    low: pd.DataFrame,
    high: pd.DataFrame,
    op: str,
) -> pd.Index:
    """
    Strike order sanity check:
      op="lt" => require low.strike < high.strike
      op="gt" => require low.strike > high.strike
      op="eq" => require low.strike == high.strike
    Returns trade_filter_ids that violate the requirement.
    """
    if ("strike" not in low.columns) or ("strike" not in high.columns):
        return pd.Index([], name="trade_filter_id")

    lK = pd.to_numeric(low["strike"], errors="coerce")
    hK = pd.to_numeric(high["strike"], errors="coerce")

    if op == "lt":
        bad = ~(lK < hK)
    elif op == "gt":
        bad = ~(lK > hK)
    elif op == "eq":
        bad = ~(lK == hK)
    else:
        raise ValueError("op must be one of {'lt','gt','eq'}")

    bad = bad.fillna(False)
    return bad[bad].index


# ------------------------
# Single-leg strategies
# ------------------------

def find_long_call_ids(trade_filter, options_data, pct_target, days_till_expiration_target, price_col="last"):
    """Long 1 call (by pct_target, nearest DTE)."""
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)
    sel = _select_pct(options_data, req, "C", pct_target, days_till_expiration_target, price_col)
    if sel.empty:
        return _empty_positions()

    pos = _pos_from_sel(sel, qty=+1, direction="L")
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


def find_long_put_ids(trade_filter, options_data, pct_target, days_till_expiration_target, price_col="last"):
    """Long 1 put (by pct_target, nearest DTE)."""
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)
    sel = _select_pct(options_data, req, "P", pct_target, days_till_expiration_target, price_col)
    if sel.empty:
        return _empty_positions()

    pos = _pos_from_sel(sel, qty=+1, direction="L")
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


# ------------------------
# Vertical spreads (common)
# ------------------------

def find_bull_call_debit_spread_ids(
    trade_filter,
    options_data,
    pct_long_call,
    pct_short_call,
    days_till_expiration_target,
    price_col="last",
):
    """
    Bull call *debit* spread:
      +1 call at pct_long_call (typically ~0 ATM)
      -1 call at pct_short_call (typically more OTM, more negative)
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    long_sel = _select_pct(options_data, req, "C", pct_long_call, days_till_expiration_target, price_col)
    if long_sel.empty:
        return _empty_positions()

    short_sel = _select_pct(
        options_data, req, "C", pct_short_call, days_till_expiration_target, price_col, exclude_ids=long_sel["id"]
    )
    if short_sel.empty:
        return _empty_positions()

    valid = _valid_intersection(long_sel, short_sel)
    if len(valid) == 0:
        return _empty_positions()

    long_sel = long_sel.loc[valid]
    short_sel = short_sel.loc[valid]

    # Sanity: long should be more expensive than short (debit)
    bad = _check_price_gt(long_sel, short_sel, price_col)
    # Strike: short strike should be higher than long strike (call vertical)
    bad = bad.union(_check_strike_order(short_sel, long_sel, "gt"))

    long_sel, short_sel = _drop_tids([long_sel, short_sel], bad)
    if long_sel.empty or short_sel.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(long_sel, +1, "L"),
            _pos_from_sel(short_sel, -1, "S"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


def find_bear_put_debit_spread_ids(
    trade_filter,
    options_data,
    pct_long_put,
    pct_short_put,
    days_till_expiration_target,
    price_col="last",
):
    """
    Bear put *debit* spread (PUT VERTICAL):
      +1 put at pct_long_put (often ATM ~0 or slightly ITM > 0)
      -1 put at pct_short_put (often more OTM, negative)
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    long_sel = _select_pct(options_data, req, "P", pct_long_put, days_till_expiration_target, price_col)
    if long_sel.empty:
        return _empty_positions()

    short_sel = _select_pct(
        options_data, req, "P", pct_short_put, days_till_expiration_target, price_col, exclude_ids=long_sel["id"]
    )
    if short_sel.empty:
        return _empty_positions()

    valid = _valid_intersection(long_sel, short_sel)
    if len(valid) == 0:
        return _empty_positions()

    long_sel = long_sel.loc[valid]
    short_sel = short_sel.loc[valid]

    # Sanity: long should be more expensive than short (debit)
    bad = _check_price_gt(long_sel, short_sel, price_col)
    # Strike: long strike should be higher than short strike (put vertical)
    bad = bad.union(_check_strike_order(long_sel, short_sel, "gt"))

    long_sel, short_sel = _drop_tids([long_sel, short_sel], bad)
    if long_sel.empty or short_sel.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(long_sel, +1, "L"),
            _pos_from_sel(short_sel, -1, "S"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


def find_bull_put_credit_spread_ids(
    trade_filter,
    options_data,
    pct_short_put,
    pct_long_put,
    days_till_expiration_target,
    price_col="last",
):
    """
    Bull put *credit* spread:
      -1 put at pct_short_put (often slightly OTM, small negative)
      +1 put at pct_long_put (further OTM, more negative)
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    short_sel = _select_pct(options_data, req, "P", pct_short_put, days_till_expiration_target, price_col)
    if short_sel.empty:
        return _empty_positions()

    long_sel = _select_pct(
        options_data, req, "P", pct_long_put, days_till_expiration_target, price_col, exclude_ids=short_sel["id"]
    )
    if long_sel.empty:
        return _empty_positions()

    valid = _valid_intersection(short_sel, long_sel)
    if len(valid) == 0:
        return _empty_positions()

    short_sel = short_sel.loc[valid]
    long_sel = long_sel.loc[valid]

    # Sanity: long should be cheaper than short (credit spread wing)
    bad = _check_price_lt(long_sel, short_sel, price_col)
    # Strike: long strike should be lower than short strike (further OTM put)
    bad = bad.union(_check_strike_order(long_sel, short_sel, "lt"))

    short_sel, long_sel = _drop_tids([short_sel, long_sel], bad)
    if short_sel.empty or long_sel.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(short_sel, -1, "S"),
            _pos_from_sel(long_sel, +1, "L"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


def find_bear_call_credit_spread_ids(
    trade_filter,
    options_data,
    pct_short_call,
    pct_long_call,
    days_till_expiration_target,
    price_col="last",
):
    """
    Bear call *credit* spread:
      -1 call at pct_short_call (often slightly OTM, negative)
      +1 call at pct_long_call (further OTM, more negative)
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    short_sel = _select_pct(options_data, req, "C", pct_short_call, days_till_expiration_target, price_col)
    if short_sel.empty:
        return _empty_positions()

    long_sel = _select_pct(
        options_data, req, "C", pct_long_call, days_till_expiration_target, price_col, exclude_ids=short_sel["id"]
    )
    if long_sel.empty:
        return _empty_positions()

    valid = _valid_intersection(short_sel, long_sel)
    if len(valid) == 0:
        return _empty_positions()

    short_sel = short_sel.loc[valid]
    long_sel = long_sel.loc[valid]

    # Sanity: long should be cheaper than short (credit spread wing)
    bad = _check_price_lt(long_sel, short_sel, price_col)
    # Strike: long strike should be higher than short strike (further OTM call)
    bad = bad.union(_check_strike_order(long_sel, short_sel, "gt"))

    short_sel, long_sel = _drop_tids([short_sel, long_sel], bad)
    if short_sel.empty or long_sel.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(short_sel, -1, "S"),
            _pos_from_sel(long_sel, +1, "L"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


# ------------------------
# Required: Put vertical + extra long tail put
# ------------------------

def find_bull_put_credit_spread_plus_tail_put_ids(
    trade_filter,
    options_data,
    pct_short_put,
    pct_long_put,
    pct_tail_put,
    days_till_expiration_target,
    price_col="last",
    tail_qty: int = 1,
):
    """
    PUT VERTICAL + EXTRA LONG TAIL PUT (3 legs):

      -1 put at pct_short_put   (usually slightly OTM)
      +1 put at pct_long_put    (further OTM protective wing)
      +tail_qty put at pct_tail_put  (much further OTM "tail hedge")

    All legs use nearest DTE to days_till_expiration_target.
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    short_sel = _select_pct(options_data, req, "P", pct_short_put, days_till_expiration_target, price_col)
    if short_sel.empty:
        return _empty_positions()

    long_sel = _select_pct(
        options_data, req, "P", pct_long_put, days_till_expiration_target, price_col, exclude_ids=short_sel["id"]
    )
    if long_sel.empty:
        return _empty_positions()

    # Tail selection: exclude long_sel id (can't exclude both), then drop any dupes vs short afterwards
    tail_sel = _select_pct(
        options_data, req, "P", pct_tail_put, days_till_expiration_target, price_col, exclude_ids=long_sel["id"]
    )
    if tail_sel.empty:
        return _empty_positions()

    valid = _valid_intersection(short_sel, long_sel, tail_sel)
    if len(valid) == 0:
        return _empty_positions()

    short_sel = short_sel.loc[valid]
    long_sel = long_sel.loc[valid]
    tail_sel = tail_sel.loc[valid]

    # Drop any trades where tail accidentally equals short (can happen because exclude_ids only excludes one id)
    dup_bad = tail_sel["id"] == short_sel["id"]
    dup_bad = dup_bad.fillna(False)
    bad = dup_bad[dup_bad].index

    # Sanity: both long & tail should be cheaper than the short
    bad = bad.union(_check_price_lt(long_sel, short_sel, price_col))
    bad = bad.union(_check_price_lt(tail_sel, short_sel, price_col))

    # Strike ordering (if available): tail < long < short
    bad = bad.union(_check_strike_order(tail_sel, long_sel, "lt"))
    bad = bad.union(_check_strike_order(long_sel, short_sel, "lt"))

    short_sel, long_sel, tail_sel = _drop_tids([short_sel, long_sel, tail_sel], bad)
    if short_sel.empty or long_sel.empty or tail_sel.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(short_sel, -1, "S"),
            _pos_from_sel(long_sel, +1, "L"),
            _pos_from_sel(tail_sel, +int(tail_qty), "L"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


# ------------------------
# 2-leg volatility bets (common)
# ------------------------

def find_long_straddle_ids(trade_filter, options_data, pct_target, days_till_expiration_target, price_col="last"):
    """
    Long straddle:
      +1 call at pct_target (ATM if pct_target=0)
      +1 put  at pct_target (ATM if pct_target=0)
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    call_sel = _select_pct(options_data, req, "C", pct_target, days_till_expiration_target, price_col)
    put_sel  = _select_pct(options_data, req, "P", pct_target, days_till_expiration_target, price_col)

    if call_sel.empty or put_sel.empty:
        return _empty_positions()

    valid = _valid_intersection(call_sel, put_sel)
    if len(valid) == 0:
        return _empty_positions()

    call_sel = call_sel.loc[valid]
    put_sel = put_sel.loc[valid]

    pos = pd.concat(
        [
            _pos_from_sel(call_sel, +1, "L"),
            _pos_from_sel(put_sel, +1, "L"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


# ------------------------
# 4-leg neutral income (common)
# ------------------------

def find_iron_condor_ids(
    trade_filter,
    options_data,
    pct_short_put,
    pct_long_put,
    pct_short_call,
    pct_long_call,
    days_till_expiration_target,
    price_col="last",
):
    """
    Iron condor (4 legs):
      -1 put  at pct_short_put
      +1 put  at pct_long_put   (tail-side wing)
      -1 call at pct_short_call
      +1 call at pct_long_call  (call-side wing)
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    sp = _select_pct(options_data, req, "P", pct_short_put, days_till_expiration_target, price_col)
    if sp.empty:
        return _empty_positions()

    lp = _select_pct(options_data, req, "P", pct_long_put, days_till_expiration_target, price_col, exclude_ids=sp["id"])
    if lp.empty:
        return _empty_positions()

    sc = _select_pct(options_data, req, "C", pct_short_call, days_till_expiration_target, price_col)
    if sc.empty:
        return _empty_positions()

    lc = _select_pct(options_data, req, "C", pct_long_call, days_till_expiration_target, price_col, exclude_ids=sc["id"])
    if lc.empty:
        return _empty_positions()

    valid = _valid_intersection(sp, lp, sc, lc)
    if len(valid) == 0:
        return _empty_positions()

    sp = sp.loc[valid]
    lp = lp.loc[valid]
    sc = sc.loc[valid]
    lc = lc.loc[valid]

    # Sanity: wings cheaper than shorts
    bad = _check_price_lt(lp, sp, price_col).union(_check_price_lt(lc, sc, price_col))

    # Strike ordering:
    bad = bad.union(_check_strike_order(lp, sp, "lt"))  # put wing lower strike
    bad = bad.union(_check_strike_order(lc, sc, "gt"))  # call wing higher strike
    # Optional: short put strike should be below short call strike
    if ("strike" in sp.columns) and ("strike" in sc.columns):
        spK = pd.to_numeric(sp["strike"], errors="coerce")
        scK = pd.to_numeric(sc["strike"], errors="coerce")
        bad2 = ~(spK < scK)
        bad2 = bad2.fillna(False)
        bad = bad.union(bad2[bad2].index)

    sp, lp, sc, lc = _drop_tids([sp, lp, sc, lc], bad)
    if sp.empty or lp.empty or sc.empty or lc.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(sp, -1, "S"),
            _pos_from_sel(lp, +1, "L"),
            _pos_from_sel(sc, -1, "S"),
            _pos_from_sel(lc, +1, "L"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


# ------------------------
# Less common: Jade lizard
# ------------------------

def find_jade_lizard_ids(
    trade_filter,
    options_data,
    pct_short_put,
    pct_short_call,
    pct_long_call,
    days_till_expiration_target,
    price_col="last",
):
    """
    Jade lizard (3 legs):
      -1 put  at pct_short_put
      -1 call at pct_short_call
      +1 call at pct_long_call   (higher strike wing, further OTM)

    This is effectively: short put + short call spread.
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    sp = _select_pct(options_data, req, "P", pct_short_put, days_till_expiration_target, price_col)
    if sp.empty:
        return _empty_positions()

    sc = _select_pct(options_data, req, "C", pct_short_call, days_till_expiration_target, price_col)
    if sc.empty:
        return _empty_positions()

    lc = _select_pct(options_data, req, "C", pct_long_call, days_till_expiration_target, price_col, exclude_ids=sc["id"])
    if lc.empty:
        return _empty_positions()

    valid = _valid_intersection(sp, sc, lc)
    if len(valid) == 0:
        return _empty_positions()

    sp = sp.loc[valid]
    sc = sc.loc[valid]
    lc = lc.loc[valid]

    # Sanity: call wing cheaper than short call
    bad = _check_price_lt(lc, sc, price_col)

    # Strike: long call strike > short call strike
    bad = bad.union(_check_strike_order(lc, sc, "gt"))

    sp, sc, lc = _drop_tids([sp, sc, lc], bad)
    if sp.empty or sc.empty or lc.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(sp, -1, "S"),
            _pos_from_sel(sc, -1, "S"),
            _pos_from_sel(lc, +1, "L"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


# ------------------------
# Not uncommon: Call backspread (ratio backspread)
# ------------------------

def find_call_backspread_ids(trade_filter, options_data, pct_target, days_till_expiration_target, price_col="last"):
    """
    Call backspread (2 legs, ratio):
      -1 call near pct_target (ATM if pct_target=0)
      +2 calls (higher strike) targeting half the short premium
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)
    req["pct_target"] = float(pct_target)
    req["days_till_expiration_target"] = int(days_till_expiration_target)

    short_sel = dynamic_helper.select_option_contracts_batch(
        options_data,
        req[["trade_filter_id", "ticker", "date", "pct_target", "days_till_expiration_target"]],
        option_type="C",
        target_kind="pct",
        price_col=price_col,
    )
    if short_sel.empty:
        return _empty_positions()

    long_req = short_sel.reset_index()[["trade_filter_id", "ticker", "date", price_col]].copy()
    long_req = long_req.rename(columns={price_col: "short_px"})
    long_req["price_target"] = long_req["short_px"] / 2.0
    long_req["days_till_expiration_target"] = int(days_till_expiration_target)

    long_sel = dynamic_helper.select_option_contracts_batch(
        options_data,
        long_req[["trade_filter_id", "ticker", "date", "price_target", "days_till_expiration_target"]],
        option_type="C",
        target_kind="price",
        price_col=price_col,
        exclude_ids=short_sel["id"],
    )
    if long_sel.empty:
        return _empty_positions()

    valid = _valid_intersection(short_sel, long_sel)
    if len(valid) == 0:
        return _empty_positions()

    short_sel = short_sel.loc[valid]
    long_sel = long_sel.loc[valid]

    # Sanity: long cheaper than short (per contract)
    bad = _check_price_lt(long_sel, short_sel, price_col)
    # Strike: long strike higher than short strike
    bad = bad.union(_check_strike_order(long_sel, short_sel, "gt"))

    short_sel, long_sel = _drop_tids([short_sel, long_sel], bad)
    if short_sel.empty or long_sel.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(short_sel, -1, "S"),
            _pos_from_sel(long_sel, +2, "L"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


# ------------------------
# Time structure: Call calendar spread
# ------------------------

def find_call_calendar_ids(
    trade_filter,
    options_data,
    pct_target,
    dte_short,
    dte_long,
    price_col="last",
):
    """
    Call calendar:
      -1 call near dte_short at pct_target
      +1 call near dte_long at (roughly) same strike (uses pct_from_strike from the short leg)

    Notes:
    - This approximates "same strike" by targeting the short leg's pct_from_strike.
    - If strike columns are available, we enforce exact strike equality.
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    short_sel = _select_pct(options_data, req, "C", pct_target, int(dte_short), price_col)
    if short_sel.empty:
        return _empty_positions()

    long_req = short_sel.reset_index()[["trade_filter_id", "ticker", "date", "pct_from_strike"]].copy()
    long_req = long_req.rename(columns={"pct_from_strike": "pct_target"})
    long_req["days_till_expiration_target"] = int(dte_long)

    long_sel = dynamic_helper.select_option_contracts_batch(
        options_data,
        long_req[["trade_filter_id", "ticker", "date", "pct_target", "days_till_expiration_target"]],
        option_type="C",
        target_kind="pct",
        price_col=price_col,
        exclude_ids=short_sel["id"],
    )
    if long_sel.empty:
        return _empty_positions()

    valid = _valid_intersection(short_sel, long_sel)
    if len(valid) == 0:
        return _empty_positions()

    short_sel = short_sel.loc[valid]
    long_sel = long_sel.loc[valid]

    # Require longer-dated leg to actually have higher DTE (when available)
    if ("days_till_expiration" in short_sel.columns) and ("days_till_expiration" in long_sel.columns):
        sd = pd.to_numeric(short_sel["days_till_expiration"], errors="coerce")
        ld = pd.to_numeric(long_sel["days_till_expiration"], errors="coerce")
        bad = ~(ld > sd)
        bad = bad.fillna(False)
        bad_tids = bad[bad].index
        short_sel = short_sel.drop(bad_tids, errors="ignore")
        long_sel = long_sel.drop(bad_tids, errors="ignore")

    # If strike exists, enforce same strike for a true calendar
    bad = _check_strike_order(long_sel, short_sel, "eq")
    short_sel, long_sel = _drop_tids([short_sel, long_sel], bad)
    if short_sel.empty or long_sel.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(short_sel, -1, "S"),
            _pos_from_sel(long_sel, +1, "L"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]




def find_bear_put_debit_spread_plus_tail_put_ids(
    trade_filter,
    options_data,
    pct_long_put,
    pct_short_put,
    pct_tail_put,
    days_till_expiration_target,
    price_col="last",
    tail_qty: int = 1,
):
    """
    PUT VERTICAL (DEBIT / bear put spread) + EXTRA LONG TAIL PUT (3 legs):

      +1 put at pct_long_put        (higher strike; ATM/ITM typically)
      -1 put at pct_short_put       (lower strike; OTM typically)
      +tail_qty put at pct_tail_put (even lower strike; deep OTM tail hedge)

    All legs use nearest DTE to days_till_expiration_target.
    """
    if trade_filter.empty:
        return _empty_positions()

    req = _base_req(trade_filter)

    long_sel = _select_pct(options_data, req, "P", pct_long_put, days_till_expiration_target, price_col)
    if long_sel.empty:
        return _empty_positions()

    short_sel = _select_pct(
        options_data, req, "P", pct_short_put, days_till_expiration_target, price_col, exclude_ids=long_sel["id"]
    )
    if short_sel.empty:
        return _empty_positions()

    # Tail: exclude short_sel id (can't exclude both), then drop dupes vs long afterwards
    tail_sel = _select_pct(
        options_data, req, "P", pct_tail_put, days_till_expiration_target, price_col, exclude_ids=short_sel["id"]
    )
    if tail_sel.empty:
        return _empty_positions()

    valid = _valid_intersection(long_sel, short_sel, tail_sel)
    if len(valid) == 0:
        return _empty_positions()

    long_sel = long_sel.loc[valid]
    short_sel = short_sel.loc[valid]
    tail_sel = tail_sel.loc[valid]

    # Drop dupes (exclude_ids only excluded one id)
    bad = pd.Index([], name="trade_filter_id")
    dup1 = tail_sel["id"] == long_sel["id"]
    dup2 = tail_sel["id"] == short_sel["id"]
    bad = bad.union(dup1[dup1.fillna(False)].index).union(dup2[dup2.fillna(False)].index)

    # Sanity: debit spread => long more expensive than short
    bad = bad.union(_check_price_gt(long_sel, short_sel, price_col))
    # Tail should be cheaper than (or at least not more expensive than) the short OTM put
    bad = bad.union(_check_price_lt(tail_sel, short_sel, price_col))

    # Strike ordering (if available): tail < short < long
    bad = bad.union(_check_strike_order(tail_sel, short_sel, "lt"))
    bad = bad.union(_check_strike_order(short_sel, long_sel, "lt"))

    long_sel, short_sel, tail_sel = _drop_tids([long_sel, short_sel, tail_sel], bad)
    if long_sel.empty or short_sel.empty or tail_sel.empty:
        return _empty_positions()

    pos = pd.concat(
        [
            _pos_from_sel(long_sel, +1, "L"),
            _pos_from_sel(short_sel, -1, "S"),
            _pos_from_sel(tail_sel, +int(tail_qty), "L"),
        ],
        ignore_index=True,
    )
    pos = pos.set_index(["id", "date", "trade_filter_id"]).sort_index()
    return pos[["ticker", "quantity", "direction"]]


def find_backspread_ids(
    trade_filter,
    options_data,
    pct_target,
    days_till_expiration_target,
    price_col="last",
    max_strike_width=None,        # absolute strike width (e.g. 2.5)
    max_strike_width_pct=None,    # percent strike width (e.g. 0.05 for 5%)
):

    def _empty():
        return pd.DataFrame(
            columns=["ticker", "quantity", "direction"]
        ).set_index(pd.MultiIndex.from_arrays([[], [], []], names=["id", "date", "trade_filter_id"]))

    if trade_filter.empty:
        return _empty()

    # One request per episode/trade
    req = trade_filter[['ticker', 'episode_end_date']].copy()
    req = req.rename(columns={'episode_end_date': "date"})
    req["date"] = pd.to_datetime(req["date"])
    req["trade_filter_id"] = np.arange(len(req), dtype=np.int64)
    req["pct_target"] = float(pct_target)
    req["days_till_expiration_target"] = int(days_till_expiration_target)

    # short put: closest pct_from_strike to pct_target (with nearest DTE)
    short_sel = dynamic_helper.select_option_contracts_batch(
        options_data,
        req[["trade_filter_id", 'ticker', "date", "pct_target", "days_till_expiration_target"]],
        option_type="P",
        target_kind="pct",
        price_col=price_col
    )
    if short_sel.empty:
        return _empty()

    # Ensure we have strike for the short leg (needed for width constraint)
    if "strike" not in short_sel.columns:
        strike_map = (
            options_data.reset_index()[["id", "strike"]]
            .drop_duplicates("id")
            .set_index("id")["strike"]
        )
        short_sel = short_sel.copy()
        short_sel["strike"] = short_sel["id"].map(strike_map)

    # long target premium = short price / 2
    long_req = short_sel.reset_index()[["trade_filter_id", 'ticker', "date", price_col, "id", "strike"]].copy()
    long_req = long_req.rename(columns={price_col: "short_px", "id": "short_id", "strike": "short_strike"})
    long_req["price_target"] = long_req["short_px"] / 2.0
    long_req["days_till_expiration_target"] = int(days_till_expiration_target)

    # ------------------------------------------------------------------
    # Long put selection:
    #   - default: price-target selection
    #   - if max_strike_width or max_strike_width_pct set, constrain strike distance
    # ------------------------------------------------------------------
    use_width_constraint = (max_strike_width is not None) or (max_strike_width_pct is not None)

    if not use_width_constraint:
        long_sel = dynamic_helper.select_option_contracts_batch(
            options_data,
            long_req[["trade_filter_id", 'ticker', "date", "price_target", "days_till_expiration_target"]],
            option_type="P",
            target_kind="price",
            price_col=price_col,
            exclude_ids=short_sel["id"],
        )
        if long_sel.empty:
            return _empty()

    else:
        opt = options_data.reset_index().copy()
        opt["date"] = pd.to_datetime(opt["date"])

        tickers = long_req["ticker"].unique()
        dates = long_req["date"].unique()

        keep_cols = ["id", "date", "ticker", "option_type", "days_till_expiration", price_col, "pct_from_strike", "strike"]
        opt = opt[
            (opt["option_type"] == "P") &
            (opt["ticker"].isin(tickers)) &
            (opt["date"].isin(dates))
        ][[c for c in keep_cols if c in opt.columns]]

        if opt.empty:
            return _empty()

        cand = opt.merge(long_req, on=["ticker", "date"], how="inner")
        if cand.empty:
            return _empty()

        # Exclude short id (never pick same contract)
        cand = cand[cand["id"] != cand["short_id"]]

        # Numeric coercions
        cand["strike"] = pd.to_numeric(cand["strike"], errors="coerce")
        cand["short_strike"] = pd.to_numeric(cand["short_strike"], errors="coerce")
        cand[price_col] = pd.to_numeric(cand[price_col], errors="coerce")
        cand["price_target"] = pd.to_numeric(cand["price_target"], errors="coerce")
        cand["days_till_expiration"] = pd.to_numeric(cand["days_till_expiration"], errors="coerce")
        cand["days_till_expiration_target"] = pd.to_numeric(cand["days_till_expiration_target"], errors="coerce")

        cand = cand.dropna(subset=["strike", "short_strike", price_col, "price_target", "days_till_expiration", "days_till_expiration_target"])

        if cand.empty:
            return _empty()

        # Long must be below short for a put backspread
        cand["strike_width"] = cand["short_strike"] - cand["strike"]
        cand = cand[cand["strike_width"] > 0]

        # Percent width constraint (relative to short strike)
        if max_strike_width_pct is not None:
            max_pct = float(max_strike_width_pct)
            cand["strike_width_pct"] = cand["strike_width"] / cand["short_strike"].replace(0, np.nan)
            cand = cand[cand["strike_width_pct"].notna() & (cand["strike_width_pct"] <= max_pct)]
        else:
            cand["strike_width_pct"] = np.nan

        # Absolute width constraint
        if max_strike_width is not None:
            max_abs = float(max_strike_width)
            cand = cand[cand["strike_width"] <= max_abs]

        if cand.empty:
            return _empty()

        # Ensure long is cheaper than short (per contract)
        cand = cand[cand[price_col] < cand["short_px"]]
        if cand.empty:
            return _empty()

        # Nearest DTE filter per trade_filter_id
        cand["dte_dist"] = (cand["days_till_expiration"] - cand["days_till_expiration_target"]).abs()
        min_dte = cand.groupby("trade_filter_id", sort=False)["dte_dist"].transform("min")
        cand = cand[cand["dte_dist"] == min_dte]
        if cand.empty:
            return _empty()

        # Match price target, then prefer tighter strike width (pct if provided, else abs)
        cand["dist"] = (cand[price_col] - cand["price_target"]).abs()

        sort_cols = ["trade_filter_id", "dist"]
        asc = [True, True]

        if max_strike_width_pct is not None:
            sort_cols.append("strike_width_pct")
            asc.append(True)
        else:
            sort_cols.append("strike_width")
            asc.append(True)

        sort_cols.append("id")
        asc.append(True)

        cand = cand.sort_values(sort_cols, ascending=asc, kind="mergesort")

        best = cand.groupby("trade_filter_id", sort=False).first()
        long_sel = best[["ticker", "date", "id", "days_till_expiration", price_col, "pct_from_strike", "strike"]]

        if long_sel.empty:
            return _empty()

    # Keep only trades where we have BOTH legs
    valid_tids = short_sel.index.intersection(long_sel.index)
    if len(valid_tids) == 0:
        return _empty()

    short_sel = short_sel.loc[valid_tids]
    long_sel = long_sel.loc[valid_tids]

    # Optional sanity checks
    # 1) ensure long contract is actually cheaper than the short (per contract)
    if price_col in short_sel.columns and price_col in long_sel.columns:
        bad = pd.to_numeric(long_sel[price_col], errors="coerce") >= pd.to_numeric(short_sel[price_col], errors="coerce")
        bad = bad.fillna(False)
        if bad.any():
            bad_tids = bad[bad].index
            short_sel = short_sel.drop(bad_tids)
            long_sel = long_sel.drop(bad_tids)

    # 2) ensure long strike is lower than short strike
    if ("strike" in short_sel.columns) and ("strike" in long_sel.columns):
        sK = pd.to_numeric(short_sel["strike"], errors="coerce")
        lK = pd.to_numeric(long_sel["strike"], errors="coerce")
        bad = ~(lK < sK)
        bad = bad.fillna(False)
        if bad.any():
            bad_tids = bad[bad].index
            short_sel = short_sel.drop(bad_tids)
            long_sel = long_sel.drop(bad_tids)

    # 3) final guard: enforce width constraints if enabled
    if use_width_constraint and ("strike" in short_sel.columns) and ("strike" in long_sel.columns):
        sK = pd.to_numeric(short_sel["strike"], errors="coerce")
        lK = pd.to_numeric(long_sel["strike"], errors="coerce")

        width = sK - lK
        bad = ~(width > 0)

        if max_strike_width is not None:
            bad = bad | (width > float(max_strike_width))

        if max_strike_width_pct is not None:
            pct_width = width / sK.replace(0, np.nan)
            bad = bad | pct_width.isna() | (pct_width > float(max_strike_width_pct))

        bad = bad.fillna(False)
        if bad.any():
            bad_tids = bad[bad].index
            short_sel = short_sel.drop(bad_tids)
            long_sel = long_sel.drop(bad_tids)

    if short_sel.empty or long_sel.empty:
        return _empty()

    # Assemble positions (2 rows per trade)
    short_pos = short_sel.reset_index()[["trade_filter_id", 'ticker', "date", "id"]].copy()
    short_pos["quantity"] = -1
    short_pos["direction"] = "S"

    long_pos = long_sel.reset_index()[["trade_filter_id", 'ticker', "date", "id"]].copy()
    long_pos["quantity"] = +2
    long_pos["direction"] = "L"

    positions = pd.concat([short_pos, long_pos], ignore_index=True)
    positions = positions.set_index(['id', "date", "trade_filter_id"]).sort_index()

    return positions[["ticker", "quantity", "direction"]]

def find_call_split_strangle_ids(
    trade_filter,
    options_data,
    pct_target,
    days_till_expiration_target,
    price_col="last",
):
    """Build a 3-leg structure per trade_filter_id:

    - Short 1 call near pct_target (ATM if pct_target=0), nearest DTE
    - Split the collected premium in half
    - Long 1 OTM call (strike ABOVE spot) targeting half-premium
    - Long 1 OTM put (strike BELOW spot) targeting half-premium

    Output schema matches find_backspread_ids:
    index = (id, date, trade_filter_id)
    columns = ['ticker', 'quantity', 'direction']
    """

    def _empty():
        return pd.DataFrame(
            columns=["ticker", "quantity", "direction"]
        ).set_index(
            pd.MultiIndex.from_arrays([[], [], []], names=["id", "date", "trade_filter_id"])
        )

    if trade_filter.empty:
        return _empty()

    # One request per episode/trade
    req = trade_filter[["ticker", "episode_end_date"]].copy()
    req = req.rename(columns={"episode_end_date": "date"})
    req["date"] = pd.to_datetime(req["date"])
    req["trade_filter_id"] = np.arange(len(req), dtype=np.int64)
    req["pct_target"] = float(pct_target)
    req["days_till_expiration_target"] = int(days_till_expiration_target)

    # 1) short call: closest pct_from_strike to pct_target (with nearest DTE)
    short_sel = dynamic_helper.select_option_contracts_batch(
        options_data,
        req[["trade_filter_id", "ticker", "date", "pct_target", "days_till_expiration_target"]],
        option_type="C",
        target_kind="pct",
        price_col=price_col,
    )
    if short_sel.empty:
        return _empty()

    # 2) long legs target premium = short call premium / 2
    long_req = short_sel.reset_index()[["trade_filter_id", "ticker", "date", price_col]].copy()
    long_req = long_req.rename(columns={price_col: "short_px"})
    long_req["price_target"] = long_req["short_px"] / 2.0
    long_req["days_till_expiration_target"] = int(days_till_expiration_target)

    # Restrict the long-leg universes to OTM options when pct_from_strike is available:
    # - Calls: pct_from_strike < 0  => strike > spot
    # - Puts:  pct_from_strike < 0  => strike < spot
    calls_univ = options_data
    puts_univ = options_data
    if ("option_type" in options_data.columns) and ("pct_from_strike" in options_data.columns):
        pct = pd.to_numeric(options_data["pct_from_strike"], errors="coerce")
        calls_univ = options_data[(options_data["option_type"] == "C") & (pct < 0)]
        puts_univ = options_data[(options_data["option_type"] == "P") & (pct < 0)]

    # 3) long call (OTM): closest price to half-premium (with nearest DTE)
    long_call_sel = dynamic_helper.select_option_contracts_batch(
        calls_univ,
        long_req[["trade_filter_id", "ticker", "date", "price_target", "days_till_expiration_target"]],
        option_type="C",
        target_kind="price",
        price_col=price_col,
        exclude_ids=short_sel["id"],
    )
    if long_call_sel.empty:
        return _empty()

    # 4) long put (OTM): closest price to half-premium (with nearest DTE)
    long_put_sel = dynamic_helper.select_option_contracts_batch(
        puts_univ,
        long_req[["trade_filter_id", "ticker", "date", "price_target", "days_till_expiration_target"]],
        option_type="P",
        target_kind="price",
        price_col=price_col,
    )
    if long_put_sel.empty:
        return _empty()

    # Keep only trades where we have ALL 3 legs
    valid_tids = (
        short_sel.index
        .intersection(long_call_sel.index)
        .intersection(long_put_sel.index)
    )
    if len(valid_tids) == 0:
        return _empty()

    short_sel = short_sel.loc[valid_tids]
    long_call_sel = long_call_sel.loc[valid_tids]
    long_put_sel = long_put_sel.loc[valid_tids]

    # Optional sanity checks (safe, and catches “weird” combos)

    # 1) Ensure total long spend <= short premium (so it's actually financed by the short call)
    if (price_col in short_sel.columns) and (price_col in long_call_sel.columns) and (price_col in long_put_sel.columns):
        s_px = pd.to_numeric(short_sel[price_col], errors="coerce")
        lc_px = pd.to_numeric(long_call_sel[price_col], errors="coerce")
        lp_px = pd.to_numeric(long_put_sel[price_col], errors="coerce")

        bad = (lc_px + lp_px) > s_px
        bad = bad.fillna(False)
        if bad.any():
            bad_tids = bad[bad].index
            short_sel = short_sel.drop(bad_tids)
            long_call_sel = long_call_sel.drop(bad_tids)
            long_put_sel = long_put_sel.drop(bad_tids)

    # 2) Ensure long call strike is ABOVE spot and long put strike is BELOW spot (when strike is available).
    # We can infer spot from the short call if strike + pct_from_strike are present:
    # pct_from_strike = (spot - strike) / strike  => spot = strike * (1 + pct_from_strike)
    if ("strike" in short_sel.columns) and ("pct_from_strike" in short_sel.columns):
        sK = pd.to_numeric(short_sel["strike"], errors="coerce")
        spct = pd.to_numeric(short_sel["pct_from_strike"], errors="coerce")
        spot = sK * (1.0 + spct)

        if "strike" in long_call_sel.columns:
            lcK = pd.to_numeric(long_call_sel["strike"], errors="coerce")
            ok = lcK > spot
            bad = spot.notna() & lcK.notna() & (~ok)
            if bad.any():
                bad_tids = bad[bad].index
                short_sel = short_sel.drop(bad_tids)
                long_call_sel = long_call_sel.drop(bad_tids)
                long_put_sel = long_put_sel.drop(bad_tids)

        if "strike" in long_put_sel.columns:
            lpK = pd.to_numeric(long_put_sel["strike"], errors="coerce")
            ok = lpK < spot
            bad = spot.notna() & lpK.notna() & (~ok)
            if bad.any():
                bad_tids = bad[bad].index
                short_sel = short_sel.drop(bad_tids)
                long_call_sel = long_call_sel.drop(bad_tids)
                long_put_sel = long_put_sel.drop(bad_tids)

    if short_sel.empty or long_call_sel.empty or long_put_sel.empty:
        return _empty()

    # Assemble positions (3 rows per trade)
    short_pos = short_sel.reset_index()[["trade_filter_id", "ticker", "date", "id"]].copy()
    short_pos["quantity"] = -1
    short_pos["direction"] = "S"

    long_call_pos = long_call_sel.reset_index()[["trade_filter_id", "ticker", "date", "id"]].copy()
    long_call_pos["quantity"] = +1
    long_call_pos["direction"] = "L"

    long_put_pos = long_put_sel.reset_index()[["trade_filter_id", "ticker", "date", "id"]].copy()
    long_put_pos["quantity"] = +1
    long_put_pos["direction"] = "L"

    positions = pd.concat([short_pos, long_call_pos, long_put_pos], ignore_index=True)
    positions = positions.set_index(["id", "date", "trade_filter_id"]).sort_index()

    return positions[["ticker", "quantity", "direction"]]


# Attach to your existing dynamic_helper class (optional convenience)
dynamic_helper.find_long_call_ids = find_long_call_ids
dynamic_helper.find_long_put_ids = find_long_put_ids
dynamic_helper.find_bull_call_debit_spread_ids = find_bull_call_debit_spread_ids
dynamic_helper.find_bear_put_debit_spread_ids = find_bear_put_debit_spread_ids
dynamic_helper.find_bull_put_credit_spread_ids = find_bull_put_credit_spread_ids
dynamic_helper.find_bear_call_credit_spread_ids = find_bear_call_credit_spread_ids
dynamic_helper.find_bull_put_credit_spread_plus_tail_put_ids = find_bull_put_credit_spread_plus_tail_put_ids
dynamic_helper.find_bear_put_debit_spread_plus_tail_put_ids = find_bear_put_debit_spread_plus_tail_put_ids
dynamic_helper.find_long_straddle_ids = find_long_straddle_ids
dynamic_helper.find_iron_condor_ids = find_iron_condor_ids
dynamic_helper.find_jade_lizard_ids = find_jade_lizard_ids
dynamic_helper.find_call_backspread_ids = find_call_backspread_ids
dynamic_helper.find_call_calendar_ids = find_call_calendar_ids
dynamic_helper.find_backspread_ids = find_backspread_ids
dynamic_helper.find_call_split_strangle_ids = find_call_split_strangle_ids


__all__ = [
    "find_long_call_ids",
    "find_long_put_ids",
    "find_bull_call_debit_spread_ids",
    "find_bear_put_debit_spread_ids",
    "find_bull_put_credit_spread_ids",
    "find_bear_call_credit_spread_ids",
    "find_bull_put_credit_spread_plus_tail_put_ids",
    "find_bear_put_debit_spread_plus_tail_put_ids",
    "find_long_straddle_ids",
    "find_iron_condor_ids",
    "find_jade_lizard_ids",
    "find_call_backspread_ids",
    "find_call_calendar_ids",
    "find_backspread_ids",
    "find_call_split_strangle_ids"
]
