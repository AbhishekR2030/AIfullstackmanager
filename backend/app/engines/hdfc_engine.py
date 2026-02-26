import os
import requests
from datetime import datetime
import urllib.parse
from sqlalchemy import Column, DateTime, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# You can toggle this to True to use a hardcoded mock for testing without API keys
MOCK_MODE = False


def _resolve_database_url():
    url = os.getenv("DATABASE_URL", "sqlite:///./users.db")
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


HDFC_SQLALCHEMY_DATABASE_URL = _resolve_database_url()
HDFC_TOKEN_ENGINE = create_engine(
    HDFC_SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in HDFC_SQLALCHEMY_DATABASE_URL else {}
)
HDFC_TOKEN_SESSION = sessionmaker(autocommit=False, autoflush=False, bind=HDFC_TOKEN_ENGINE)
HDFC_TOKEN_BASE = declarative_base()


class HDFCAccessToken(HDFC_TOKEN_BASE):
    __tablename__ = "hdfc_access_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


HDFC_TOKEN_BASE.metadata.create_all(bind=HDFC_TOKEN_ENGINE)

class HDFCEngine:
    def __init__(self):
        self.base_url = "https://developer.hdfcsec.com/oapi/v1"
        # NOTE: We read env vars lazily (in methods) instead of here,
        # because this class is instantiated at module import time
        # which may be before load_dotenv() runs.
        self.access_token = None

    def _get_api_key(self):
        return os.getenv("HDFC_API_KEY")

    def _get_api_secret(self):
        return os.getenv("HDFC_API_SECRET")

    def _persist_access_token(self, token):
        if not token:
            return

        db = HDFC_TOKEN_SESSION()
        try:
            latest = db.query(HDFCAccessToken).order_by(HDFCAccessToken.id.desc()).first()
            if latest:
                latest.token = token
                latest.created_at = datetime.utcnow()
            else:
                db.add(HDFCAccessToken(token=token))
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"HDFC token persist error: {e}")
        finally:
            db.close()

    def _load_access_token(self):
        db = HDFC_TOKEN_SESSION()
        try:
            latest = db.query(HDFCAccessToken).order_by(HDFCAccessToken.id.desc()).first()
            return latest.token if latest and latest.token else None
        except Exception as e:
            print(f"HDFC token load error: {e}")
            return None
        finally:
            db.close()

    def _set_access_token(self, token):
        self.access_token = token
        self._persist_access_token(token)

    def _get_effective_access_token(self):
        if self.access_token:
            return self.access_token

        persisted = self._load_access_token()
        if persisted:
            self.access_token = persisted
            return persisted
        return None

    def get_login_url(self, redirect_uri=None):
        """
        Returns the URL to redirect the user to for HDFC login.
        """
        if MOCK_MODE:
            return "https://google.com" 

        api_key = self._get_api_key()
        if not api_key:
             return None

        default_redirect = os.getenv("HDFC_DEFAULT_REDIRECT_URI", "https://alphaseeker.vercel.app")
        target_uri = redirect_uri or default_redirect

        # For custom-scheme app redirects, route through backend callback first.
        # This avoids broker restrictions where only HTTPS redirect URLs are allowed.
        is_custom_scheme = bool(target_uri and "://" in target_uri and not target_uri.startswith(("http://", "https://")))
        backend_public_url = os.getenv("BACKEND_PUBLIC_URL", "").strip()
        if is_custom_scheme and backend_public_url:
            callback_url = f"{backend_public_url.rstrip('/')}/api/v1/auth/callback"
            encoded_app_redirect = urllib.parse.quote(target_uri, safe="")
            target_uri = f"{callback_url}?app_redirect={encoded_app_redirect}"

        encoded_redirect = urllib.parse.quote(target_uri, safe="")

        # Some HDFC environments expect redirect_url while others use redirect_uri.
        # Send both to maximize compatibility.
        login_url = (
            "https://developer.hdfcsec.com/oapi/v1/login"
            f"?api_key={api_key}"
            f"&redirect_url={encoded_redirect}"
            f"&redirect_uri={encoded_redirect}"
        )
        return login_url

    def exchange_token(self, request_token):
        """
        Exchanges the request_token (received after login) for an access_token.
        """
        if MOCK_MODE:
            self._set_access_token("mock_hdfc_token_123")
            return {"success": True, "access_token": self.access_token}

        api_key = self._get_api_key()
        api_secret = self._get_api_secret()
        if not api_key or not api_secret:
             print("HDFC Exchange Error: Missing credentials")
             return {"error": "Missing credentials"}
             
        url = f"{self.base_url}/access-token"
        headers = {
             "Content-Type": "application/json"
        }
        
        params = { "api_key": api_key, "request_token": request_token }
        body = { "apiSecret": api_secret }
        
        print(f"Exchanging Token. URL: {url}, Params: {params}") # Debug Log
        
        try:
             # Try sending secret in body (common for some providers)
             # Also try passing redirect_url if strictly required, though usually needed for code grant
             
             response = requests.post(url, params=params, json=body, headers=headers)
             
             print(f"HDFC Token Response: {response.status_code} - {response.text}") # Debug Log

             if response.status_code != 200:
                  return {"error": f"HDFC API Error: {response.status_code} {response.text}"}

             data = response.json()
             
             # FIX: Handle camelCase 'accessToken' from HDFC
             token = data.get("access_token") or data.get("accessToken")
             
             if not token and "data" in data and isinstance(data["data"], dict):
                  # Handle nested response if applicable
                  token = data["data"].get("access_token") or data["data"].get("accessToken")

             if token:
                  self._set_access_token(token)
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

        api_key = self._get_api_key()
        token = self._get_effective_access_token()
        if not api_key:
            return {"error": "HDFC API key is not configured on backend."}
        if not token:
            return {"error": "HDFC authorization missing or expired. Please login to HDFC again."}

        try:
            url = f"{self.base_url}/portfolio/holdings"
            headers = {
                "Authorization": f"Bearer {token}",
                "x-api-key": api_key,
                "Accept": "application/json"
            }
            params = {
                "api_key": api_key
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
        
        api_key = self._get_api_key()
        token = self._get_effective_access_token()
        if not api_key or not token:
            print("[TRADE_BOOK] Skipping - no credentials", flush=True)
            return {}
        
        try:
            url = f"{self.base_url}/trades"
            print(f"[TRADE_BOOK] Calling URL: {url}", flush=True)
            
            headers = {
                "Authorization": f"Bearer {token}",
                "x-api-key": api_key,
                "Accept": "application/json"
            }
            
            from datetime import timedelta
            today = datetime.now()
            from_date = (today - timedelta(days=730)).strftime("%Y-%m-%d")
            to_date = today.strftime("%Y-%m-%d")
            
            params = {
                "api_key": api_key,
                "from_date": from_date,
                "to_date": to_date,
                "segment": "EQ"
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
