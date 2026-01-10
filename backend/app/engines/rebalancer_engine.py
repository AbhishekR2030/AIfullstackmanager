
from datetime import datetime
import pandas as pd
import pandas_ta as ta
import yfinance as yf
import numpy as np

class RebalancerEngine:
    def _calculate_upside_score(self, df, info):
        """
        Calculates Upside Score (0-100) matching Screener logic.
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
            quote_type = info.get('quoteType', 'EQUITY')
            if quote_type == 'ETF':
                fund_score = 70 
            else:
                rev_g = info.get('revenueGrowth', 0) or 0
                roe = info.get('returnOnEquity', 0) or 0
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
            return round(total_score, 2)
        except:
            return 50.0

    def analyze_portfolio(self, portfolio, new_candidates=None):
        """
        Analyzes portfolio assets.
        Args:
            portfolio: list of dicts {ticker, buy_date, ...}
            new_candidates: list of best new opportunities from Scanner
        """
        if not portfolio:
            return []

        analyzed_assets = []
        tickers = [p['ticker'] for p in portfolio]
        
        # Batch Fetch History
        try:
            data = yf.download(tickers, period="6mo", group_by='ticker', progress=False)
        except:
            data = None

        today = datetime.now()
        
        # Get Best New Candidate Score
        best_new_score = 0
        if new_candidates:
            # Assumes new_candidates is sorted desc by score
            best_new_score = new_candidates[0].get('score', 0)

        for asset in portfolio:
            ticker = asset['ticker']
            buy_date_str = asset['buy_date']
            buy_date = datetime.strptime(buy_date_str, "%Y-%m-%d")
            
            # --- Step B: Time Lock ---
            days_held = (today - buy_date).days
            status = "LOCKED" if days_held < 31 else "UNLOCKED"
            
            recommendation = "HOLD"
            reason = ""
            score = 0
            
            # default values
            trend = "Unknown"
            
            try:
                # Need Info for Scoring (Expensive but necessary for 'Step D')
                # In prod, cache this or pass it in.
                t_obj = yf.Ticker(ticker)
                info = t_obj.info
                
                # Check if data exists for this ticker
                if len(tickers) > 1:
                    if ticker not in data.columns.levels[0]:
                        raise ValueError(f"No data for {ticker}")
                    df = data[ticker].dropna()
                else:
                    df = data.dropna()

                if df is not None and not df.empty and len(df) > 50:
                    current_price = df['Close'].iloc[-1]
                    sma_20 = df['Close'].rolling(20).mean().iloc[-1]
                    
                    # Determine Trend
                    trend = "Bullish" if current_price > sma_20 else "Bearish"

                    # Calculate Stats
                    score = self._calculate_upside_score(df, info)
                    pl_pct = asset.get('pl_percent', 0)
                    
                    if status == "LOCKED":
                        recommendation = "HOLD (Compliance)"
                        reason = f"Held {days_held} days (<31)"
                    else:
                        # --- Step C: Weakest Link ---
                        is_sell_candidate = False
                        sell_reasons = []
                        
                        # 1. Profit Target > 10%
                        if pl_pct > 10:
                            is_sell_candidate = True
                            sell_reasons.append(f"Profit {pl_pct:.1f}% > 10%")
                            
                        # 2. Trend Breakdown (< 20 SMA)
                        if current_price < sma_20:
                            is_sell_candidate = True
                            sell_reasons.append("Price < 20 SMA")
                            
                        if is_sell_candidate:
                            recommendation = "SELL_CANDIDATE"
                            reason = ", ".join(sell_reasons)
                            
                        # --- Step D: Swap Decision ---
                        # Rule: IF New > Old * 1.2
                        if best_new_score > (score * 1.20):
                            recommendation = "SWAP_ADVICE"
                            reason = f"Upgrade: New Score {best_new_score} >> Old {score}"

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
