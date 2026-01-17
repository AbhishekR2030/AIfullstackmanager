
import os
import requests
from datetime import datetime

# You can toggle this to True to use a hardcoded mock for testing without API keys
MOCK_MODE = False

class HDFCEngine:
    def __init__(self):
        self.base_url = "https://developer.hdfcsec.com/oapi/v1"
        self.api_key = os.getenv("HDFC_API_KEY")
        self.api_secret = os.getenv("HDFC_API_SECRET")
        self.access_token = os.getenv("HDFC_ACCESS_TOKEN") # Optional: can be manually set, or generated
        
        if not self.api_key or not self.api_secret:
             print("Warning: HDFC_API_KEY or HDFC_API_SECRET not set.")

    def get_login_url(self, redirect_uri=None):
        """
        Returns the URL to redirect the user to for HDFC login.
        """
        if not self.api_key:
             return None
        
        # NOTE: HDFC API typically requires:
        # 1. GET /login?api_key=... -> returns token_id (sometimes step 1 is skipped if we just need login page)
        # But most often, we redirect user to:
        # https://allinone.hdfcsec.com/login?api_key=...&redirect_url=...
        
        # Based on search results:
        # Step 1: Get token_id
        # Step 2: Validate (Password) - This is for building a custom client.
        # But for OAUTH (Web App), we typically redirect to an Auth URL.
        
        # Since exact OAuth URL varies, we will try the standard pattern or the one found.
        # If we are building a "User-facing" app, the user logs in on HDFC Portal.
        
        # Let's assume the standard `https://developer.hdfcsec.com/oapi/v1/login` or similar is for API usage.
        # But for a user to "Authorize" our app, we usually need:
        # https://<hdfc-auth-domain>/authorize?client_id=...&redirect_uri=...
        
        # Given the documentation is specific about "Indivudal API", let's use the flow:
        # We redirect to our own frontend page which might ask for username/password if HDFC doesn't support standard OAuth redirect?
        # NO, HDFC Must support standard OAuth redirect if they ask for `redirect_url` in app creation.
        
        # Let's try constructing the standard URL.
        # User confirmed that only the frontend URL was accepted in the portal.
        target_uri = redirect_uri or "https://alphaseeker.vercel.app"
        
        # URL Encoded redirect_uri
        import urllib.parse
        encoded_redirect = urllib.parse.quote(target_uri)
        
        # Construct the login URL
        # Assumption: A login page that accepts api_key and redirect_url
        login_url = f"https://developer.hdfcsec.com/oapi/v1/login?api_key={self.api_key}&redirect_url={encoded_redirect}"
        return login_url

    def exchange_token(self, request_token):
        """
        Exchanges the request_token (received after login) for an access_token.
        """
        if not self.api_key or not self.api_secret:
             print("HDFC Exchange Error: Missing credentials")
             return {"error": "Missing credentials"}
             
        url = f"{self.base_url}/access-token"
        headers = {
             "Content-Type": "application/json"
        }
        
        # HDFC typically expects specific body or form params
        # Providing api_key in query and secret in body/params
        # CRITICAL FIX: Ensure keys match HDFC spec exactly.
        # Some docs suggest 'apiSecret' in body.
        
        params = { "api_key": self.api_key, "request_token": request_token }
        body = { "apiSecret": self.api_secret }
        
        print(f"Exchanging Token. URL: {url}, Params: {params}") # Debug Log
        
        try:
             # Try sending secret in body (common for some providers)
             # Also try passing redirect_url if strictly required, though usually needed for code grant
             
             response = requests.post(url, params=params, json=body, headers=headers)
             
             print(f"HDFC Token Response: {response.status_code} - {response.text}") # Debug Log

             if response.status_code != 200:
                  return {"error": f"HDFC API Error: {response.status_code} {response.text}"}

             data = response.json()
             
             data = response.json()
             
             # FIX: Handle camelCase 'accessToken' from HDFC
             token = data.get("access_token") or data.get("accessToken")
             
             if not token and "data" in data and isinstance(data["data"], dict):
                  # Handle nested response if applicable
                  token = data["data"].get("access_token") or data["data"].get("accessToken")

             if token:
                  self.access_token = token
                  # Ideally save this to DB/Session so it persists across requests (for simple app, in-memory is fragile but okay for immediate sync)
                  print(f"Token Exchange Success. Token Length: {len(self.access_token)}")
                  return {"success": True, "access_token": self.access_token}
             else:
                  return {"error": f"Token exchange failed. No access_token in response: {data}"}
                  
        except Exception as e:
             print(f"HDFC Exchange Exception: {e}")
             return {"error": str(e)}

    def fetch_holdings(self):
        """
        Fetches holdings from HDFC InvestRight API.
        Returns a list of dicts:
        [
            {
                "ticker": "RELIANCE.NS",
                "buy_date": "2023-01-01",
                "buy_price": 2400.0,
                "quantity": 10,
                "source": "HDFC"
            },
            ...
        ]
        """
        if MOCK_MODE:
            return self._get_mock_holdings()

        if not self.api_key or not self.access_token:
            return {"error": "HDFC API credentials not configured in environment."}

        try:
            url = f"{self.base_url}/portfolio/holdings"
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "x-api-key": self.api_key, # Usually required in header or query param
                "Accept": "application/json"
            }
            # Some APIs require api_key in query param
            params = {
                "api_key": self.api_key
            }

            response = requests.get(url, headers=headers, params=params, timeout=10)
            
            # Allow 200 and 201 as success
            if response.status_code not in [200, 201]:
                print(f"HDFC API Error: {response.status_code} - {response.text}")
                return {"error": f"Failed to fetch holdings: {response.status_code}"}

            data = response.json()
            
            # DEBUG: Log the raw response to understand available fields
            print("="*60)
            print("HDFC RAW API RESPONSE:")
            print("="*60)
            import json as json_module
            print(json_module.dumps(data, indent=2)[:2000])  # First 2000 chars
            if isinstance(data.get("data"), list) and len(data["data"]) > 0:
                print("\nFIRST ITEM ALL KEYS:")
                print(list(data["data"][0].keys()))
            print("="*60)
            
            # Parse data
            # Structure observed in logs:
            # { "status": "success", "data": [ { "security_id": "TARSONSEQ", "isin": "...", ... } ] }
            
            holdings = []
            aggregated_holdings = {}
            portfolio_list = data.get("data", [])
            
            # If the response structure is different (e.g. root list), adapt here
            if isinstance(data, list):
                portfolio_list = data

            # Robust ISIN Map for Indian Stocks/ETFs (User specific + Common)
            # This bridges the gap when HDFC returns only ISINs or internal codes.
            # Robust ISIN Map for Indian Stocks/ETFs (User specific + Common)
            # This bridges the gap when HDFC returns only ISINs or internal codes.
            ISIN_MAP = {
                "INE030A01027": "HINDUNILVR.NS",
                "INF204KC1402": "SILVERBEES.NS",
                "INF204KB1715": "GOLDBEES.NS",
                "INF204KB17I5": "GOLDBEES.NS",
                "INE0LXG01040": "OLAELEC.NS",
                "INE00H001014": "SWIGGY.NS",
                "INE483C01032": "TANLA.NS",
                "INE144Z01023": "TARSONS.NS",
                "INE670A01012": "TATAELXSI.NS",
                "INE251B01027": "ZENTEC.NS",
                "INE263A01024": "BEL.NS",      # Bharat Electronics
                "INE002A01018": "RELIANCE.NS",
                "INE467B01029": "TCS.NS",
                "INE009A01021": "INFY.NS",
                "INE090A01021": "ICICIBANK.NS",
                "INE062A01020": "SBIN.NS",
                "INE040A01034": "HDFCBANK.NS",
            }

            for item in portfolio_list:
                # Debug: print("HDFC Raw Item:", item) 

                # 1. Extract Key Identifier: ISIN
                isin = item.get("isin", "").strip()
                
                # 2. Extract Company Name (Try multiple keys)
                sec_name = (
                    item.get("company_name") or 
                    item.get("sec_nm") or 
                    item.get("symbol_name") or 
                    item.get("scrip_name") or 
                    "Unknown Asset"
                )

                # --- MUTUAL FUND / LIQUID FUND FILTERING ---
                # Heuristic: If name contains "Fund", "Plan", "Option", "Liquid" AND it's not a known ETF like BeES
                is_mf = False
                name_lower = sec_name.lower()
                
                keywords = ["fund", "plan", "option", "liquid"]
                if any(x in name_lower for x in keywords):
                    # Exception: ETF names might have 'Fund' sometimes (e.g. Gold ETF Fund)
                    # We keep it ONLY if it's in our approved ISIN_MAP or has 'bees' or strictly 'etf' (though some MFs use ETF in name too)
                    # User specifically wants Silver/Gold Bees. 
                    if isin in ISIN_MAP: 
                         is_mf = False # It's in our safe list
                    elif "bees" in name_lower:
                         is_mf = False # Safe (Gold/Silver Bees)
                    else:
                         is_mf = True # Filter out generic funds/liquid funds
                
                if is_mf:
                    continue

                # 3. Determine Ticker
                ticker = ""
                
                # Priority A: Known ISIN Map (Most Reliable for this user)
                if isin in ISIN_MAP:
                    ticker = ISIN_MAP[isin]
                
                # Priority B: Standard Symbol in Response
                elif item.get("trading_symbol") or item.get("nse_sym"):
                    raw_sym = item.get("trading_symbol") or item.get("nse_sym")
                    ticker = f"{raw_sym.upper().replace('-EQ', '').replace('EQ', '')}.NS"
                    
                # Priority C: Fallback
                else:
                    if not ticker:
                         # Skip if strictly unmapped and looks like an internal Mutual Fund ID?
                         # For safety, let's map to ISIN so it at least shows up, but user might delete it.
                         ticker = f"ISIN-{isin}"

                # 4. Filter Mutual Funds? 
                # Yahoo Finance rarely supports lookup by ISIN directly.
                # If ticker is still "ISIN-...", it won't get a price. 
                # The user wants to hide these "Zero Price" assets if they are MFs.
                # Heuristic: MFs often don't have a 'trading_symbol' in HDFC api.
                # If ticker starts with ISIN- and user said ignore MFs, let's skip?
                # Let's trust the Map for now to fix the specific issue.

                # Quantity & Price logic
                try:
                    qty = float(item.get("dp_qty", 0)) 
                    if qty == 0: qty = float(item.get("quantity", 0))
                except: qty = 0

                try:
                    price = float(item.get("cost_price", 0.0))
                    if price == 0: price = float(item.get("average_price", 0.0))
                except: price = 0.0

                if qty < 0.01: continue
                
                # Try multiple fields for buy date
                buy_date = None
                for date_field in ['purchase_date', 'buy_date', 'date', 'trade_date', 'settlement_date']:
                    if item.get(date_field):
                        buy_date = item.get(date_field)
                        break
                
                # If still no date, use a reasonable default (90 days ago)
                # This ensures age calculation works and portfolio history can be constructed
                if not buy_date:
                    from datetime import timedelta
                    buy_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
                    print(f"No date found for {ticker}, using default 90 days ago")


                # Aggregation
                if ticker in aggregated_holdings:
                    existing = aggregated_holdings[ticker]
                    # Update weighted avg
                    total_qty = existing["quantity"] + qty
                    total_cost = (existing["quantity"] * existing["buy_price"]) + (qty * price)
                    existing["quantity"] = total_qty
                    existing["buy_price"] = total_cost / total_qty
                else:
                    aggregated_holdings[ticker] = {
                        "ticker": ticker,
                        "company_name": sec_name,
                        "quantity": qty,
                        "buy_price": price,
                        "buy_date": buy_date,
                        "source": "HDFC"
                    }
            
            # Convert aggregated dict back to list
            final_holdings = []
            for t, data in aggregated_holdings.items():
                data["quantity"] = int(data["quantity"])
                if data["quantity"] > 0: # Double check
                    final_holdings.append(data)
            
            # --- STEP 2: Enrich with Trade Book data for accurate purchase dates ---
            trade_dates = self._fetch_tradebook_dates()
            if trade_dates:
                for holding in final_holdings:
                    ticker = holding.get("ticker", "")
                    isin = holding.get("isin", "")
                    
                    # Try to match by ticker or ISIN
                    matched_date = None
                    ticker_base = ticker.replace(".NS", "").replace(".BO", "")
                    
                    if ticker_base in trade_dates:
                        matched_date = trade_dates[ticker_base]
                    elif isin in trade_dates:
                        matched_date = trade_dates[isin]
                    
                    if matched_date:
                        holding["buy_date"] = matched_date
                        print(f"Matched trade date for {ticker}: {matched_date}")
                
            return final_holdings

        except Exception as e:
            print(f"HDFC Engine Exception: {e}")
            import traceback
            traceback.print_exc()
            return {"error": str(e)}

    def _fetch_tradebook_dates(self):
        """
        Fetches trade book from HDFC API to get actual purchase dates.
        Returns a dict mapping security_id/isin to the earliest fill_timestamp.
        """
        import sys
        
        print("[TRADE_BOOK] Starting fetch_tradebook_dates...", flush=True)
        
        if not self.api_key or not self.access_token:
            print("[TRADE_BOOK] Skipping - no credentials", flush=True)
            return {}
        
        try:
            url = f"{self.base_url}/trades"
            print(f"[TRADE_BOOK] Calling URL: {url}", flush=True)
            
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "x-api-key": self.api_key,
                "Accept": "application/json"
            }
            
            # Add date range to get historical trades (last 2 years)
            from datetime import timedelta
            today = datetime.now()
            from_date = (today - timedelta(days=730)).strftime("%Y-%m-%d")  # 2 years ago
            to_date = today.strftime("%Y-%m-%d")
            
            params = {
                "api_key": self.api_key,
                "from_date": from_date,
                "to_date": to_date,
                "segment": "EQ"  # Equity segment
            }
            print(f"[TRADE_BOOK] Params: from_date={from_date}, to_date={to_date}", flush=True)
            
            response = requests.get(url, headers=headers, params=params, timeout=15)
            print(f"[TRADE_BOOK] Response status: {response.status_code}", flush=True)
            
            if response.status_code != 200:
                print(f"[TRADE_BOOK] API Error: {response.status_code} - {response.text[:500]}", flush=True)
                return {}
            
            data = response.json()
            
            # DEBUG: Log trade book response
            print("="*60, flush=True)
            print("[TRADE_BOOK] HDFC TRADE BOOK RESPONSE:", flush=True)
            print("="*60, flush=True)
            import json as json_module
            print(json_module.dumps(data, indent=2)[:2000], flush=True)
            
            if isinstance(data.get("data"), list) and len(data["data"]) > 0:
                print(f"\n[TRADE_BOOK] Found {len(data['data'])} trades", flush=True)
                print("[TRADE_BOOK] FIRST ITEM KEYS:", flush=True)
                print(list(data["data"][0].keys()), flush=True)
                print("[TRADE_BOOK] FIRST ITEM VALUES:", flush=True)
                print(data["data"][0], flush=True)
            else:
                print("[TRADE_BOOK] No trades found in response", flush=True)
            print("="*60, flush=True)
            sys.stdout.flush()
            
            trades_list = data.get("data", [])
            if isinstance(data, list):
                trades_list = data
            
            # Build a map of security -> earliest trade date
            trade_dates = {}
            
            for trade in trades_list:
                # Try multiple possible security identifier fields
                security_id = (
                    trade.get("security_id") or 
                    trade.get("trading_symbol") or 
                    trade.get("symbol") or 
                    trade.get("scrip_nm") or
                    ""
                ).strip().upper().replace("-EQ", "")
                
                isin = trade.get("isin", "").strip()
                
                # Get timestamp - try multiple fields
                timestamp = (
                    trade.get("fill_timestamp") or 
                    trade.get("order_timestamp") or 
                    trade.get("trade_date") or
                    trade.get("fill_date") or
                    ""
                )
                
                if not timestamp:
                    continue
                
                # Parse timestamp to date string (YYYY-MM-DD)
                date_str = None
                try:
                    # Handle different timestamp formats
                    if "T" in timestamp:
                        # ISO format: 2023-05-15T10:30:00
                        date_str = timestamp.split("T")[0]
                    elif " " in timestamp:
                        # Date time format: 2023-05-15 10:30:00
                        date_str = timestamp.split(" ")[0]
                    else:
                        # Assume it's already a date
                        date_str = timestamp
                except:
                    continue
                
                if not date_str:
                    continue
                
                # Store the EARLIEST date for each security
                if security_id and security_id not in trade_dates:
                    trade_dates[security_id] = date_str
                elif security_id and date_str < trade_dates.get(security_id, "9999-99-99"):
                    trade_dates[security_id] = date_str
                
                if isin and isin not in trade_dates:
                    trade_dates[isin] = date_str
                elif isin and date_str < trade_dates.get(isin, "9999-99-99"):
                    trade_dates[isin] = date_str
            
            print(f"Trade Book: Found dates for {len(trade_dates)} securities")
            return trade_dates
            
        except Exception as e:
            print(f"Trade Book Exception: {e}")
            import traceback
            traceback.print_exc()
            return {}

    def _get_mock_holdings(self):
        """Returns mock data for testing with realistic historical dates."""
        from datetime import timedelta
        today = datetime.now()
        
        return [
            {
                "ticker": "TCS.NS",
                "company_name": "Tata Consultancy Services",
                "quantity": 10,
                "buy_price": 3500.0,
                "buy_date": (today - timedelta(days=180)).strftime("%Y-%m-%d"),
                "source": "HDFC"
            },
            {
                "ticker": "INFY.NS",
                "company_name": "Infosys Limited",
                "quantity": 25,
                "buy_price": 1450.0,
                "buy_date": (today - timedelta(days=120)).strftime("%Y-%m-%d"),
                "source": "HDFC"
            },
            {
                "ticker": "RELIANCE.NS",
                "company_name": "Reliance Industries",
                "quantity": 5,
                "buy_price": 2600.0,
                "buy_date": (today - timedelta(days=90)).strftime("%Y-%m-%d"),
                "source": "HDFC"
            },
            {
                "ticker": "HDFCBANK.NS",
                "company_name": "HDFC Bank",
                "quantity": 15,
                "buy_price": 1580.0,
                "buy_date": (today - timedelta(days=60)).strftime("%Y-%m-%d"),
                "source": "HDFC"
            }
        ]

