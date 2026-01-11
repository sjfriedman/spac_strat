import pandas as pd
import numpy as np

class dynamic_helper:

    # Get option chains given keys [(id, date)]
    def get_option_chains(keys, data):
        
        keys_df = pd.DataFrame(keys, columns=["id", "start_date"])
        options_data = data.reset_index()

        options_data = options_data.merge(
            keys_df, on="id", how="inner"
        ).query("date >= start_date").sort_values(["id", "start_date", "date"])

        day0 = options_data.groupby(["id", "start_date"], sort=False).first()[
            ["last", "mark"]
        ].rename(columns={"last": "last_day0", "mark": "mark_day0"})

        options_data = options_data.join(day0, on=["id", "start_date"])

        options_data["trade_last_pct_change"] = (
            options_data["last"] / options_data["last_day0"] - 1
        ).fillna(0)

        options_data["trade_mark_pct_change"] = (
            options_data["mark"] / options_data["mark_day0"] - 1
        ).fillna(0)

        return options_data.rename(
            columns={"last_day0": 'entry_last_price', "mark_day0": 'entry_mark_price'}
        ).set_index(["id", "start_date", "date"]).sort_index()


    def get_option_chain(id, date, data):
        return dynamic_helper.get_option_chains([(id, date)], data)
    

    # Trade Finder
    def find_trades(stock_data, in_x_days, up_x_pct, direction):

        df = stock_data[['stock_price']].reset_index().copy()
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values(["ticker", "date"], kind="mergesort")  # stable sort

        thr = up_x_pct / 100.0
        g = df.groupby("ticker", sort=False)

        start_prices = df['stock_price'].to_numpy(dtype="float64")

        # Build forward price matrix: shape (n_rows, in_x_days)
        fwd_prices = np.column_stack([
            g['stock_price'].shift(-k).to_numpy(dtype="float64")
            for k in range(1, in_x_days + 1)
        ])

        # Build forward date matrix so we can grab the hit date quickly
        fwd_dates = np.column_stack([
            g["date"].shift(-k).to_numpy()
            for k in range(1, in_x_days + 1)
        ])

        # Percent moves to each forward day
        # Guard against divide-by-zero (drop any start_price<=0)
        valid_start = start_prices > 0
        pct_moves = np.full_like(fwd_prices, np.nan, dtype="float64")
        pct_moves[valid_start, :] = (fwd_prices[valid_start, :] - start_prices[valid_start, None]) / start_prices[valid_start, None]

        # Hit condition matrix
        if direction == "U":
            hit_mat = pct_moves >= thr
        elif direction == "D":
            hit_mat = pct_moves <= -thr
        else:
            raise ValueError("direction must be 'up', 'down'")

        # Earliest hit offset (1..in_x_days) per row
        any_hit = np.any(hit_mat, axis=1)
        first_k = np.full(len(df), -1, dtype=np.int32)
        first_k[any_hit] = np.argmax(hit_mat[any_hit], axis=1) + 1

        # Pull end_price / end_date / move at earliest hit
        col_idx = first_k - 1
        end_prices = np.full(len(df), np.nan, dtype="float64")
        end_dates = np.full(len(df), np.datetime64("NaT"), dtype="datetime64[ns]")
        move = np.full(len(df), np.nan, dtype="float64")

        hit_rows = np.where(any_hit)[0]
        end_prices[hit_rows] = fwd_prices[hit_rows, col_idx[hit_rows]]
        end_dates[hit_rows] = fwd_dates[hit_rows, col_idx[hit_rows]]
        move[hit_rows] = pct_moves[hit_rows, col_idx[hit_rows]]

        # Candidate episodes (overlapping allowed at this stage)
        candidates = df.loc[any_hit, ["ticker", "date", 'stock_price']].copy()
        candidates.rename(columns={"date": "episode_start_date", 'stock_price': "start_price"}, inplace=True)
        candidates["days_to_threshold"] = first_k[any_hit].astype("int32")
        candidates["episode_end_date"] = end_dates[any_hit]
        candidates["end_price"] = end_prices[any_hit]
        candidates["move_pct"] = move[any_hit] * 100.0

        # Add position indices within each ticker to implement skip-ahead in O(#candidates) per ticker
        df["pos"] = g.cumcount().to_numpy()
        candidates["start_pos"] = df.loc[any_hit, "pos"].to_numpy()
        candidates["end_pos"] = candidates["start_pos"] + candidates["days_to_threshold"].to_numpy()

        candidates = candidates.sort_values(["ticker", "start_pos"], kind="mergesort")

        # Greedy skip-ahead per ticker: keep if start_pos >= next_allowed_pos; then next_allowed_pos = end_pos + 1
        results = []
        for _, sub in candidates.groupby("ticker", sort=False):
            sp = sub["start_pos"].to_numpy()
            ep = sub["end_pos"].to_numpy()

            keep = np.zeros(len(sub), dtype=bool)
            next_allowed = 0
            for i in range(len(sub)):
                if sp[i] >= next_allowed:
                    keep[i] = True
                    next_allowed = ep[i] + 1

            picked = sub.loc[keep, ["ticker", "episode_start_date", "episode_end_date", "start_price", "end_price", "days_to_threshold", "move_pct"]]
            results.append(picked)

        out = pd.concat(results, ignore_index=True) if results else pd.DataFrame(
            columns=["ticker", "episode_start_date", "episode_end_date", "start_price", "end_price", "days_to_threshold", "move_pct"]
        )

        return out.sort_values(["ticker", "episode_start_date"], kind="mergesort").reset_index(drop=True)

    def select_option_contracts_batch(
        options_data,
        requests,
        option_type,
        target_kind,
        price_col="last",
        exclude_ids=None,
        min_open_interest: int | None = None,
        min_volume: int | None = None,
        require_quotes: bool = False,
    ):
        """
        Select one option contract per trade_filter_id on a given (ticker, date).

        Enhancements vs original:
        - robust to NaNs in price_col / pct_from_strike (drops invalid candidates)
        - supports exclude_ids (avoid picking the same contract twice)
        - optional liquidity filters (open_interest / volume)
        - optional quote sanity (bid/ask)
        - deterministic tie-breaks
        """
        base_cols = ["ticker", "date", "id", "days_till_expiration", price_col, "pct_from_strike"]

        if options_data.empty or requests.empty:
            return pd.DataFrame(columns=base_cols).set_index(pd.Index([], name="trade_filter_id"))

        if price_col not in options_data.columns:
            raise KeyError(f"price_col '{price_col}' not in options_data.columns")

        req = requests.copy()
        req["date"] = pd.to_datetime(req["date"])

        opt = options_data.reset_index()
        opt["date"] = pd.to_datetime(opt["date"])

        tickers = req["ticker"].unique()
        dates = req["date"].unique()

        # Pull only what we need (plus optional fields if present)
        keep = ["id", "date", "ticker", "option_type", "days_till_expiration", price_col, "pct_from_strike"]
        for c in ["strike", "bid", "ask", "volume", "open_interest"]:
            if c in opt.columns:
                keep.append(c)

        opt = opt[
            (opt["option_type"] == option_type) &
            (opt["ticker"].isin(tickers)) &
            (opt["date"].isin(dates))
        ][keep]

        if opt.empty:
            return pd.DataFrame(columns=base_cols).set_index(pd.Index([], name="trade_filter_id"))

        # Join candidates to requests on (ticker, date)
        cand = opt.merge(req, on=["ticker", "date"], how="inner")
        if cand.empty:
            return pd.DataFrame(columns=base_cols).set_index(pd.Index([], name="trade_filter_id"))

        # Basic sanity filters
        cand["days_till_expiration"] = pd.to_numeric(cand["days_till_expiration"], errors="coerce")
        cand = cand[cand["days_till_expiration"].notna() & (cand["days_till_expiration"] >= 0)]

        if min_open_interest is not None and "open_interest" in cand.columns:
            cand["open_interest"] = pd.to_numeric(cand["open_interest"], errors="coerce")
            cand = cand[cand["open_interest"].notna() & (cand["open_interest"] >= min_open_interest)]

        if min_volume is not None and "volume" in cand.columns:
            cand["volume"] = pd.to_numeric(cand["volume"], errors="coerce")
            cand = cand[cand["volume"].notna() & (cand["volume"] >= min_volume)]

        if require_quotes and ("bid" in cand.columns) and ("ask" in cand.columns):
            cand["bid"] = pd.to_numeric(cand["bid"], errors="coerce")
            cand["ask"] = pd.to_numeric(cand["ask"], errors="coerce")
            cand = cand[
                cand["bid"].notna() & cand["ask"].notna() &
                (cand["bid"] >= 0) & (cand["ask"] >= 0) &
                (cand["ask"] >= cand["bid"])
            ]

        if cand.empty:
            return pd.DataFrame(columns=base_cols).set_index(pd.Index([], name="trade_filter_id"))

        # Exclusions (e.g. exclude the short id when selecting the long leg)
        if exclude_ids is not None:
            ex = exclude_ids
            if not isinstance(ex, pd.Series):
                ex = pd.Series(ex)
            ex = ex.copy()

            # Map per trade_filter_id
            cand["_exclude_id"] = cand["trade_filter_id"].map(ex)
            cand = cand[cand["_exclude_id"].isna() | (cand["id"] != cand["_exclude_id"])]
            cand = cand.drop(columns=["_exclude_id"])

            if cand.empty:
                return pd.DataFrame(columns=base_cols).set_index(pd.Index([], name="trade_filter_id"))

        # Nearest DTE filter per request
        cand["dte_dist"] = (cand["days_till_expiration"] - cand["days_till_expiration_target"]).abs()
        min_dte = cand.groupby("trade_filter_id", sort=False)["dte_dist"].transform("min")
        cand = cand[cand["dte_dist"] == min_dte]
        if cand.empty:
            return pd.DataFrame(columns=base_cols).set_index(pd.Index([], name="trade_filter_id"))

        # Target distance per request
        if target_kind == "pct":
            if "pct_target" not in cand.columns:
                raise ValueError("requests must include 'pct_target' when target_kind='pct'")
            cand["pct_from_strike"] = pd.to_numeric(cand["pct_from_strike"], errors="coerce")
            cand["dist"] = (cand["pct_from_strike"] - cand["pct_target"]).abs()

        elif target_kind == "price":
            if "price_target" not in cand.columns:
                raise ValueError("requests must include 'price_target' when target_kind='price'")
            cand[price_col] = pd.to_numeric(cand[price_col], errors="coerce")
            cand["dist"] = (cand[price_col] - cand["price_target"]).abs()

        else:
            raise ValueError("target_kind must be 'pct' or 'price'")

        cand["dist"] = pd.to_numeric(cand["dist"], errors="coerce")
        cand = cand[cand["dist"].notna() & np.isfinite(cand["dist"])]

        if cand.empty:
            return pd.DataFrame(columns=base_cols).set_index(pd.Index([], name="trade_filter_id"))

        # Deterministic tie-breaks
        # Prefer: smaller dist, then (optional) tighter spread, then higher OI/vol, then stable id ordering
        if ("bid" in cand.columns) and ("ask" in cand.columns):
            cand["spread"] = (cand["ask"] - cand["bid"]).abs()
        else:
            cand["spread"] = np.nan

        sort_cols = ["trade_filter_id", "dist", "spread"]
        ascending = [True, True, True]

        if "open_interest" in cand.columns:
            sort_cols.append("open_interest")
            ascending.append(False)
        if "volume" in cand.columns:
            sort_cols.append("volume")
            ascending.append(False)

        sort_cols.append("id")
        ascending.append(True)

        cand = cand.sort_values(sort_cols, ascending=ascending, kind="mergesort")

        best = cand.groupby("trade_filter_id", sort=False).first()

        # Return canonical columns (plus strike if available; harmless extra and useful downstream)
        out_cols = ["ticker", "date", "id", "days_till_expiration", price_col, "pct_from_strike"]
        if "strike" in best.columns:
            out_cols.append("strike")

        return best[out_cols]

    def _side_sign(direction: pd.Series) -> pd.Series:
        """
        Map direction to +1 (long) / -1 (short).
        Accepts: L, LONG, BUY => +1; S, SHORT, SELL => -1
        """
        d = direction.astype(str).str.upper().str.strip()
        long_vals = {"L", "LONG", "BUY", "B"}
        short_vals = {"S", "SHORT", "SELL", "SH"}
        out = pd.Series(np.nan, index=direction.index, dtype="float64")
        out[d.isin(long_vals)] = 1.0
        out[d.isin(short_vals)] = -1.0
        if out.isna().any():
            bad = direction[out.isna()].unique()
            raise ValueError(f"Unrecognized direction values: {bad}")
        return out.astype("int8")


    def _entry_price_col(price_col: str, df: pd.DataFrame) -> str:
        """
        Pick the entry price column that matches the chosen price_col.
        Defaults to:
        - entry_{price_col}_price if present (e.g., entry_mark_price)
        - entry_{price_col} if present
        """
        c1 = f"entry_{price_col}_price"
        c2 = f"entry_{price_col}"
        if c1 in df.columns:
            return c1
        if c2 in df.columns:
            return c2
        raise KeyError(
            f"Couldn't find entry price column for price_col='{price_col}'. "
            f"Tried '{c1}' and '{c2}'. Columns are: {list(df.columns)}"
        )

    def pnl_transaction(
        option_chains: pd.DataFrame,
        price_col: str = "mark",
        multiplier: float = 100.0,
        multiplier_col: str | None = None,
        require_prices: bool = False,
    ) -> pd.DataFrame:
        """
        Compute leg-level (per row) PnL columns.

        Conventions:
        - direction determines side: long => +1, short => -1
        - quantity is treated as a magnitude: abs(quantity)

        Enhancements:
        - supports per-row multiplier via multiplier_col (or common fallback columns)
        - optionally requires non-null entry/current prices
        """
        df = option_chains.copy()

        if price_col not in df.columns:
            raise KeyError(f"price_col '{price_col}' not in df.columns")

        entry_col = _entry_price_col(price_col, df)

        for req in ["quantity", "direction"]:
            if req not in df.columns:
                raise KeyError(f"Required column '{req}' not in df.columns")

        side = _side_sign(df["direction"]).astype("int8")

        qty_raw = pd.to_numeric(df["quantity"], errors="raise").astype("float64")
        qty_abs = qty_raw.abs()

        px = pd.to_numeric(df[price_col], errors="coerce")
        entry_px = pd.to_numeric(df[entry_col], errors="coerce")

        # Multiplier handling (optional per-leg)
        mult = None
        if multiplier_col is not None and multiplier_col in df.columns:
            mult = pd.to_numeric(df[multiplier_col], errors="coerce")
        elif "contract_multiplier" in df.columns:
            mult = pd.to_numeric(df["contract_multiplier"], errors="coerce")
        elif "option_multiplier" in df.columns:
            mult = pd.to_numeric(df["option_multiplier"], errors="coerce")

        if mult is None:
            mult = pd.Series(multiplier, index=df.index, dtype="float64")
        else:
            mult = mult.fillna(multiplier).astype("float64")

        if require_prices:
            if px.isna().any():
                raise ValueError(f"Found NaN in price_col='{price_col}'")
            if entry_px.isna().any():
                raise ValueError(f"Found NaN in entry_col='{entry_col}'")

        df["entry_price"] = entry_px
        df["price"] = px
        df["side_sign"] = side
        df["quantity_abs"] = qty_abs
        df["multiplier_used"] = mult

        # Optional integrity check:
        if (qty_raw < 0).any():
            qty_sign = np.sign(qty_raw).astype("int8")
            df["qty_direction_mismatch"] = (qty_sign != 0) & (qty_sign != side)
        else:
            df["qty_direction_mismatch"] = False

        # Signed entry cost and signed current value (both in $)
        df["leg_cost"] = side.astype("float64") * entry_px * qty_abs * mult
        df["leg_value"] = side.astype("float64") * px * qty_abs * mult

        df["pnl"] = df["leg_value"] - df["leg_cost"]

        df["entry_notional_abs"] = entry_px.abs() * qty_abs * mult
        denom = df["entry_notional_abs"].replace(0, np.nan)
        df["pnl_pct"] = df["pnl"] / denom

        return df


    def _trade_leg_snapshot(leg_reset: pd.DataFrame) -> pd.DataFrame:
        """
        Reduce a leg-level time series to one row per leg.

        Default leg identity is (trade_filter_id, id).
        If a 'leg_id' column exists, uses (trade_filter_id, leg_id) instead,
        enabling multiple lots of the same contract id inside one trade.
        """
        if "leg_id" in leg_reset.columns:
            leg_key = "leg_id"
        else:
            leg_key = "id"

        cols = [
            "entry_price",
            "entry_notional_abs",
            "leg_cost",
            "side_sign",
            "quantity_abs",
            "multiplier_used",
        ]

        for c in ["strike", "option_type", "ticker", "expiration"]:
            if c in leg_reset.columns:
                cols.append(c)

        snap = (
            leg_reset
            .groupby(["trade_filter_id", leg_key], sort=False)[cols]
            .first()
        )

        # Track when each leg actually starts (helps with staggered entries)
        if "date" in leg_reset.columns:
            starts = leg_reset.groupby(["trade_filter_id", leg_key], sort=False)["date"].min()
            snap["leg_start_date"] = pd.to_datetime(starts)

        if "strike" in snap.columns:
            snap["strike"] = pd.to_numeric(snap["strike"], errors="coerce")

        return snap


    def _max_loss_gain_from_legs(
        leg_snap: pd.DataFrame,
        trade_cost: pd.Series,
        multiplier: float,
    ) -> pd.DataFrame:
        """
        Compute theoretical max loss / max gain at expiration based on vanilla option payoff.

        Enhancement:
        - supports per-leg multiplier via leg_snap['multiplier_used'] if present
        """
        out = pd.DataFrame(index=trade_cost.index)

        if "strike" not in leg_snap.columns or "option_type" not in leg_snap.columns:
            out["max_trade_loss"] = np.nan
            out["max_trade_gain"] = np.nan
            out["unbounded_risk"] = False
            out["unbounded_gain"] = False
            return out

        results = {}

        for tid, g in leg_snap.groupby(level="trade_filter_id", sort=False):
            cost = float(trade_cost.loc[tid]) if tid in trade_cost.index else np.nan

            strikes = pd.to_numeric(g["strike"], errors="coerce").to_numpy(dtype="float64")
            opt_u = g["option_type"].astype(str).str.upper().str.strip()
            is_call = opt_u.isin(["C", "CALL"]).to_numpy()
            is_put = opt_u.isin(["P", "PUT"]).to_numpy()

            side = pd.to_numeric(g["side_sign"], errors="coerce").to_numpy(dtype="float64")
            qty = pd.to_numeric(g["quantity_abs"], errors="coerce").to_numpy(dtype="float64")

            if "multiplier_used" in g.columns:
                mult = pd.to_numeric(g["multiplier_used"], errors="coerce").to_numpy(dtype="float64")
                mult = np.where(np.isfinite(mult), mult, multiplier)
            else:
                mult = np.full(len(g), float(multiplier), dtype="float64")

            ok = np.isfinite(strikes) & np.isfinite(side) & np.isfinite(qty) & np.isfinite(mult) & (is_call | is_put)
            strikes = strikes[ok]
            side = side[ok]
            qty = qty[ok]
            mult = mult[ok]
            is_call = is_call[ok]
            is_put = is_put[ok]

            if len(strikes) == 0 or not np.isfinite(cost):
                results[tid] = (np.nan, np.nan, False, False)
                continue

            # High-S slope depends only on calls
            slope_high = (side[is_call] * qty[is_call] * mult[is_call]).sum()
            unbounded_risk = slope_high < 0
            unbounded_gain = slope_high > 0

            S_points = np.unique(np.concatenate([[0.0], np.sort(strikes)]))
            S = S_points[None, :]
            K = strikes[:, None]

            call_pay = np.maximum(S - K, 0.0)
            put_pay = np.maximum(K - S, 0.0)
            pay = call_pay * is_call[:, None] + put_pay * is_put[:, None]

            # Apply per-leg multipliers inside the sum
            portfolio_payoff = ((side * qty * mult)[:, None] * pay).sum(axis=0)
            pnl_exp = portfolio_payoff - cost

            min_pnl = float(np.min(pnl_exp))
            max_pnl = float(np.max(pnl_exp))

            max_loss = np.inf if unbounded_risk else max(0.0, -min_pnl)
            max_gain = np.inf if unbounded_gain else max(0.0, max_pnl)

            results[tid] = (max_loss, max_gain, unbounded_risk, unbounded_gain)

        out[["max_trade_loss", "max_trade_gain", "unbounded_risk", "unbounded_gain"]] = (
            pd.DataFrame.from_dict(
                results,
                orient="index",
                columns=["max_trade_loss", "max_trade_gain", "unbounded_risk", "unbounded_gain"],
            ).reindex(out.index)
        )

        return out
    
    def pnl_trade(
        option_chains: pd.DataFrame,
        price_col: str = "mark",
        stop_loss: float | None = None,
        take_profit: float | None = None,
        truncate: bool = True,
        multiplier: float = 100.0,
        multiplier_col: str | None = None,
        dynamic_cost: bool = False,
    ) -> pd.DataFrame:
        """
        Aggregate PnL to trade_filter_id level (across all legs).

        Enhancements:
        - supports per-leg multiplier (multiplier_col)
        - supports duplicate contract ids via leg_id (if provided upstream)
        - multi-ticker trades: PnL ok, but risk bounds are disabled (NaN)
        - optional dynamic_cost to handle staggered leg start dates (pct denom evolves)
        """
        df = option_chains
        if truncate and (stop_loss is not None or take_profit is not None):
            df = truncate_trades_on_stops(
                df,
                price_col=price_col,
                stop_loss=stop_loss,
                take_profit=take_profit,
                multiplier=multiplier,
            )

        leg = pnl_transaction(
            df,
            price_col=price_col,
            multiplier=multiplier,
            multiplier_col=multiplier_col,
        )
        leg_reset = leg.reset_index()
        leg_reset["date"] = pd.to_datetime(leg_reset["date"])

        # Trade pnl time series (sum across legs each date)
        trade_ts = (
            leg_reset.groupby(["trade_filter_id", "date"], sort=False)["pnl"]
            .sum()
            .to_frame("trade_pnl")
        )

        # Trade-level dates (constant per trade)
        trade_dates = (
            leg_reset.groupby("trade_filter_id", sort=False)["date"]
            .agg(["min", "max"])
            .rename(columns={"min": "trade_date", "max": "sell_date"})
        )
        tids = trade_ts.index.get_level_values("trade_filter_id")
        trade_ts["trade_date"] = tids.map(trade_dates["trade_date"])
        trade_ts["sell_date"] = tids.map(trade_dates["sell_date"])
        trade_ts["holding_days"] = (trade_ts["sell_date"] - trade_ts["trade_date"]).dt.days.astype("Int64")

        # Trade-level constants (one row per leg)
        leg_snap = _trade_leg_snapshot(leg_reset)

        # Base (constant) cost metrics
        trade_cost_const = leg_snap.groupby(level="trade_filter_id", sort=False)["leg_cost"].sum()
        trade_cost_abs_const = (
            leg_snap.groupby(level="trade_filter_id", sort=False)["entry_notional_abs"]
            .sum()
            .replace(0, np.nan)
        )

        # Optional dynamic cost/notional when legs start on different dates
        if dynamic_cost and "leg_start_date" in leg_snap.columns:
            # Per trade, cum-sum legs as they become active
            dyn_cost = {}
            dyn_abs = {}

            for tid, sub in trade_ts.groupby(level="trade_filter_id", sort=False):
                dts = sub.index.get_level_values("date").to_numpy()

                legs = leg_snap.xs(tid, level="trade_filter_id")
                starts = pd.to_datetime(legs["leg_start_date"]).to_numpy()
                order = np.argsort(starts)

                starts = starts[order]
                cost_cum = np.cumsum(legs["leg_cost"].to_numpy(dtype="float64")[order])
                abs_cum = np.cumsum(legs["entry_notional_abs"].to_numpy(dtype="float64")[order])

                idx = np.searchsorted(starts, dts, side="right")
                cost_t = np.where(idx == 0, 0.0, cost_cum[idx - 1])
                abs_t = np.where(idx == 0, np.nan, abs_cum[idx - 1])

                dyn_cost[tid] = pd.Series(cost_t, index=sub.index)
                dyn_abs[tid] = pd.Series(abs_t, index=sub.index)

            dyn_cost = pd.concat(dyn_cost.values()).sort_index()
            dyn_abs = pd.concat(dyn_abs.values()).sort_index()

            trade_ts["trade_cost"] = dyn_cost
            trade_ts["trade_cost_abs"] = dyn_abs
        else:
            trade_ts["trade_cost"] = tids.map(trade_cost_const)
            trade_ts["trade_cost_abs"] = tids.map(trade_cost_abs_const)

        trade_ts["trade_entry_notional_abs"] = trade_ts["trade_cost_abs"]
        trade_ts["trade_pnl_pct"] = trade_ts["trade_pnl"] / trade_ts["trade_entry_notional_abs"]

        trade_ts["trade_value"] = trade_ts["trade_cost"] + trade_ts["trade_pnl"]
        trade_ts["trade_pnl_pct_cost"] = trade_ts["trade_pnl"] / trade_ts["trade_cost"].abs().replace(0, np.nan)

        # Size stats (works for any number of legs)
        trade_ts["trade_n_legs"] = tids.map(leg_snap.groupby(level="trade_filter_id", sort=False).size()).astype("Int64")
        trade_ts["trade_n_contracts"] = tids.map(leg_snap.groupby(level="trade_filter_id", sort=False)["quantity_abs"].sum())

        # Multi-ticker detection (PnL is fine; risk metrics are not meaningful)
        if "ticker" in leg_reset.columns:
            n_tickers = leg_reset.groupby("trade_filter_id", sort=False)["ticker"].nunique()
        else:
            n_tickers = pd.Series(1, index=trade_cost_const.index)

        trade_ts["trade_n_tickers"] = tids.map(n_tickers).astype("Int64")
        trade_ts["multi_ticker_trade"] = trade_ts["trade_n_tickers"] > 1

        # Risk metrics (only if single ticker)
        single_ticker = n_tickers[n_tickers == 1].index
        if len(single_ticker) > 0:
            risk = _max_loss_gain_from_legs(
                leg_snap.loc[leg_snap.index.get_level_values("trade_filter_id").isin(single_ticker)],
                trade_cost=trade_cost_const.loc[single_ticker],
                multiplier=multiplier,
            )
            for c in risk.columns:
                trade_ts[c] = tids.map(risk[c])
        else:
            for c in ["max_trade_loss", "max_trade_gain", "unbounded_risk", "unbounded_gain"]:
                trade_ts[c] = np.nan

        # gain_loss_ratio = trade_pnl / max_trade_loss if trade_pnl > 0 else 0
        denom = trade_ts["max_trade_loss"].replace(0, np.nan)
        glr = np.where(trade_ts["trade_pnl"] > 0, trade_ts["trade_pnl"] / denom, 0.0)
        glr = np.where(np.isfinite(glr), glr, 0.0)
        trade_ts["gain_loss_ratio"] = glr

        # Useful extras
        trade_ts["trade_pnl_over_cost_abs"] = trade_ts["trade_pnl"] / trade_ts["trade_cost_abs"]
        trade_ts["trade_cost_pct_of_gross"] = trade_ts["trade_cost"] / trade_ts["trade_cost_abs"]

        return trade_ts.sort_index()



    def truncate_trades_on_stops(
        option_chains: pd.DataFrame,
        price_col: str = "mark",
        stop_loss: float | None = None,
        take_profit: float | None = None,
        multiplier: float = 100.0,
    ) -> pd.DataFrame:
        """
        Truncate each trade_filter_id's time series once either stop_loss or take_profit is hit.

        Thresholds are in *decimal pct* terms:
        - stop_loss=0.5 means stop out at -50% PnL
        - take_profit=1.0 means take profit at +100% PnL

        The stop/take checks are done at the *trade level* (across all legs),
        using:
        trade_pnl(date) = sum_leg pnl(date)

        trade_entry_notional_abs = sum_leg abs(entry_price * abs(qty) * multiplier)  (constant per trade)

        trade_pnl_pct(date) = trade_pnl(date) / trade_entry_notional_abs
        """
        if stop_loss is None and take_profit is None:
            return option_chains

        leg = pnl_transaction(
            option_chains,
            price_col=price_col,
            multiplier=multiplier,
        )

        if not isinstance(leg.index, pd.MultiIndex):
            raise ValueError("Expected a MultiIndex with at least trade_filter_id and date")

        idx_names = list(leg.index.names)
        if "trade_filter_id" not in idx_names or "date" not in idx_names:
            raise ValueError(f"Index must contain 'trade_filter_id' and 'date'. Got: {idx_names}")

        leg_reset = leg.reset_index()
        leg_reset["date"] = pd.to_datetime(leg_reset["date"])

        # Trade-level entry notional (constant per trade): sum across legs once (NOT across dates)
        leg_snap = _trade_leg_snapshot(leg_reset)
        trade_entry = (
            leg_snap.groupby(level="trade_filter_id", sort=False)["entry_notional_abs"]
            .sum()
            .replace(0, np.nan)
        )

        # Trade-level pnl per date
        trade_ts = (
            leg_reset.groupby(["trade_filter_id", "date"], sort=False)["pnl"]
            .sum()
            .to_frame("trade_pnl")
            .reset_index()
        )
        trade_ts["trade_entry_notional_abs"] = trade_ts["trade_filter_id"].map(trade_entry)
        trade_ts["trade_pnl_pct"] = trade_ts["trade_pnl"] / trade_ts["trade_entry_notional_abs"]

        cutoffs = {}

        for tid, g in trade_ts.groupby("trade_filter_id", sort=False):
            g = g.sort_values("date")
            pct = g["trade_pnl_pct"]

            hit_dates = []

            if stop_loss is not None:
                hit = g.loc[pct <= (-abs(stop_loss)), "date"]
                if not hit.empty:
                    hit_dates.append(hit.iloc[0])

            if take_profit is not None:
                hit = g.loc[pct >= (abs(take_profit)), "date"]
                if not hit.empty:
                    hit_dates.append(hit.iloc[0])

            if hit_dates:
                cutoffs[tid] = min(hit_dates)

        if not cutoffs:
            return option_chains

        # Filter original df using cutoffs (keep up to cutoff date inclusive per trade)
        df = option_chains.copy()
        trade_ids = df.index.get_level_values("trade_filter_id")
        dates = pd.to_datetime(df.index.get_level_values("date"))

        cutoff_series = pd.Series(cutoffs)
        cutoff_for_row = trade_ids.map(cutoff_series)  # NaT for trades with no cutoff
        keep = cutoff_for_row.isna() | (dates <= cutoff_for_row)

        return df.loc[keep]


# Module-level exports for easier imports
find_trades = dynamic_helper.find_trades
select_option_contracts_batch = dynamic_helper.select_option_contracts_batch
get_option_chains = dynamic_helper.get_option_chains
get_option_chain = dynamic_helper.get_option_chain

# Helper utilities (exported so tests/other modules can import them directly)
_side_sign = dynamic_helper._side_sign
_entry_price_col = dynamic_helper._entry_price_col
pnl_transaction = dynamic_helper.pnl_transaction
_trade_leg_snapshot = dynamic_helper._trade_leg_snapshot
_max_loss_gain_from_legs = dynamic_helper._max_loss_gain_from_legs
truncate_trades_on_stops = dynamic_helper.truncate_trades_on_stops
pnl_trade = dynamic_helper.pnl_trade


__all__ = [
    "find_trades",
    "select_option_contracts_batch",
    "get_option_chains",
    "get_option_chain",
    "_side_sign",
    "_entry_price_col",
    "pnl_transaction",
    "_trade_leg_snapshot",
    "_max_loss_gain_from_legs",
    "truncate_trades_on_stops",
    "dynamic_helper",
    "pnl_trade",
]


