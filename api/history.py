from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import date, timedelta
import json

PERIOD_MAP = {
    "1y": 365,
    "2y": 730,
    "3y": 1095,
    "5y": 1825,
    "10y": 3650,
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        # Extract symbol from path: /api/history?symbol=RELIANCE or /api/history/RELIANCE
        symbol = params.get("symbol", [None])[0]
        if not symbol:
            # Try to extract from path segments
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 3:
                symbol = parts[2]

        if not symbol:
            self._error(400, "Missing 'symbol' parameter. Use /api/history?symbol=RELIANCE")
            return

        clean = symbol.strip().upper().replace(".NS", "").replace(".NSE", "")
        if not clean:
            self._error(400, "Empty symbol")
            return

        period = params.get("period", ["5y"])[0]
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
            self._error(502, f"Failed to fetch data from NSE for {clean}: {exc}")
            return

        if df is None or df.empty:
            self._error(404, f"No data returned for {clean}")
            return

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
            self._error(502, f"Unexpected DataFrame columns: {list(df.columns)}")
            return

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
            self._error(404, f"Not enough data for {clean}. Got {len(records)} points (min 30).")
            return

        result = {"symbol": clean, "period": period, "count": len(records), "data": records}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def _error(self, code, detail):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"detail": detail}).encode())
