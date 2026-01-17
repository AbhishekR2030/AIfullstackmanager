"""
Financial Modeling Prep (FMP) Engine
Fetches fundamental data for Indian stocks
"""
import os
import requests
from functools import lru_cache
import time

class FMPEngine:
    def __init__(self):
        self.api_key = os.getenv("FMP_API_KEY", "")
        self.base_url = "https://financialmodelingprep.com/stable"
        self.cache = {}
        self.cache_ttl = 3600  # 1 hour cache
    
    def _make_request(self, endpoint, symbol):
        """Make API request with caching"""
        cache_key = f"{endpoint}:{symbol}"
        now = time.time()
        
        # Check cache
        if cache_key in self.cache:
            cached_data, cached_time = self.cache[cache_key]
            if now - cached_time < self.cache_ttl:
                return cached_data
        
        if not self.api_key:
            print("[FMP] Warning: FMP_API_KEY not set", flush=True)
            return None
        
        # Convert Indian ticker format (e.g., TCS.NS -> TCS.NSE)
        fmp_symbol = symbol.replace(".NS", ".NSE").replace(".BO", ".BSE")
        
        url = f"{self.base_url}/{endpoint}"
        params = {
            "symbol": fmp_symbol,
            "apikey": self.api_key
        }
        
        try:
            print(f"[FMP] Fetching {endpoint} for {fmp_symbol}", flush=True)
            response = requests.get(url, params=params, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                # Cache the result
                self.cache[cache_key] = (data, now)
                return data
            else:
                print(f"[FMP] Error {response.status_code}: {response.text[:200]}", flush=True)
                return None
        except Exception as e:
            print(f"[FMP] Exception: {e}", flush=True)
            return None
    
    def get_key_metrics(self, symbol):
        """Get TTM key metrics (ROE, ROCE, etc.)"""
        data = self._make_request("key-metrics-ttm", symbol)
        if data and len(data) > 0:
            return data[0] if isinstance(data, list) else data
        return {}
    
    def get_financial_ratios(self, symbol):
        """Get TTM financial ratios (Debt/Equity, margins, etc.)"""
        data = self._make_request("ratios-ttm", symbol)
        if data and len(data) > 0:
            return data[0] if isinstance(data, list) else data
        return {}
    
    def get_growth_data(self, symbol):
        """Get income statement growth (Revenue growth, Profit growth)"""
        data = self._make_request("income-statement-growth", symbol)
        if data and len(data) > 0:
            return data[0] if isinstance(data, list) else data
        return {}
    
    def get_fundamentals(self, symbol):
        """
        Get all fundamental data needed for screening.
        Returns a dict with standardized field names matching current usage.
        """
        print(f"[FMP] Getting fundamentals for {symbol}", flush=True)
        
        metrics = self.get_key_metrics(symbol)
        ratios = self.get_financial_ratios(symbol)
        growth = self.get_growth_data(symbol)
        
        # Map FMP fields to our standard fields
        fundamentals = {
            # Growth metrics
            "revenue_growth_yoy": growth.get("growthRevenue", 0) or 0,
            "profit_growth_yoy": growth.get("growthNetIncome", 0) or 0,
            "eps_growth": growth.get("growthEPS", 0) or 0,
            
            # Profitability metrics
            "return_on_equity": metrics.get("returnOnEquityTTM", 0) or ratios.get("returnOnEquityTTM", 0) or 0,
            "return_on_capital_employed": metrics.get("returnOnCapitalEmployedTTM", 0) or 0,
            "return_on_assets": ratios.get("returnOnAssetsTTM", 0) or 0,
            
            # Debt metrics
            "debt_to_equity": ratios.get("debtEquityRatioTTM", 0) or 0,
            "debt_ratio": ratios.get("debtRatioTTM", 0) or 0,
            
            # Margin metrics
            "gross_margin": ratios.get("grossProfitMarginTTM", 0) or 0,
            "operating_margin": ratios.get("operatingProfitMarginTTM", 0) or 0,
            "net_margin": ratios.get("netProfitMarginTTM", 0) or 0,
            
            # Valuation metrics
            "pe_ratio": ratios.get("priceEarningsRatioTTM", 0) or 0,
            "price_to_book": ratios.get("priceToBookRatioTTM", 0) or 0,
            "price_to_sales": ratios.get("priceToSalesRatioTTM", 0) or 0,
            
            # Data source
            "source": "FMP"
        }
        
        print(f"[FMP] Fundamentals for {symbol}: ROE={fundamentals['return_on_equity']:.2%}, "
              f"ROCE={fundamentals['return_on_capital_employed']:.2%}, "
              f"RevGrowth={fundamentals['revenue_growth_yoy']:.2%}", flush=True)
        
        return fundamentals
    
    def generate_fundamental_thesis(self, symbol, fundamentals):
        """Generate a human-readable thesis based on fundamental data"""
        thesis_parts = []
        
        # Revenue Growth
        rev_growth = fundamentals.get("revenue_growth_yoy", 0)
        if rev_growth > 0.20:
            thesis_parts.append(f"Strong revenue growth of {rev_growth:.1%}")
        elif rev_growth > 0.10:
            thesis_parts.append(f"Moderate revenue growth of {rev_growth:.1%}")
        elif rev_growth > 0:
            thesis_parts.append(f"Positive revenue growth of {rev_growth:.1%}")
        
        # Profit Growth
        profit_growth = fundamentals.get("profit_growth_yoy", 0)
        if profit_growth > 0.20:
            thesis_parts.append(f"excellent profit growth of {profit_growth:.1%}")
        elif profit_growth > 0.10:
            thesis_parts.append(f"healthy profit growth of {profit_growth:.1%}")
        
        # ROE
        roe = fundamentals.get("return_on_equity", 0)
        if roe > 0.20:
            thesis_parts.append(f"high ROE of {roe:.1%}")
        elif roe > 0.15:
            thesis_parts.append(f"good ROE of {roe:.1%}")
        
        # ROCE
        roce = fundamentals.get("return_on_capital_employed", 0)
        if roce > 0.20:
            thesis_parts.append(f"strong capital efficiency (ROCE: {roce:.1%})")
        elif roce > 0.15:
            thesis_parts.append(f"decent capital efficiency (ROCE: {roce:.1%})")
        
        # Debt
        de = fundamentals.get("debt_to_equity", 0)
        if de < 0.3:
            thesis_parts.append("low debt levels")
        elif de < 0.5:
            thesis_parts.append("manageable debt levels")
        
        if thesis_parts:
            return f"{symbol.replace('.NS', '').replace('.BSE', '')} shows " + ", ".join(thesis_parts) + "."
        else:
            return f"{symbol.replace('.NS', '').replace('.BSE', '')} has limited fundamental data available."


# Singleton instance
fmp_engine = FMPEngine()
