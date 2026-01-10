
import yfinance as yf
import pandas as pd
import pandas_ta as ta
import numpy as np
from app.engines.market_loader import market_loader
from concurrent.futures import ThreadPoolExecutor

class MarketScanner:
    def __init__(self):
        self.loader = market_loader

    def _estimate_wacc(self, info, risk_free_rate=0.07):
        """
        Estimates WACC for Moat Calculation.
        Formula: (Re * E/V) + (Rd * (1-t) * D/V)
        """
        try:
            beta = info.get('beta', 1.0) or 1.0
            
            # Simple CAPM
            market_premium = 0.05
            cost_of_equity = risk_free_rate + (beta * market_premium)
            
            total_debt = info.get('totalDebt', 0) or 0
            market_cap = info.get('marketCap', 1) 
            total_value = market_cap + total_debt
            if total_value == 0: return 0.1
            
            weight_equity = market_cap / total_value
            weight_debt = total_debt / total_value
            
            cost_of_debt = risk_free_rate + 0.02
            tax_rate = 0.25
            
            wacc = (weight_equity * cost_of_equity) + (weight_debt * cost_of_debt * (1 - tax_rate))
            return wacc
        except:
            return 0.10

    def _check_fundamentals(self, ticker, info, region="IN"):
        """
        Stage 2: Fundamental Safety Check & ETF Logic
        """
        quote_type = info.get('quoteType', 'EQUITY')
        
        # --- ETF LOGIC ---
        if quote_type == 'ETF' or 'BEES' in ticker or ticker in ["GLD", "SLV", "USO", "SPY", "QQQ", "IWM"]:
            aum = info.get('totalAssets', 0)
            min_aum = 4_200_000_000 if region == "IN" else 500_000_000
            if aum and aum < min_aum:
                # Lenient for MVP
                pass 
            return True, "ETF Passed"

        # --- EQUITY LOGIC ---
        rev_growth = info.get('revenueGrowth', 0) 
        if rev_growth is None or rev_growth < 0.15:
            return False, f"Low Rev Growth: {rev_growth}"
            
        roe = info.get('returnOnEquity', 0)
        if roe is None or roe < 0.18:
            return False, f"Low ROE: {roe}"
            
        risk_free = 0.07 if region == "IN" else 0.04
        wacc = self._estimate_wacc(info, risk_free_rate=risk_free)
        if (roe - wacc) < 0.06:
             return False, f"No Moat (ROE-WACC < 6%)"

        de_ratio = info.get('debtToEquity', 0)
        if de_ratio and de_ratio > 40: 
             return False, f"High Debt: {de_ratio}%"

        return True, "Passed"

    def _calculate_upside_score(self, df, info, region="IN"):
        """
        Stage 4: Scoring Engine (0-100)
        """
        try:
            rsi = ta.rsi(df['Close'], length=14).iloc[-1]
            macd = ta.macd(df['Close'])
            macd_hist = macd['MACDh_12_26_9'].iloc[-1]
            
            rsi_score = np.clip((rsi - 50) * 5, 0, 100)
            macd_score = 100 if macd_hist > 0 else 0
            mom_score = (rsi_score * 0.7) + (macd_score * 0.3)
            
            quote_type = info.get('quoteType', 'EQUITY')
            if quote_type == 'ETF':
                fund_score = 70
            else:
                rev_g = info.get('revenueGrowth', 0) or 0
                roe = info.get('returnOnEquity', 0) or 0
                rev_score = np.clip(rev_g * 500, 0, 100)
                roe_score = np.clip(roe * 400, 0, 100)
                fund_score = (rev_score * 0.5) + (roe_score * 0.5)

            current_price = df['Close'].iloc[-1]
            target_price = info.get('targetMeanPrice', None)
            
            upside_pct = 0
            if target_price and target_price > 0:
                upside_pct = (target_price - current_price) / current_price
            else:
                peg = info.get('pegRatio', 0)
                if peg and 0 < peg < 1.0: upside_pct = 0.20
                elif peg and peg < 1.5: upside_pct = 0.10
                else: upside_pct = 0.05
            
            val_score = np.clip(upside_pct * 500, 0, 100)
            total_score = (fund_score * 0.4) + (mom_score * 0.3) + (val_score * 0.3)
            return round(total_score, 2)
            
        except:
            return 50.0

    def get_info_threaded(self, ticker):
        try:
            return ticker, yf.Ticker(ticker).info
        except:
            return ticker, {}

    def _fetch_perplexity_fundamentals(self, ticker, region="IN"):
        """
        Fetches fundamental data using Perplexity API (Sonar-Pro/Reasoning).
        """
        import os
        import requests
        import json
        
        api_key = os.getenv("PERPLEXITY_API_KEY")
        if not api_key:
            print("Perplexity API Key missing. Skipping fundamentals.")
            return {}

        market_context = "National Stock Exchange of India (NSE)" if region == "IN" else "US Stock Market"
        
        prompt = f"""
        Get the latest financial data for {ticker} listed on {market_context}.
        Return a STRICT JSON object with these exact keys:
        - revenue_growth_yoy: (decimal, e.g. 0.15 for 15%)
        - return_on_equity: (decimal, e.g. 0.20 for 20%)
        - debt_to_equity: (decimal ratio)
        - sector: (string)
        - beta: (decimal)
        
        If exact recent data is unavailable, estimate from the latest annual report. 
        Evaluate 'revenue_growth_yoy' based on the last 4 quarters vs previous 4 quarters if possible.
        """
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": "sonar", # Switched to faster model to prevent timeouts
            "messages": [
                {"role": "system", "content": "You are a financial data assistant. Return ONLY JSON. No markdown formatting."},
                {"role": "user", "content": prompt}
            ]
        }
        
        try:
            # Increased timeout to 30s to handle API latency
            response = requests.post("https://api.perplexity.ai/chat/completions", json=payload, headers=headers, timeout=30)
            if response.status_code == 200:
                content = response.json()['choices'][0]['message']['content']
                content = content.replace("```json", "").replace("```", "").strip()
                return json.loads(content)
            else:
                print(f"Perplexity Error {response.status_code}: {response.text}")
                return {}
        except Exception as e:
            print(f"Perplexity Exception for {ticker}: {e}")
            return {}

    def scan_market(self, region="IN"):
        print(f"Starting Scan ({region})...")
        tickers = self.loader.get_india_tickers() if region == "IN" else self.loader.get_us_tickers()
        
        # 1. Batch Fetch History (Technicals via Yahoo - Reliable)
        data = self.loader.fetch_data(tickers, period="3mo")
        if data is None or data.empty: return []

        # 2. Tech Screen 
        tech_pass_candidates = []
        usd_inr = 85.0
        
        print(f"Tech screening {len(tickers)} assets...")
        
        for ticker in tickers:
             try:
                df = data[ticker].dropna() if len(tickers) > 1 else data
                if df.empty or len(df) < 55: continue
                
                # Technical Checks
                current_price = df['Close'].iloc[-1]
                avg_vol_20 = df['Volume'].rolling(20).mean().iloc[-1]
                
                # Liquidity
                daily_turnover = current_price * avg_vol_20
                turnover_usd = daily_turnover / usd_inr if region == "IN" else daily_turnover
                if turnover_usd < 1_000_000: continue
                
                # Volatility
                monthly_vol = df['Close'].pct_change().tail(30).std() * np.sqrt(21) * 100
                if monthly_vol > 8.0 or monthly_vol < 3.0: continue

                # Momentum
                sma_50 = df['Close'].rolling(50).mean().iloc[-1]
                sma_20 = df['Close'].rolling(20).mean().iloc[-1]
                if current_price <= sma_50 or current_price <= sma_20: continue
                
                rsi = ta.rsi(df['Close'], length=14).iloc[-1]
                if not (50 <= rsi <= 70): continue
                
                current_vol = df['Volume'].iloc[-1]
                if current_vol <= (1.5 * avg_vol_20): continue
                
                macd = ta.macd(df['Close'])
                hist = macd['MACDh_12_26_9'].iloc[-1]
                if hist <= 0: continue
                
                tech_pass_candidates.append({
                    "ticker": ticker,
                    "df": df, 
                    "price": current_price,
                    "tech_score": rsi,
                    "rsi": rsi,
                    "vol_shock": current_vol/avg_vol_20
                })
             except: continue

        # 3. Select Top 5 for Fundamental Analysis
        tech_pass_candidates.sort(key=lambda x: x['vol_shock'], reverse=True)
        top_candidates = tech_pass_candidates[:5]
        
        if not top_candidates: return []
        
        # 4. Fetch Fundamentals via Perplexity (Sequential)
        print("Fetching fundamentals via Perplexity API...")
        final_list = []
        
        for cand in top_candidates:
            ticker = cand['ticker']
            print(f"Analyzing Fundamentals: {ticker}")
            
            # Fetch Data
            p_data = self._fetch_perplexity_fundamentals(ticker, region)
            
            # Helper to safely float conversion
            def safe_float(val, default=0.0):
                try:
                    if val is None: return default
                    return float(val)
                except:
                    return default

            # Construct Info Object for Scoring
            rev_growth = safe_float(p_data.get('revenue_growth_yoy'))
            roe = safe_float(p_data.get('return_on_equity'))
            dte = safe_float(p_data.get('debt_to_equity')) * 100 # Adjust logic if needed based on source
            
            info_proxy = {
                'quoteType': 'EQUITY', 
                'revenueGrowth': rev_growth,
                'returnOnEquity': roe,
                'debtToEquity': dte,
                'sector': p_data.get('sector', 'Unknown'),
                'beta': safe_float(p_data.get('beta'), 1.0),
                'targetMeanPrice': cand['price'] * 1.2 
            }
            
            # Fundamental Check Logic
            passed = True
            reason = "Passed"
            
            # Equity Logic ( Simplified Version of _check_fundamentals )
            if info_proxy['revenueGrowth'] < 0.15:
                passed = False; reason = f"Low Growth: {info_proxy['revenueGrowth']:.2f}"
            elif info_proxy['returnOnEquity'] < 0.18:
                passed = False; reason = f"Low ROE: {info_proxy['returnOnEquity']:.2f}"
            elif info_proxy['debtToEquity'] > 40: 
                passed = False; reason = f"High Debt: {info_proxy['debtToEquity']:.2f}"
            
            if not passed:
                print(f"Fundamental Reject {ticker}: {reason}")
                continue

            score = self._calculate_upside_score(cand['df'], info_proxy, region)
            
            final_list.append({
                "ticker": ticker,
                "price": round(cand['price'], 2),
                "score": score,
                "rsi": round(cand['rsi'], 2),
                "vol_shock": round(cand['vol_shock'], 2),
                "sector": info_proxy['sector'],
                "beta": info_proxy['beta']
            })

        # 5. Final Sort
        final_list.sort(key=lambda x: x['score'], reverse=True)
        return final_list

scanner = MarketScanner()
