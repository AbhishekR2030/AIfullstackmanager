"""
Yahoo Finance Fundamentals Engine
Fetches fundamental data for Indian stocks - FREE, no API key required
"""
import yfinance as yf
from functools import lru_cache
import time

class YahooFundamentalsEngine:
    def __init__(self):
        self.cache = {}
        self.cache_ttl = 3600  # 1 hour cache
    
    def _get_ticker_data(self, symbol):
        """Get ticker info with caching"""
        now = time.time()
        
        # Check cache
        if symbol in self.cache:
            cached_data, cached_time = self.cache[symbol]
            if now - cached_time < self.cache_ttl:
                return cached_data
        
        try:
            print(f"[YF] Fetching data for {symbol}", flush=True)
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            # Also get financials for ROCE calculation
            financials = None
            balance_sheet = None
            try:
                financials = ticker.quarterly_financials
                balance_sheet = ticker.quarterly_balance_sheet
            except:
                pass
            
            data = {
                "info": info,
                "financials": financials,
                "balance_sheet": balance_sheet
            }
            
            # Cache the result
            self.cache[symbol] = (data, now)
            return data
            
        except Exception as e:
            print(f"[YF] Error fetching {symbol}: {e}", flush=True)
            return {"info": {}, "financials": None, "balance_sheet": None}
    
    def _calculate_roce(self, financials, balance_sheet):
        """
        Calculate Return on Capital Employed (ROCE)
        Formula: ROCE = EBIT / (Total Assets - Current Liabilities)
        Or: ROCE = EBIT / Capital Employed
        """
        try:
            if financials is None or balance_sheet is None:
                return None
            
            if financials.empty or balance_sheet.empty:
                return None
            
            # Get EBIT (Operating Income)
            ebit = None
            for col in ['Operating Income', 'EBIT', 'Ebit']:
                if col in financials.index:
                    ebit = financials.loc[col].iloc[0]
                    break
            
            if ebit is None:
                # Try calculating from other metrics
                if 'Total Revenue' in financials.index and 'Operating Expense' in financials.index:
                    ebit = financials.loc['Total Revenue'].iloc[0] - financials.loc['Operating Expense'].iloc[0]
            
            if ebit is None:
                return None
            
            # Get Capital Employed = Total Assets - Current Liabilities
            total_assets = None
            current_liabilities = None
            
            for col in ['Total Assets', 'TotalAssets']:
                if col in balance_sheet.index:
                    total_assets = balance_sheet.loc[col].iloc[0]
                    break
            
            for col in ['Current Liabilities', 'CurrentLiabilities', 'Total Current Liabilities']:
                if col in balance_sheet.index:
                    current_liabilities = balance_sheet.loc[col].iloc[0]
                    break
            
            if total_assets is None or current_liabilities is None:
                return None
            
            capital_employed = total_assets - current_liabilities
            
            if capital_employed <= 0:
                return None
            
            roce = ebit / capital_employed
            return roce
            
        except Exception as e:
            print(f"[YF] ROCE calculation error: {e}", flush=True)
            return None
    
    def get_fundamentals(self, symbol):
        """
        Get all fundamental data needed for screening.
        Returns a dict with standardized field names.
        """
        print(f"[YF] Getting fundamentals for {symbol}", flush=True)
        
        data = self._get_ticker_data(symbol)
        info = data.get("info", {})
        financials = data.get("financials")
        balance_sheet = data.get("balance_sheet")
        
        # Safe float helper
        def safe_float(val, default=0.0):
            try:
                if val is None:
                    return default
                return float(val)
            except:
                return default
        
        # Calculate ROCE
        roce = self._calculate_roce(financials, balance_sheet)
        
        # Map Yahoo Finance fields to our standard fields
        fundamentals = {
            # Growth metrics
            "revenue_growth_yoy": safe_float(info.get("revenueGrowth"), 0),
            "profit_growth_yoy": safe_float(info.get("earningsGrowth"), 0),
            "eps_growth": safe_float(info.get("earningsQuarterlyGrowth"), 0),
            
            # Profitability metrics
            "return_on_equity": safe_float(info.get("returnOnEquity"), 0),
            "return_on_capital_employed": safe_float(roce, 0),  # Calculated
            "return_on_assets": safe_float(info.get("returnOnAssets"), 0),
            
            # Debt metrics
            "debt_to_equity": safe_float(info.get("debtToEquity"), 0),
            "total_debt": safe_float(info.get("totalDebt"), 0),
            "current_ratio": safe_float(info.get("currentRatio"), 0),
            
            # Margin metrics
            "gross_margin": safe_float(info.get("grossMargins"), 0),
            "operating_margin": safe_float(info.get("operatingMargins"), 0),
            "net_margin": safe_float(info.get("profitMargins"), 0),
            
            # Valuation metrics
            "pe_ratio": safe_float(info.get("trailingPE"), 0),
            "forward_pe": safe_float(info.get("forwardPE"), 0),
            "price_to_book": safe_float(info.get("priceToBook"), 0),
            "price_to_sales": safe_float(info.get("priceToSalesTrailing12Months"), 0),
            
            # Additional info
            "sector": info.get("sector", "Unknown"),
            "industry": info.get("industry", "Unknown"),
            "beta": safe_float(info.get("beta"), 1.0),
            
            # Data source
            "source": "YahooFinance"
        }
        
        print(f"[YF] Fundamentals for {symbol}: "
              f"ROE={fundamentals['return_on_equity']:.2%}, "
              f"ROCE={fundamentals['return_on_capital_employed']:.2%}, "
              f"RevGrowth={fundamentals['revenue_growth_yoy']:.2%}, "
              f"D/E={fundamentals['debt_to_equity']:.2f}", flush=True)
        
        return fundamentals
    
    def generate_fundamental_thesis(self, symbol, fundamentals):
        """Generate a human-readable thesis based on fundamental data"""
        thesis_parts = []
        
        # Revenue Growth
        rev_growth = fundamentals.get("revenue_growth_yoy", 0)
        if rev_growth > 0.20:
            thesis_parts.append(f"strong revenue growth of {rev_growth:.1%}")
        elif rev_growth > 0.10:
            thesis_parts.append(f"moderate revenue growth of {rev_growth:.1%}")
        elif rev_growth > 0:
            thesis_parts.append(f"positive revenue growth of {rev_growth:.1%}")
        
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
        if de < 30:
            thesis_parts.append("low debt levels")
        elif de < 50:
            thesis_parts.append("manageable debt levels")
        
        if thesis_parts:
            ticker_clean = symbol.replace('.NS', '').replace('.BO', '')
            return f"{ticker_clean} shows " + ", ".join(thesis_parts) + "."
        else:
            return f"{symbol} has limited fundamental data available."


# Singleton instance
yahoo_fundamentals = YahooFundamentalsEngine()
