from datetime import datetime
import pandas as pd
import yfinance as yf

class RebalancerEngine:
    def analyze_portfolio(self, portfolio):
        """
        Analyzes portfolio assets for locking validity and performance trend.
        """
        if not portfolio:
            return []

        analyzed_assets = []
        tickers = [p['ticker'] for p in portfolio]
        
        # Fetch data for Trend Check (20 SMA)
        try:
            data = yf.download(tickers, period="2mo", group_by='ticker', progress=False)
        except:
            data = None

        today = datetime.now()

        for asset in portfolio:
            ticker = asset['ticker']
            buy_date_str = asset['buy_date']
            buy_date = datetime.strptime(buy_date_str, "%Y-%m-%d")
            
            # 1. Calculate Age
            age_days = (today - buy_date).days
            
            # 2. Status Check
            status = "LOCKED" if age_days < 31 else "UNLOCKED"
            
            # 3. Trend Check (Price > 20 SMA)
            trend = "UNKNOWN"
            try:
                if data is not None:
                     df = data[ticker].dropna() if len(tickers) > 1 else data
                     if not df.empty and len(df) > 20:
                         sma_20 = df['Close'].rolling(window=20).mean().iloc[-1]
                         current_price = df['Close'].iloc[-1]
                         trend = "UP" if current_price > sma_20 else "DOWN"
            except:
                pass

            # XIRR is complex without full cashflows, using 'pl_percent' as proxy for MVP
            performance_pct = asset.get('pl_percent', 0.0)

            recommendation = "HOLD"
            if status == "UNLOCKED":
                if trend == "DOWN" or performance_pct < -5: # Simple stop loss / trend break logic
                    recommendation = "SELL_CANDIDATE"
                elif trend == "UP":
                    recommendation = "KEEP_WINNER"
            else:
                recommendation = "LOCKED_HOLD"

            analyzed_assets.append({
                "ticker": ticker,
                "age_days": age_days,
                "status": status,
                "trend": trend,
                "recommendation": recommendation,
                "pl_percent": performance_pct
            })

        return analyzed_assets
