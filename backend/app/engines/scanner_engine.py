import yfinance as yf
import pandas as pd
import ta
import numpy as np
from app.utils.tickers import NIFTY_500_TICKERS

class MarketScanner:
    def __init__(self):
        self.tickers = NIFTY_500_TICKERS

    def scan_market(self):
        """
        Scans the market for buy candidates based on:
        1. Price > 50 SMA
        2. Rising RSI (50 < RSI < 65)
        3. High Volatility (ATR checks)
        4. Volume Shock
        """
        print(f"Scanning {len(self.tickers)} tickers...")
        candidates = []

        # Batch download for speed
        try:
            # We need enough history for 50 SMA + some buffer
            data = yf.download(self.tickers, period="3mo", group_by='ticker', progress=False)
        except Exception as e:
            print(f"Error downloading data: {e}")
            return []

        for ticker in self.tickers:
            try:
                # Handle MultiIndex dataframe from yfinance
                df = data[ticker].dropna() if len(self.tickers) > 1 else data
                
                if df.empty or len(df) < 55:
                    continue

                # Indicators
                # 1. SMA 50
                sma_50 = df['Close'].rolling(window=50).mean()
                
                # 2. RSI 14
                rsi_indicator = ta.momentum.RSIIndicator(close=df['Close'], window=14)
                rsi_14 = rsi_indicator.rsi()
                
                # 3. ATR 14 (Volatility)
                atr_indicator = ta.volatility.AverageTrueRange(high=df['High'], low=df['Low'], close=df['Close'], window=14)
                atr_14 = atr_indicator.average_true_range()
                
                # 4. Volume SMA 20
                vol_sma_20 = df['Volume'].rolling(window=20).mean()

                # Get latest values (iloc[-1]) and previous (iloc[-2])
                current_price = df['Close'].iloc[-1]
                curr_sma = sma_50.iloc[-1]
                curr_rsi = rsi_14.iloc[-1]
                prev_rsi = rsi_14.iloc[-2]
                curr_atr = atr_14.iloc[-1]
                curr_vol = df['Volume'].iloc[-1]
                avg_vol = vol_sma_20.iloc[-1]

                # Filter Logic
                
                # 1. Price Check: Price > 50-Day SMA
                if current_price <= curr_sma:
                    continue

                # 2. RSI Setup: Rising and between 50 and 65
                # Rising means Current > Previous
                if not (50 < curr_rsi < 65 and curr_rsi > prev_rsi):
                    continue

                # 3. Volatility: High enough for 3% move
                # We interpret this as ATR being at least 1-2% of price? 
                # Or simply providing the potential. 
                # Let's check if (3 * ATR) > 3% of Price -> i.e., decent range.
                if (curr_atr / current_price) < 0.01: # Minimum 1% daily range potential
                    continue

                # 4. Volume Shock Metric (Current / Avg)
                vol_shock = curr_vol / avg_vol if avg_vol > 0 else 0

                candidates.append({
                    "ticker": ticker,
                    "price": round(current_price, 2),
                    "rsi": round(curr_rsi, 2),
                    "volume_shock": round(vol_shock, 2),
                    "volatility": round((curr_atr/current_price)*100, 2), # as %
                    "score": vol_shock # Rank by volume shock
                })

            except Exception as e:
                # print(f"Error processing {ticker}: {e}")
                continue

        # Sort by Score (Volume Shock) Descending
        candidates.sort(key=lambda x: x['score'], reverse=True)
        
        return candidates[:5] # Return Top 5
