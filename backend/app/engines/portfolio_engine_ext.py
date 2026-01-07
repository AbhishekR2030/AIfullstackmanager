import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta
import numpy as np

# ... existing imports ...

    def get_portfolio_history(self, period="1y"):
        """
        Calculates the historical value of the portfolio based on trade data.
        Returns daily portfolio value and invested amount.
        """
        if not portfolio_db:
            return {"dates": [], "value": [], "invested": []}

        # 1. Identify valid tickers and fetch history
        tickers = list(set([t['ticker'] for t in portfolio_db]))
        
        # Determine start date (min of period or first trade date)
        # For simplicity, we fetch 'period' from yfinance, but we need to ensure we cover enough history for the plot
        # Actually, to reconstruct portfolio correctly, we ideally need history since the FIRST trade.
        # But if the user asks for '1mo', we only need 1 month of chart data.
        # However, to know the TOTAL value valid 1 month ago, we need to know the price of stocks bought 1 year ago.
        # So we ALWAYS need prices for current holdings for the requested chart window.
        
        # Let's fetch data for the requested period + buffer, or just 'max' if safer/not too slow?
        # '2y' is a safe default for now, or determining from trade dates.
        # Let's use the requested period for the output, but fetch sufficient data?
        # Actually, yfinance fetch is cheap for < 50 stocks. Let's fetch '2y' to cover most recent trades.
        # If a trade is older than 2y, we might miss price data if we only fetch 2y. 
        # Let's find the earliest buy date.
        
        earliest_date = min([datetime.strptime(t['buy_date'], "%Y-%m-%d") for t in portfolio_db])
        # Ensure we fetch at least from earliest_date
        # yf.download doesn't support arbitrary start date cleanly with 'period', use start/end
        
        start_date = earliest_date.strftime("%Y-%m-%d")
        
        try:
            # Fetch all at once
            data = yf.download(tickers, start=start_date, progress=False)['Close']
        except:
             return {"error": "Failed to fetch market data"}

        # Handle Single Ticker case (Series vs DataFrame)
        if len(tickers) == 1:
            data = data.to_frame(name=tickers[0])
            
        # Resample to daily to handle missing weekends/holidays (fill fwd)
        data = data.resample('D').ffill()

        # 2. Reconstruct Portfolio Value Day by Day
        # We need a DataFrame index matching the fetched data
        history_dates = data.index
        
        total_value_series = pd.Series(0.0, index=history_dates)
        invested_series = pd.Series(0.0, index=history_dates)
        
        for trade in portfolio_db:
            ticker = trade['ticker']
            qty = float(trade['quantity'])
            buy_price = float(trade['buy_price'])
            buy_date = pd.to_datetime(trade['buy_date'])
            
            # Invested Amount Step Function: Adds buy_price * qty starting from buy_date
            # We use a mask to add only for dates >= buy_date
            invested_series.loc[buy_date:] += (buy_price * qty)
            
            # Current Value Series: Adds daily_price * qty starting from buy_date
            # We assume we still hold it (no sell logic yet)
            if ticker in data.columns:
                 # Align prices to the mask
                 prices = data[ticker].copy()
                 prices.loc[:buy_date] = 0 # It wasn't in portfolio before buy_date
                 # Actually, better logic: 
                 # Slice prices from buy_date onwards and add
                 # But we need to align indexes.
                 
                 # Set prices before buy_date to NaN or 0? 
                 # If we add 0, it means value is 0. Correct.
                 ticker_value = data[ticker] * qty
                 
                 # Only add value for days we held it
                 # Using .where to zero out pre-buy dates
                 ticker_value = ticker_value.where(ticker_value.index >= buy_date, 0)
                 ticker_value = ticker_value.fillna(0) # Handle NaN from ffill issues if any
                 
                 # Add to total
                 total_value_series = total_value_series.add(ticker_value, fill_value=0)

        # 3. Filter for the requested period (e.g., last 1 month, 1 year)
        # Simple slicing
        end_date = datetime.now()
        if period == "1mo":
             start_filter = end_date - timedelta(days=30)
        elif period == "3mo":
             start_filter = end_date - timedelta(days=90)
        elif period == "6mo":
             start_filter = end_date - timedelta(days=180)
        elif period == "1y":
             start_filter = end_date - timedelta(days=365)
        elif period == "ytd":
             start_filter = datetime(end_date.year, 1, 1)
        else:
             start_filter = earliest_date # All

        # Apply filter
        mask = (total_value_series.index >= start_filter)
        final_values = total_value_series[mask]
        final_invested = invested_series[mask]
        
        # Prepare JSON response
        response = {
            "dates": final_values.index.strftime("%Y-%m-%d").tolist(),
            "portfolio_value": final_values.round(2).tolist(),
            "invested_value": final_invested.round(2).tolist()
        }
        return response
