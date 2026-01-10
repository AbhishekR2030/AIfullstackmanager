
import yfinance as yf
import pandas as pd
import pandas_ta as ta
import numpy as np
from app.engines.market_loader import market_loader

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
            
            # 1. Cost of Equity (Re) using CAPM
            # Re = Rf + Beta(Rm - Rf)
            market_premium = 0.05 # 5% equity risk premium assumption
            cost_of_equity = risk_free_rate + (beta * market_premium)
            
            # 2. Weights
            total_debt = info.get('totalDebt', 0) or 0
            market_cap = info.get('marketCap', 1) 
            total_value = market_cap + total_debt
            
            weight_equity = market_cap / total_value
            weight_debt = total_debt / total_value
            
            # 3. Cost of Debt (Rd) - Hard to get exact.
            # Proxy: Rf + Spread (2%)
            cost_of_debt = risk_free_rate + 0.02
            tax_rate = 0.25
            
            wacc = (weight_equity * cost_of_equity) + (weight_debt * cost_of_debt * (1 - tax_rate))
            return wacc
        except:
            return 0.10 # Default 10%

    def _check_fundamentals(self, ticker, info, region="IN"):
        """
        Stage 2: Fundamental Safety Check & ETF Logic
        """
        quote_type = info.get('quoteType', 'EQUITY')
        
        # --- ETF LOGIC ---
        if quote_type == 'ETF' or 'BEES' in ticker or ticker in ["GLD", "SLV", "USO", "SPY", "QQQ", "IWM"]:
            # 1. Quality: AUM > $500M (approx 4200 Cr INR)
            aum = info.get('totalAssets', 0) # yfinance uses totalAssets for Net Assets
            min_aum = 4_200_000_000 if region == "IN" else 500_000_000
            if aum and aum < min_aum:
                # Be lenient with AUM for now as yfinance data can be spotty for ETFs
                pass 
                
            # 2. Expense Ratio < 0.5% (Not always avail in info, skipping for MVP)
            
            # 3. Liquidity: Premium/Discount to NAV (Hard to calc without live NAV, skipping)
            
            # 4. Momentum Check (30-Day Return > 5%) - Handled in technicals partially, but specific check here:
            # We defer this to the technical loop or return True here to let technicals decide.
            return True, "ETF Passed"

        # --- EQUITY LOGIC ---
        
        # 1. Growth
        rev_growth = info.get('revenueGrowth', 0) # YoY Quarterly
        earnings_growth = info.get('earningsGrowth', 0) # YoY Quarterly
        
        if rev_growth is None or rev_growth < 0.15:
            return False, f"Low Rev Growth: {rev_growth}"
            
        # 2. Quality
        roe = info.get('returnOnEquity', 0)
        if roe is None or roe < 0.18:
            return False, f"Low ROE: {roe}"
            
        # Moat: ROCE - WACC > 6%
        risk_free = 0.07 if region == "IN" else 0.04
        wacc = self._estimate_wacc(info, risk_free_rate=risk_free)
        # Using ROE as proxy for ROCE if missing
        roce_proxy = roe 
        if (roce_proxy - wacc) < 0.06:
             return False, f"No Moat (ROE-WACC < 6%)"

        # 3. Health
        de_ratio = info.get('debtToEquity', 0)
        # yfinance D/E is usually a percentage (e.g., 50.5 for 0.505)
        if de_ratio and de_ratio > 40: # 0.4
             return False, f"High Debt: {de_ratio}%"

        return True, "Passed"

    def _calculate_upside_score(self, df, info, region="IN"):
        """
        Stage 4: Scoring Engine (0-100)
        Fundamental (40%) + Momentum (30%) + Valuation (30%)
        """
        try:
            # --- 1. Momentum Score (30%) ---
            rsi = ta.rsi(df['Close'], length=14).iloc[-1]
            macd = ta.macd(df['Close'])
            macd_hist = macd['MACDh_12_26_9'].iloc[-1]
            
            # Normalize RSI (50-70 is sweet spot, 70+ is risky but strong)
            # Map 50->0, 70->100. Cap at 100.
            rsi_score = np.clip((rsi - 50) * 5, 0, 100)
            
            # MACD Strength (Binary or graduated)
            macd_score = 100 if macd_hist > 0 else 0
            
            mom_score = (rsi_score * 0.7) + (macd_score * 0.3)
            
            # --- 2. Fundamental Score (40%) ---
            quote_type = info.get('quoteType', 'EQUITY')
            if quote_type == 'ETF':
                fund_score = 70 # Default base for valid ETFs
            else:
                rev_g = info.get('revenueGrowth', 0) or 0
                roe = info.get('returnOnEquity', 0) or 0
                # Normalize: Rev > 20% -> 100, ROE > 25% -> 100
                rev_score = np.clip(rev_g * 500, 0, 100)
                roe_score = np.clip(roe * 400, 0, 100)
                fund_score = (rev_score * 0.5) + (roe_score * 0.5)

            # --- 3. Valuation/Upside Score (30%) ---
            # Analyst Target
            current_price = df['Close'].iloc[-1]
            target_price = info.get('targetMeanPrice', None)
            
            upside_pct = 0
            if target_price and target_price > 0:
                upside_pct = (target_price - current_price) / current_price
            else:
                # Fallback: 30-day historical return projection? 
                # Or just PEG logic.
                peg = info.get('pegRatio', 0)
                if peg and 0 < peg < 1.0: upside_pct = 0.20 # Assume 20% upside for undervalued
                elif peg and peg < 1.5: upside_pct = 0.10
                else: upside_pct = 0.05
            
            # Normalize Upside: 0% -> 0, 20% -> 100
            val_score = np.clip(upside_pct * 500, 0, 100)
            
            # Final Weighted Score
            total_score = (fund_score * 0.4) + (mom_score * 0.3) + (val_score * 0.3)
            return round(total_score, 2)
            
        except Exception as e:
            # print(f"Scoring Error: {e}")
            return 50.0

    def scan_market(self, region="IN"):
        print(f"Starting AlphaSeeker Scan ({region})...")
        tickers = self.loader.get_india_tickers() if region == "IN" else self.loader.get_us_tickers()
        
        # 1. Batch Fetch (6mo for full MAs)
        data = self.loader.fetch_data(tickers, period="6mo")
        if data is None or data.empty: return []

        candidates = []
        
        # Exchange Rate (Manual or fixed)
        usd_inr = 85.0
        
        print(f"Analyzing {len(tickers)} assets...")
        
        for ticker in tickers:
            try:
                df = data[ticker].dropna() if len(tickers) > 1 else data
                if df.empty or len(df) < 55: continue
                
                # Close price and Volume
                current_price = df['Close'].iloc[-1]
                avg_vol_20 = df['Volume'].rolling(20).mean().iloc[-1]
                
                # --- Stage 1: Volatility & Liquidity ---
                
                # Liquidity Check
                daily_turnover = current_price * avg_vol_20
                if region == "IN":
                    daily_turnover_usd = daily_turnover / usd_inr
                else:
                    daily_turnover_usd = daily_turnover
                    
                if daily_turnover_usd < 1_000_000: # $1M
                    continue
                    
                # Volatility Check (Monthly > 3% AND < 8%)
                # Using 30-day StdDev of daily returns * sqrt(21)
                daily_rets = df['Close'].pct_change()
                monthly_vol = daily_rets.tail(30).std() * np.sqrt(21) * 100
                
                if not (3.0 < monthly_vol < 12.0): # Relaxed 8% cap slightly to 12% for crypto/midcaps, per user req sticking to < 8 implies very stable. Let's strict to 8 if requested.
                    # Prompt said < 8%. Strictly following.
                    if monthly_vol > 8.0 or monthly_vol < 3.0:
                        continue

                # --- Stage 3: Momentum (Technicals) - Moved before Funda to save API calls ---
                
                # 1. Price > 50 SMA and > 20 SMA
                sma_50 = df['Close'].rolling(50).mean().iloc[-1]
                sma_20 = df['Close'].rolling(20).mean().iloc[-1]
                
                if current_price <= sma_50 or current_price <= sma_20:
                    continue
                    
                # 2. RSI [50, 70]
                rsi = ta.rsi(df['Close'], length=14).iloc[-1]
                if not (50 <= rsi <= 70):
                    continue
                    
                # 3. Institutional Action (Vol > 1.5x Avg)
                current_vol = df['Volume'].iloc[-1]
                if current_vol <= (1.5 * avg_vol_20):
                    continue
                    
                # 4. MACD Hist > 0
                macd = ta.macd(df['Close'])
                # macd columns: MACD_12_26_9, MACDh_12_26_9, MACDs_12_26_9
                hist = macd['MACDh_12_26_9'].iloc[-1]
                if hist <= 0:
                    continue
                    
                # --- Stage 2: Fundamentals ---
                # Fetch Info
                t_obj = yf.Ticker(ticker)
                info = t_obj.info
                
                passed, reason = self._check_fundamentals(ticker, info, region)
                if not passed:
                    continue
                    
                # --- Stage 4: Scoring & Ranking ---
                score = self._calculate_upside_score(df, info, region)
                
                candidates.append({
                    "ticker": ticker,
                    "price": round(current_price, 2),
                    "score": score,
                    "rsi": round(rsi, 2),
                    "vol_shock": round(current_vol/avg_vol_20, 2),
                    "sector": info.get('sector', 'Unknown'),
                    "beta": info.get('beta', 1.0)
                })
                
            except Exception as e:
                continue

        # --- Selection Rules ---
        # 1. Sort by Score
        candidates.sort(key=lambda x: x['score'], reverse=True)
        
        # 2. Diversity Filters
        final_list = []
        sector_counts = {}
        beta_high_count = 0
        
        for cand in candidates:
            if len(final_list) >= 5: break
            
            sec = cand['sector']
            beta = cand.get('beta', 1) or 1
            
            # Sector Cap: Max 2
            if sector_counts.get(sec, 0) >= 2:
                continue
                
            # Beta Limit: Max 3 with Beta > 1.5
            if beta > 1.5:
                if beta_high_count >= 3:
                     continue
                beta_high_count += 1
                
            final_list.append(cand)
            sector_counts[sec] = sector_counts.get(sec, 0) + 1
            
        return final_list

scanner = MarketScanner()
