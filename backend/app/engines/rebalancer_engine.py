
from datetime import datetime
import pandas as pd
import pandas_ta as ta
import yfinance as yf
import numpy as np

class RebalancerEngine:
    def _calculate_upside_score(self, df, info):
        """
        Calculates Upside Score (0-100) matching Screener logic.
        Returns a dictionary with score components.
        """
        try:
            # --- 1. Momentum Score (30%) ---
            rsi = ta.rsi(df['Close'], length=14).iloc[-1]
            macd = ta.macd(df['Close'])
            macd_hist = macd['MACDh_12_26_9'].iloc[-1]
            
            rsi_score = np.clip((rsi - 50) * 5, 0, 100)
            macd_score = 100 if macd_hist > 0 else 0
            mom_score = (rsi_score * 0.7) + (macd_score * 0.3)
            
            # --- 2. Fundamental Score (40%) ---
            # Lightweight approximation for rebalancer to avoid Perplexity cost/latency per asset
            # Rebalancer mainly focuses on Technicals for exits, but needs a proxy score.
            fund_score = 50 # Neutral default if info missing
            rev_g = info.get('revenueGrowth', 0) or 0
            roe = info.get('returnOnEquity', 0) or 0
            if rev_g or roe:
                rev_score = np.clip(rev_g * 500, 0, 100)
                roe_score = np.clip(roe * 400, 0, 100)
                fund_score = (rev_score * 0.5) + (roe_score * 0.5)

            # --- 3. Valuation/Upside Score (30%) ---
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
                "mom_score": round(mom_score, 1)
            }
        except:
             return {
                "total_score": 50.0,
                "upside_pct": 0.0,
                "mom_score": 50.0
            }

    def analyze_portfolio(self, portfolio, new_candidates=None):
        if not portfolio: return []

        analyzed_assets = []
        tickers = [p['ticker'] for p in portfolio]
        
        # Batch Fetch History
        try:
            # period=6mo is faster and enough for RSI/Trend
            data = yf.download(tickers, period="6mo", group_by='ticker', progress=False)
        except:
            data = None

        today = datetime.now()
        
        # Get Best New Candidate Score
        best_new_score = 0
        if new_candidates:
            best_new_score = new_candidates[0].get('score', 0)

        for asset in portfolio:
            ticker = asset['ticker']
            buy_date_str = asset['buy_date']
            
            # Robust Date Parsing
            try:
                # Handle YYYY-MM-DD (Standard)
                buy_date = datetime.strptime(buy_date_str, "%Y-%m-%d")
            except ValueError:
                try:
                    # Handle DD-MM-YYYY (HDFC sometimes)
                    buy_date = datetime.strptime(buy_date_str, "%d-%m-%Y")
                except:
                    # Fallback to older date to avoid "locked" status if date is totally unknown
                    # Warning: This unlocks everything if date is bad.
                    buy_date = today - timedelta(days=366) 

            
            # --- Step B: Time Lock ---
            days_held = (today - buy_date).days
            # Logic Update: If HDFC sync failed to get date, we default to today in HDFC engine.
            # If days_held is 0, user sees "Hold (Compliance)".
            # Heuristic: If buy_date is today but source is HDFC, it might be an archival/sync artifact.
            # But we must respect the 30-day rule strictly for real trades.
            status = "LOCKED" if days_held < 7 else "UNLOCKED" # Reduced from 31 to 7 for testing/usability? 
            # Or keep it 31 but ensure display reasoning is clear. 
            # Let's keep 31 but make it clear.
            status = "LOCKED" if days_held < 31 else "UNLOCKED"

            recommendation = "HOLD"
            reason = ""
            score_data = {"total_score": 0, "upside_pct": 0, "mom_score": 0}
            trend = "Unknown"
            
            try:
                # Need Info for Scoring (Expensive but necessary for 'Step D')
                # Optimisation: Use cached info or skip if unneeded.
                # For now, we continue to use yf.Ticker
                t_obj = yf.Ticker(ticker)
                # Fallback empty dict if info fetch fails to prevent crash
                try: info = t_obj.info
                except: info = {}
                
                # Check if data exists for this ticker
                df = None
                if data is not None and not data.empty:
                    if len(tickers) > 1:
                        if ticker in data.columns.levels[0]:
                            df = data[ticker].dropna()
                    else:
                        df = data.dropna()
                
                # If batch failed or specific ticker missing, try individual fetch
                if df is None or df.empty:
                     df = yf.download(ticker, period="6mo", progress=False)

                if df is not None and not df.empty and len(df) > 20:
                    current_price = df['Close'].iloc[-1]
                    sma_20 = df['Close'].rolling(20).mean().iloc[-1]
                    
                    # Determine Trend
                    trend = "Bullish" if current_price > sma_20 else "Bearish"

                    # Calculate Stats
                    score_data = self._calculate_upside_score(df, info)
                    score = score_data['total_score']
                    pl_pct = asset.get('pl_percent', 0)
                    
                    if status == "LOCKED":
                        recommendation = "HOLD" # Simple HOLD, don't scare with "Compliance" unless requested
                        reason = f"Held {days_held} days (Lock period)"
                    else:
                        # --- Step C: Weakest Link ---
                        is_sell_candidate = False
                        sell_reasons = []
                        
                        # 1. Profit Target > 20% (Bumped from 10% for realistic swing)
                        if pl_pct > 20:
                            is_sell_candidate = True
                            sell_reasons.append(f"Profit {pl_pct:.1f}%")
                            
                        # 2. Trend Breakdown (< 20 SMA)
                        if current_price < sma_20:
                            is_sell_candidate = True
                            sell_reasons.append("Broken Trend (< 20 SMA)")
                            
                        if is_sell_candidate:
                            recommendation = "SELL_CANDIDATE"
                            reason = ", ".join(sell_reasons)
                            
                        # --- Step D: Swap Decision ---
                        # Rule: IF New > Old * 1.5 (High conviction swap)
                        if best_new_score > (score * 1.5):
                             # Only suggest swap if we are NOT already selling
                             if recommendation != "SELL_CANDIDATE":
                                recommendation = "SWAP_ADVICE"
                                reason = f"Upgrade Available: Score {best_new_score}"

            except Exception as e:
                # print(f"Analysis Error for {ticker}: {e}")
                reason = f"Data Error: {str(e)}"
                
            analyzed_assets.append({
                "ticker": ticker,
                "days_held": days_held,
                "status": status,
                "recommendation": recommendation,
                "reason": reason,
                "score": round(score, 1),
                "trend": trend,
                "pl_percent": asset.get('pl_percent', 0)
            })
            
        return analyzed_assets

rebalancer = RebalancerEngine()
