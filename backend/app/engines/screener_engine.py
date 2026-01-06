import yfinance as yf
import pandas as pd

class ScreenerEngine:
    def __init__(self):
        # MVP: List of popular Nifty 50/Next 50 stocks to scan
        # In production, this would be a dynamic list scraped from NSE/BSE
        self.tickers = [
            "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
            "TATASTEEL.NS", "SBIN.NS", "BHARTIARTL.NS", "ITC.NS", "LICI.NS",
            "ADANIENT.NS", "BAJFINANCE.NS", "MARUTI.NS", "SUNPHARMA.NS", "TATAMOTORS.NS",
            "ONGC.NS", "NTPC.NS", "POWERGRID.NS", "TITAN.NS", "ULTRACEMCO.NS"
        ]

    def screen_market(self):
        """
        Filters assets based on:
        1. Price > 50
        2. Average Volume > 1M (Liquidity)
        3. Price > SMA_20 (Momentum)
        """
        results = []
        
        # In a real app, we'd use async or batch requests. 
        # yfinance allows batch downloading which is much faster.
        data = yf.download(self.tickers, period="1mo", progress=False)
        
        # 'data' is a MultiIndex DataFrame (Price Type -> Ticker)
        # We need to process each ticker
        
        # Handle cases where only one ticker is returned (structure differs)
        if len(self.tickers) == 1:
            # Not handling single ticker case for this specific batch list, but good practice
            pass

        for ticker in self.tickers:
            try:
                # Extract Close prices for this ticker
                closes = data.xs('Close', level=0, axis=1)[ticker]
                volumes = data.xs('Volume', level=0, axis=1)[ticker]
                
                if closes.empty:
                    continue

                current_price = closes.iloc[-1]
                avg_volume = volumes.mean()
                
                # Calculate SMA 20 (simple moving average of last 20 days)
                # Since we fetched '1mo', we have approx 20-22 trading days.
                sma_20 = closes.mean() 
                
                # Filter Logic
                is_liquid = avg_volume > 1000000 # 1M volume
                price_condition = current_price > 50
                momentum_condition = current_price > sma_20

                if is_liquid and price_condition and momentum_condition:
                    results.append({
                        "ticker": ticker,
                        "price": round(current_price, 2),
                        "sma_20": round(sma_20, 2),
                        "volume_avg": int(avg_volume),
                        "momentum_score": round(((current_price - sma_20) / sma_20) * 100, 2) # % above SMA
                    })
            
            except Exception as e:
                print(f"Error screening {ticker}: {e}")
                continue
                
        # Sort by momentum score (highest first)
        results.sort(key=lambda x: x['momentum_score'], reverse=True)
        return results

if __name__ == "__main__":
    screener = ScreenerEngine()
    print("Running Screener...")
    matches = screener.screen_market()
    print(f"Found {len(matches)} matches:")
    for m in matches:
        print(m)
