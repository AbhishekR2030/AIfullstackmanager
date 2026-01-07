import requests

class SearchEngine:
    def search(self, query: str):
        """
        Searches Yahoo Finance for tickers matching the query.
        Filters for Indian stocks (NSE/BSE).
        """
        try:
            url = "https://query1.finance.yahoo.com/v1/finance/search"
            params = {
                "q": query,
                "quotesCount": 10,
                "newsCount": 0,
                "listsCount": 0,
                "enableFuzzyQuery": "false",
                "quotesQueryId": "tss_match_phrase_query"
            }
            # Yahoo often requires a User-Agent
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Referer": "https://finance.yahoo.com/"
            }
            
            response = requests.get(url, params=params, headers=headers, timeout=5)
            
            if response.status_code != 200:
                print(f"Yahoo Search failed: {response.status_code} {response.text}")
                return []

            data = response.json()
            
            matches = []
            if "quotes" in data:
                for item in data["quotes"]:
                    # Filter for Indian exchanges (NSE/BSE usually have these suffixes or exchange codes)
                    # Yahoo returns exchange like 'NSI' for NSE, 'BSE' for Bombay
                    symbol = item.get("symbol", "")
                    shortname = item.get("shortname", "")
                    exchange = item.get("exchange", "")
                    
                    is_indian =  symbol.endswith(".NS") or symbol.endswith(".BO") or exchange in ["NSI", "BSE", "NSE"]
                    
                    if is_indian:
                         matches.append({
                             "symbol": symbol,
                             "name": shortname,
                             "exchange": exchange
                         })
            
            return matches
        except Exception as e:
            print(f"Search API Error: {e}")
            return []
