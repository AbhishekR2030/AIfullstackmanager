
import yfinance as yf
import pandas as pd
import pandas_ta as ta
import numpy as np
from app.engines.market_loader import market_loader
from concurrent.futures import ThreadPoolExecutor
import requests
import json
import os

import time

class MarketScanner:
    def __init__(self):
        self.loader = market_loader
        self.cache = None
        self.last_scan_time = 0
        self.CACHE_DURATION = 900 # 15 Minutes

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
            
            return {
                "total_score": round(total_score, 2),
                "upside_pct": round(upside_pct * 100, 1),
                "momentum_score": round(mom_score, 1)
            }
            
        except:
            return {
                "total_score": 50.0,
                "upside_pct": 0.0,
                "momentum_score": 50.0
            }

    def get_info_threaded(self, ticker):
        try:
            return ticker, yf.Ticker(ticker).info
        except:
            return ticker, {}


    def _fetch_yahoo_fundamentals(self, ticker, region="IN"):
        """
        Fetches fundamental data using Yahoo Finance (FREE).
        Much more reliable for Indian stocks than FMP.
        """
        try:
            from app.engines.yahoo_fundamentals_engine import yahoo_fundamentals
            return yahoo_fundamentals.get_fundamentals(ticker)
        except ImportError:
            print("[Scanner] Yahoo Fundamentals Engine not available, using fallback", flush=True)
            return {}
        except Exception as e:
            print(f"[Scanner] Yahoo Finance Error for {ticker}: {e}", flush=True)
            return {}
    
    # Keep Perplexity as fallback (renamed)
    def _fetch_perplexity_fundamentals_legacy(self, ticker, region="IN"):
        """
        Legacy: Fetches fundamental data using Perplexity API.
        Kept as fallback if FMP fails.
        """
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
            "model": "sonar",
            "messages": [
                {"role": "system", "content": "You are a financial data assistant. Return ONLY JSON. No markdown formatting."},
                {"role": "user", "content": prompt}
            ]
        }
        
        try:
            response = requests.post("https://api.perplexity.ai/chat/completions", json=payload, headers=headers, timeout=30)
            if response.status_code == 200:
                content = response.json()['choices'][0]['message']['content']
                content = content.replace("```json", "").replace("```", "").strip()
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    print(f"Perplexity JSON Error for {ticker}: {content[:50]}...")
                    return {}
            else:
                print(f"Perplexity Error {response.status_code}: {response.text}")
                return {}
        except Exception as e:
            print(f"Perplexity Exception for {ticker}: {e}")
            return {}


    def scan_market(self, region="IN", thresholds=None):
        """
        Main scanning method with user-configurable thresholds.
        
        Args:
            region: "IN" for India, "US" for US markets
            thresholds: Dict with 'technical' and 'fundamental' sub-dicts
        """
        # Default thresholds if not provided
        if thresholds is None:
            thresholds = {}
        
        tech = thresholds.get('technical', {})
        fund = thresholds.get('fundamental', {})
        
        # Technical Defaults
        rsi_min = tech.get('rsi_min', 50)
        rsi_max = tech.get('rsi_max', 70)
        vol_min = tech.get('volatility_min', 3)
        vol_max = tech.get('volatility_max', 8)
        vol_shock_min = tech.get('volume_shock_min', 1.5)
        
        # Fundamental Defaults (in decimal, e.g., 0.10 for 10%)
        rev_growth_min = fund.get('revenue_growth_min', 10) / 100
        rev_growth_max = fund.get('revenue_growth_max', 100) / 100
        profit_growth_min = fund.get('profit_growth_min', 10) / 100
        profit_growth_max = fund.get('profit_growth_max', 100) / 100
        roe_min = fund.get('roe_min', 12) / 100
        roe_max = fund.get('roe_max', 100) / 100
        roce_min = fund.get('roce_min', 12) / 100
        roce_max = fund.get('roce_max', 100) / 100
        de_min = fund.get('debt_equity_min', 0)
        de_max = fund.get('debt_equity_max', 100)
        
        # 1. Cache Check (skip cache if custom thresholds provided)
        if not thresholds and self.cache and (time.time() - self.last_scan_time < self.CACHE_DURATION):
            print("Returning Cached Scan Results (Speed Optimized)")
            return self.cache

        print(f"Starting Scan ({region}) with thresholds: RSI={rsi_min}-{rsi_max}, Vol={vol_min}-{vol_max}%...")
        
        try:
            tickers = self.loader.get_india_tickers() if region == "IN" else self.loader.get_us_tickers()
            
            # 2. Batch Fetch History (Technicals via Yahoo - Reliable)
            data = self.loader.fetch_data(tickers, period="3mo")
            if data is None or data.empty: 
                if self.cache: return self.cache
                return []

            # 3. Tech Screen 
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
                    
                    # Volatility (use thresholds)
                    monthly_vol = df['Close'].pct_change().tail(30).std() * np.sqrt(21) * 100
                    if monthly_vol > vol_max or monthly_vol < vol_min: continue
    
                    # Momentum
                    sma_50 = df['Close'].rolling(50).mean().iloc[-1]
                    sma_20 = df['Close'].rolling(20).mean().iloc[-1]
                    if current_price <= sma_50 or current_price <= sma_20: continue
                    
                    # RSI (use thresholds)
                    rsi = ta.rsi(df['Close'], length=14).iloc[-1]
                    if not (rsi_min <= rsi <= rsi_max): continue
                    
                    # Volume Shock (use threshold)
                    current_vol = df['Volume'].iloc[-1]
                    if current_vol <= (vol_shock_min * avg_vol_20): continue
                    
                    macd = ta.macd(df['Close'])
                    hist = macd['MACDh_12_26_9'].iloc[-1]
                    if hist <= 0: continue
                    
                    tech_pass_candidates.append({
                        "ticker": ticker,
                        "df": df, 
                        "price": float(current_price),
                        "tech_score": float(rsi),
                        "rsi": float(rsi),
                        "vol_shock": float(current_vol/avg_vol_20)
                    })
                 except: continue
    
            # 4. Select Top 5 for Fundamental Analysis
            tech_pass_candidates.sort(key=lambda x: x.get('vol_shock', 0), reverse=True)
            top_candidates = tech_pass_candidates[:5]
            
            if not top_candidates: 
                 if self.cache: return self.cache
                 return []
            
            # 5. Fetch Fundamentals via Yahoo Finance (FREE - no API key needed)
            print("=" * 50, flush=True)
            print("[DEPLOY v2.0] Fetching fundamentals via YAHOO FINANCE (not FMP!)", flush=True)
            print("=" * 50, flush=True)
            final_list = []
            
            # Helper to fetch and process single candidate
            def fetch_and_process(cand):
                ticker = cand.get('ticker', 'UNKNOWN')
                print(f"Analyzing Fundamentals: {ticker}")
                
                # Fetch Data from Yahoo Finance (primary)
                p_data = self._fetch_yahoo_fundamentals(ticker, region)
                if not p_data or p_data.get("source") != "YahooFinance":
                    # Fallback to Perplexity if Yahoo fails
                    p_data = self._fetch_perplexity_fundamentals_legacy(ticker, region)
                
                # Helper: Safe Float
                def safe_float(val, default=0.0):
                    try: 
                        if val is None: return default
                        return float(val)
                    except: return default
    
                # Graceful Fallback Logic
                default_growth = 0.20 if not p_data else 0.0
                default_roe = 0.20 if not p_data else 0.0
                
                # Construct Info Object for Scoring
                # FIXED: use correct field names from yahoo_fundamentals_engine
                rev_growth = safe_float(p_data.get('revenue_growth_yoy'), default_growth)
                roe = safe_float(p_data.get('return_on_equity'), default_roe)
                roce = safe_float(p_data.get('return_on_capital_employed'), default_roe)  # FIXED field name
                profit_growth = safe_float(p_data.get('profit_growth_yoy'), default_growth)  # FIXED field name
                dte = safe_float(p_data.get('debt_to_equity'), 50)  # Already in percentage for Indian stocks
                
                info_proxy = {
                    'quoteType': 'EQUITY', 
                    'revenueGrowth': rev_growth,
                    'profitGrowth': profit_growth,
                    'returnOnEquity': roe,
                    'roce': roce,
                    'debtToEquity': dte,
                    'sector': p_data.get('sector', 'Unknown'),
                    'beta': safe_float(p_data.get('beta'), 1.0),
                    'targetMeanPrice': cand.get('price', 0) * 1.2 
                }
                
                # Log actual vs threshold for debugging
                print(f"[FUND] {ticker}: RevGrowth={rev_growth:.2%} (threshold: {rev_growth_min:.0%}-{rev_growth_max:.0%})", flush=True)
                print(f"[FUND] {ticker}: ROE={roe:.2%} (threshold: {roe_min:.0%}-{roe_max:.0%})", flush=True)
                print(f"[FUND] {ticker}: ROCE={roce:.2%} (threshold: {roce_min:.0%}-{roce_max:.0%})", flush=True)
                print(f"[FUND] {ticker}: ProfitGrowth={profit_growth:.2%} (threshold: {profit_growth_min:.0%}-{profit_growth_max:.0%})", flush=True)
                print(f"[FUND] {ticker}: D/E={dte:.1f} (threshold: {de_min}-{de_max})", flush=True)
                
                # Fundamental Check Logic (using user thresholds)
                passed = True
                failed_checks = []
                
                if not (rev_growth_min <= info_proxy['revenueGrowth'] <= rev_growth_max):
                    passed = False; failed_checks.append(f"RevGrowth: {info_proxy['revenueGrowth']:.1%}")
                if not (roe_min <= info_proxy['returnOnEquity'] <= roe_max):
                    passed = False; failed_checks.append(f"ROE: {info_proxy['returnOnEquity']:.1%}")
                if not (roce_min <= info_proxy.get('roce', 0) <= roce_max):
                    passed = False; failed_checks.append(f"ROCE: {info_proxy.get('roce', 0):.1%}")
                if not (profit_growth_min <= info_proxy.get('profitGrowth', 0) <= profit_growth_max):
                    passed = False; failed_checks.append(f"ProfitGrowth: {info_proxy.get('profitGrowth', 0):.1%}")
                if not (de_min <= info_proxy['debtToEquity'] <= de_max): 
                    passed = False; failed_checks.append(f"D/E: {info_proxy['debtToEquity']:.1f}")
                
                if passed:
                    print(f"[FUND] PASS {ticker}: All fundamentals in range!", flush=True)
                    thesis = fundamental_thesis
                else:
                    print(f"[FUND] PARTIAL {ticker}: Failed checks: {', '.join(failed_checks)}", flush=True)
                    thesis = f"Technical play - failed: {', '.join(failed_checks)}"
    
                score_data = self._calculate_upside_score(cand.get('df'), info_proxy, region)
                
                # Build fundamental thesis summary
                fund_thesis_parts = []
                if info_proxy['revenueGrowth'] > 0.15:
                    fund_thesis_parts.append(f"Strong revenue growth ({info_proxy['revenueGrowth']*100:.1f}%)")
                elif info_proxy['revenueGrowth'] > 0:
                    fund_thesis_parts.append(f"Positive revenue growth ({info_proxy['revenueGrowth']*100:.1f}%)")
                    
                if info_proxy['returnOnEquity'] > 0.15:
                    fund_thesis_parts.append(f"High ROE ({info_proxy['returnOnEquity']*100:.1f}%)")
                    
                if info_proxy.get('roce', 0) > 0.15:
                    fund_thesis_parts.append(f"Strong ROCE ({info_proxy.get('roce', 0)*100:.1f}%)")
                    
                if info_proxy.get('profitGrowth', 0) > 0.10:
                    fund_thesis_parts.append(f"Profit growth ({info_proxy.get('profitGrowth', 0)*100:.1f}%)")
                    
                if info_proxy['debtToEquity'] < 50:
                    fund_thesis_parts.append("Low debt")
                elif info_proxy['debtToEquity'] < 100:
                    fund_thesis_parts.append("Manageable debt")
                
                if passed:
                    fundamental_thesis = ". ".join(fund_thesis_parts) if fund_thesis_parts else "Meets fundamental criteria"
                else:
                    fundamental_thesis = f"Fundamentals outside thresholds: {', '.join(failed_checks)}"
                
                # ALWAYS return stock with fundamentals (whether passed or not)
                return {
                    "ticker": ticker,
                    "price": round(cand.get('price', 0), 2),
                    "score": score_data.get('total_score', 50) if passed else 60,  # Lower score if failed
                    "upside_potential": score_data.get('upside_pct', 0),
                    "momentum_score": score_data.get('momentum_score', 50),
                    "rsi": round(cand.get('rsi', 50), 2),
                    "vol_shock": round(cand.get('vol_shock', 1), 2),
                    "sector": info_proxy.get('sector', 'Unknown'),
                    "beta": info_proxy.get('beta', 1.0),
                    "fundamental_thesis": fundamental_thesis,
                    "fundamentals_passed": passed,
                    "fundamentals": {
                        "revenue_growth": round(info_proxy['revenueGrowth'] * 100, 1),
                        "roe": round(info_proxy['returnOnEquity'] * 100, 1),
                        "roce": round(info_proxy.get('roce', 0) * 100, 1),
                        "profit_growth": round(info_proxy.get('profitGrowth', 0) * 100, 1),
                        "debt_equity": round(info_proxy['debtToEquity'], 1)
                    }
                }
    
            # Run Parallel
            with ThreadPoolExecutor(max_workers=5) as executor:
                results = executor.map(fetch_and_process, top_candidates)
            
            for res in results:
                if res: final_list.append(res)
                    
            # Note: No fallback needed now since we always return stocks with data
            if not final_list and top_candidates:
                 print("No candidates processed. Check for errors.", flush=True)
    
            # 6. Final Sort & Cache
            final_list.sort(key=lambda x: x.get('score', 0), reverse=True)
            
            # Update Cache (only if default thresholds)
            if not thresholds:
                self.cache = final_list
                self.last_scan_time = time.time()
            
            return final_list
            
        except Exception as e:
            print(f"Scanner Critical Failure: {e}")
            import traceback
            traceback.print_exc()
            if self.cache:
                print("Returning Stale Cache due to Failure")
                return self.cache
            return []

scanner = MarketScanner()

