from http.server import BaseHTTPRequestHandler
import json

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


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        symbols = sorted(FALLBACK_SYMBOLS)
        try:
            from jugaad_data.nse import NSELive
            nse = NSELive()
            data = nse.equities()
            live_symbols = sorted(set(
                str(row.get("symbol", "")).strip()
                for row in (data if isinstance(data, list) else [])
                if str(row.get("symbol", "")).strip()
            ))
            if live_symbols:
                symbols = live_symbols
        except Exception:
            pass

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"symbols": symbols}).encode())
