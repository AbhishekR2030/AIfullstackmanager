
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
             
             if "access_token" in data:
                  self.access_token = data["access_token"]
                  # Ideally save this to DB/Session
                  return {"success": True, "access_token": self.access_token}
             elif "data" in data and "access_token" in data["data"]:
                  # Handle nested response if applicable
                  self.access_token = data["data"]["access_token"]
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
            
            if response.status_code != 200:
                print(f"HDFC API Error: {response.status_code} - {response.text}")
                return {"error": f"Failed to fetch holdings: {response.status_code}"}

            data = response.json()
            # Parse data
            # Structure based on search results:
            # { "data": [ { "symbol": "...", "quantity": ..., "average_price": ... } ] }
            
            holdings = []
            portfolio_list = data.get("data", [])
            
            # If the response structure is different (e.g. root list), adapt here
            if isinstance(data, list):
                portfolio_list = data

            for item in portfolio_list:
                # Extract fields
                # We need to map 'company_name' or 'security_id' to a Ticker.
                # Ideally the API returns 'isin' or 'symbol'. 
                # Let's assume 'trading_symbol' or 'symbol' is present.
                ticker = item.get("symbol") or item.get("trading_symbol")
                
                # Cleanup Ticker: HDFC might return "RELIANCE-EQ". Yahoo needs "RELIANCE.NS"
                if ticker:
                    ticker = ticker.upper()
                    if not ticker.endswith(".NS") and not ticker.endswith(".BO"):
                        # Heuristic: Default to .NS for Indian stocks
                        ticker = f"{ticker}.NS"
                else:
                    ticker = "UNKNOWN"

                qty = int(item.get("quantity", 0))
                price = float(item.get("average_price", 0.0))
                
                # Date: API usually doesn't give specific lot dates in summary.
                # We will use today's date or a specific "imported" date.
                # Or check if 'transaction_date' exists.
                buy_date = item.get("date", datetime.now().strftime("%Y-%m-%d"))

                if qty > 0:
                    holdings.append({
                        "ticker": ticker,
                        "quantity": qty,
                        "buy_price": price,
                        "buy_date": buy_date,
                        "source": "HDFC"
                    })
            
            return holdings

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
