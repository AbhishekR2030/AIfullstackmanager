
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
            # Parse data
            # Structure observed in logs:
            # { "status": "success", "data": [ { "security_id": "TARSONSEQ", "isin": "...", ... } ] }
            
            holdings = []
            aggregated_holdings = {}
            portfolio_list = data.get("data", [])
            
            # If the response structure is different (e.g. root list), adapt here
            if isinstance(data, list):
                portfolio_list = data

            for item in portfolio_list:
                # Debug: print("HDFC Raw Item:", item) 

                # Extract Key Fields
                isin = item.get("isin")
                sec_name = item.get("sec_nm", "") # e.g. "HINDUSTAN UNILEVER LTD"
                
                # Quantity & Price
                try:
                    qty = float(item.get("dp_qty", 0)) # "dp_qty" is often the holdings qty
                    if qty == 0:
                        qty = float(item.get("quantity", 0)) # Fallback
                except:
                    qty = 0

                try:
                    price = float(item.get("cost_price", 0.0))
                    if price == 0:
                         price = float(item.get("average_price", 0.0))
                except:
                    price = 0.0

                if qty < 0.01: continue

                # Ticker Mapping Logic
                # 1. Try mapping existing sym if available
                # 2. Or fallback to smart mapping from Name or ISIN
                
                ticker = ""
                
                # Known HDFC Symbol to Yahoo Map
                # HDFC often uses internal IDs or odd abbreviations (e.g. HLLLTD vs HINDUNILVR)
                manual_map = {
                    "HLLLTD": "HINDUNILVR.NS",
                    "NETFSILVER": "SILVERBEES.NS", 
                    "GOLBEE": "GOLDBEES.NS",
                    "OLAELEC": "OLAELEC.NS", # Verify if Yahoo has it, often NEW listings need time or specific code
                    "TANSOL": "TANLA.NS",
                    "TARSONSIQ": "TARSONS.NS",
                    "TATELX": "TATAELXSI.NS",
                    "ZETECH": "ZENTEC.NS",
                    "SWIGGY": "SWIGGY.NS"
                }

                # Try finding a symbol in response
                raw_sym = item.get("trading_symbol") or item.get("nse_sym") or item.get("symbol")
                
                # Clean raw symbol (remove EQ suffixes)
                if raw_sym:
                    clean_sym = raw_sym.upper().replace("-EQ", "").replace("EQ", "")
                    if clean_sym in manual_map:
                        ticker = manual_map[clean_sym]
                    else:
                        ticker = f"{clean_sym}.NS"
                else:
                    # Fallback strategies
                    # If ISIN is available, we could map, but usually raw_sym exists.
                    # As a last resort, use ISIN.   
                    if isin:
                         ticker = f"ISIN-{isin}"
                    else:
                        ticker = f"UNKNOWN-{sec_name[:5]}"

                # Final Override for known bad Yahoo mappings if raw_sym logic failed
                # (Double check the generated ticker against the map just in case)
                base_ticker = ticker.split('.')[0]
                if base_ticker in manual_map:
                     ticker = manual_map[base_ticker]

                buy_date = item.get("date", datetime.now().strftime("%Y-%m-%d"))

                # Aggregation
                if ticker in aggregated_holdings:
                    existing = aggregated_holdings[ticker]
                    total_qty = existing["quantity"] + qty
                    total_cost = (existing["quantity"] * existing["buy_price"]) + (qty * price)
                    existing["quantity"] = total_qty
                    existing["buy_price"] = total_cost / total_qty
                else:
                    aggregated_holdings[ticker] = {
                        "ticker": ticker,
                        "company_name": sec_name, # Added field
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
                
            return final_holdings

        except Exception as e:
            print(f"HDFC Engine Exception: {e}")
            return {"error": str(e)}

    def _get_mock_holdings(self):
        """Returns mock data for testing."""
        return [
            {
                "ticker": "TCS.NS",
                "quantity": 10,
                "buy_price": 3500.0,
                "buy_date": "2023-05-15",
                "source": "HDFC"
            },
            {
                "ticker": "INFY.NS",
                "quantity": 25,
                "buy_price": 1450.0,
                "buy_date": "2023-06-20",
                "source": "HDFC"
            }
        ]
