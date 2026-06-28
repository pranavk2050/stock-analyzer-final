"""FastAPI backend for live NSE stock data via jugaad-data."""

import time
from datetime import date, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Stock Analyzer Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory cache with TTL
# ---------------------------------------------------------------------------

CACHE_TTL = 15 * 60  # 15 minutes
_cache: dict[str, tuple[float, any]] = {}


def cache_get(key: str):
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < CACHE_TTL:
        return entry[1]
    return None


def cache_set(key: str, value):
    _cache[key] = (time.time(), value)


# ---------------------------------------------------------------------------
# GET /api/health
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# GET /api/stocks — list of NSE equity symbols
# ---------------------------------------------------------------------------

FALLBACK_SYMBOLS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
    "SBIN", "BHARTIARTL", "KOTAKBANK", "ITC", "LT", "AXISBANK",
    "BAJFINANCE", "ASIANPAINT", "MARUTI", "SUNPHARMA", "TITAN",
    "ULTRACEMCO", "NESTLEIND", "WIPRO", "HCLTECH", "POWERGRID",
    "NTPC", "TATAMOTORS", "TATASTEEL", "ONGC", "JSWSTEEL",
    "ADANIENT", "ADANIPORTS", "COALINDIA", "BAJAJFINSV", "TECHM",
    "DRREDDY", "BRITANNIA", "CIPLA", "EICHERMOT", "DIVISLAB",
    "APOLLOHOSP", "HEROMOTOCO", "GRASIM", "M&M", "INDUSINDBK",
    "BPCL", "TATACONSUM", "HINDALCO", "UPL", "SBILIFE",
    "HDFCLIFE", "DABUR", "PIDILITIND",
]


@app.get("/api/stocks")
def list_stocks():
    cached = cache_get("stocks")
    if cached:
        return cached

    try:
        from jugaad_data.nse import NSELive
        nse = NSELive()
        data = nse.equities()
        symbols = sorted(set(
            str(row.get("symbol", "")).strip()
            for row in (data if isinstance(data, list) else [])
            if str(row.get("symbol", "")).strip()
        ))
        if symbols:
            result = {"symbols": symbols}
            cache_set("stocks", result)
            return result
    except Exception:
        pass
    result = {"symbols": sorted(FALLBACK_SYMBOLS)}
    cache_set("stocks", result)
    return result


# ---------------------------------------------------------------------------
# GET /api/history/{symbol}?period=5y — OHLCV history
# ---------------------------------------------------------------------------

PERIOD_MAP = {
    "1y": 365,
    "2y": 730,
    "3y": 1095,
    "5y": 1825,
    "10y": 3650,
}


@app.get("/api/history/{symbol}")
def stock_history(symbol: str, period: str = "5y"):
    # Strip .NS / .NSE suffix that the frontend may pass
    clean = symbol.strip().upper().replace(".NS", "").replace(".NSE", "")
    if not clean:
        raise HTTPException(status_code=400, detail="Empty symbol")

    cache_key = f"history:{clean}:{period}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    days = PERIOD_MAP.get(period, 1825)
    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    try:
        from jugaad_data.nse import stock_df
        df = stock_df(
            symbol=clean,
            from_date=start_date,
            to_date=end_date,
            series="EQ",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch data from NSE for {clean}: {exc}",
        )

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data returned for {clean}")

    # Normalize column names for consistent access
    df.columns = [c.strip().upper() for c in df.columns]

    col_map = {
        "date": ["DATE", "TIMESTAMP", "DATE1", "TRADDT"],
        "open": ["OPEN", "OPEN_PRICE", "OPENPRIC"],
        "high": ["HIGH", "HIGH_PRICE", "HGHPRIC"],
        "low": ["LOW", "LOW_PRICE", "LWPRIC"],
        "close": ["CLOSE", "CLOSE_PRICE", "CLSPRIC"],
        "volume": ["VOLUME", "TTL_TRD_QNTY", "TOTTRDQTY", "TTLTRADGVOL", "NO OF TRADES"],
    }

    def find_col(candidates):
        for c in candidates:
            if c in df.columns:
                return c
        return None

    date_col = find_col(col_map["date"])
    open_col = find_col(col_map["open"])
    high_col = find_col(col_map["high"])
    low_col = find_col(col_map["low"])
    close_col = find_col(col_map["close"])
    volume_col = find_col(col_map["volume"])

    if not all([date_col, open_col, high_col, low_col, close_col]):
        raise HTTPException(
            status_code=502,
            detail=f"Unexpected DataFrame columns: {list(df.columns)}",
        )

    import pandas as pd

    records = []
    seen_dates = set()
    for _, row in df.iterrows():
        raw_date = row[date_col]
        if isinstance(raw_date, (pd.Timestamp, date)):
            d = raw_date.strftime("%Y-%m-%d") if hasattr(raw_date, "strftime") else str(raw_date)
        else:
            d = str(raw_date).strip()[:10]
        if d in seen_dates:
            continue
        seen_dates.add(d)

        try:
            records.append({
                "date": d,
                "open": float(row[open_col]),
                "high": float(row[high_col]),
                "low": float(row[low_col]),
                "close": float(row[close_col]),
                "volume": int(float(row[volume_col])) if volume_col else 0,
            })
        except (ValueError, TypeError):
            continue

    records.sort(key=lambda r: r["date"])

    if len(records) < 30:
        raise HTTPException(
            status_code=404,
            detail=f"Not enough data for {clean}. Got {len(records)} points (min 30).",
        )

    result = {"symbol": clean, "period": period, "count": len(records), "data": records}
    cache_set(cache_key, result)
    return result
