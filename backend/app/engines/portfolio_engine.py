import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd
import json
import os

# Persistent Storage File
DB_FILE = "portfolio_db.json"

class PortfolioEngine:
    def __init__(self):
        self.db_file = DB_FILE
        self.portfolio_db = {} # Changed from list to dict {email: [trades]}
        self._load_db()

    def _load_db(self):
        """Loads portfolio from JSON file with migration support."""
        if os.path.exists(self.db_file):
            try:
                with open(self.db_file, "r") as f:
                    data = json.load(f)
                    
                    # Migration: If data is a list (legacy single-user), map it to the admin email
                    if isinstance(data, list):
                        print("Migrating legacy portfolio to Multi-User format...")
                        self.portfolio_db = { "chabhishekreddy@gmail.com": data }
                        self._save_db()
                    else:
                        self.portfolio_db = data
            except Exception as e:
                print(f"Error loading DB: {e}")
                self.portfolio_db = {}
        else:
            self.portfolio_db = {}

    def _save_db(self):
        """Saves portfolio to JSON file."""
        try:
            with open(self.db_file, "w") as f:
                json.dump(self.portfolio_db, f, indent=4)
        except Exception as e:
            print(f"Error saving DB: {e}")

    def add_trade(self, trade_data, user_email):
        if user_email not in self.portfolio_db:
            self.portfolio_db[user_email] = []
        
        # Default source to MANUAL if not specified
        if "source" not in trade_data:
            trade_data["source"] = "MANUAL"
            
        self.portfolio_db[user_email].append(trade_data)
        self._save_db()
        return {"message": "Trade added successfully", "trade": trade_data}

    def sync_hdfc_trades(self, hdfc_trades, user_email):
        """
        Replaces all existing HDFC trades with the fresh batch.
        Preserves MANUAL trades.
        """
        if user_email not in self.portfolio_db:
            self.portfolio_db[user_email] = []

        # 1. Separate existing manual trades
        current_portfolio = self.portfolio_db[user_email]
        manual_trades = [t for t in current_portfolio if t.get("source") != "HDFC"]
        
        # 2. Merge with new HDFC trades
        # hdfc_trades is expected to be a list of trade dicts
        updated_portfolio = manual_trades + hdfc_trades
        
        self.portfolio_db[user_email] = updated_portfolio
        self._save_db()
        
        return {
            "message": "Portfolio synced with HDFC", 
            "added_count": len(hdfc_trades),
            "total_count": len(updated_portfolio)
        }


    def delete_trade(self, ticker, user_email):
        if user_email not in self.portfolio_db:
             return {"message": "User not found", "success": False}

        user_portfolio = self.portfolio_db[user_email]
        initial_len = len(user_portfolio)
        self.portfolio_db[user_email] = [t for t in user_portfolio if t['ticker'] != ticker]
        
        if len(self.portfolio_db[user_email]) == initial_len:
             return {"message": "Trade not found", "success": False}
        
        self._save_db()
        return {"message": "Trade deleted successfully", "success": True}

    def get_portfolio(self, user_email):
        """
        Returns portfolio with live metrics for specific user.
        """
        if user_email not in self.portfolio_db or not self.portfolio_db[user_email]:
            return []

        user_trades = self.portfolio_db[user_email]
        tickers = [t['ticker'] for t in user_trades]
        market_data = None
        
        # 1. Try fetching live data
        try:
             if tickers:
                market_data = yf.download(tickers, period="1d", progress=False)['Close']
        except Exception as e:
            print(f"Error fetching prices: {e}")
            market_data = None

        enriched_portfolio = []
        for trade in user_trades:
            ticker = trade['ticker']
            buy_price = float(trade.get('buy_price', 0))
            qty = int(trade.get('quantity', 0))
            
            # 2. Determine Current Price
            current_price = buy_price # Default fallback
            
            if market_data is not None:
                try:
                    if len(tickers) == 1:
                        # Single ticker return might be scalar or Series
                        if isinstance(market_data, pd.DataFrame):
                            val = market_data.iloc[-1].item()
                        elif isinstance(market_data, pd.Series):
                            val = market_data.iloc[-1]
                        else:
                            val = float(market_data)
                        current_price = float(val)
                    else:
                        # Multiple tickers
                        if ticker in market_data.columns:
                            val = market_data[ticker].iloc[-1]
                            current_price = float(val)
                except Exception as ex:
                    # print(f"Price extract error for {ticker}: {ex}")
                    pass

            # 3. Calculate Metrics
            total_value = current_price * qty
            invested_value = buy_price * qty
            pl_amount = total_value - invested_value
            pl_percent = ((current_price - buy_price) / buy_price) * 100 if buy_price else 0

            # 4. Construct Safe Response
            enriched_portfolio.append({
                **trade,
                "current_price": round(current_price, 2),
                "total_value": round(total_value, 2),
                "pl_amount": round(pl_amount, 2),
                "pl_percent": round(pl_percent, 2)
            })
            
        return enriched_portfolio

    def get_portfolio_history(self, user_email, period="1y"):
        # Re-implemented history with safe checks
        if user_email not in self.portfolio_db or not self.portfolio_db[user_email]:
            return {"dates": [], "portfolio_value": [], "invested_value": []}
            
        user_trades = self.portfolio_db[user_email]

        tickers = list(set([t['ticker'] for t in user_trades]))
        
        try:
            earliest_date = min([datetime.strptime(t['buy_date'], "%Y-%m-%d") for t in user_trades])
        except:
             return {"dates": [], "portfolio_value": [], "invested_value": []}
             
        start_date = earliest_date.strftime("%Y-%m-%d")
        
        try:
            data = yf.download(tickers, start=start_date, progress=False)
            # Normalize data structure to Just 'Close' prices
            if 'Close' in data.columns:
                data = data['Close']
            
            # If MultiIndex with columns (Price, Ticker), we need to handle it.
            # yfinance recent versions are tricky.
            # If we requested multiple tickers, data is DataFrame with columns=tickers.
            # If single ticker, columns might be just 'Close' (Series) or DataFrame with 'Open','Close'.
            if len(tickers) == 1 and isinstance(data, pd.DataFrame) and tickers[0] not in data.columns:
                 # Rename 'Close' to ticker name for consistent logic below
                 data = data.rename(columns={"Close": tickers[0]})
            
        except Exception as e:
            return {"dates": [], "portfolio_value": [], "invested_value": []}

        data = data.resample('D').ffill()
        history_dates = data.index
        total_value_series = pd.Series(0.0, index=history_dates)
        invested_series = pd.Series(0.0, index=history_dates)
        
        for trade in user_trades:
            ticker = trade['ticker']
            qty = float(trade['quantity'])
            buy_price = float(trade['buy_price'])
            buy_date_ts = pd.Timestamp(trade['buy_date'])
            
            invested_series.loc[buy_date_ts:] += (buy_price * qty)
            
            # Find price series for this ticker
            price_series = None
            if isinstance(data, pd.Series):
                 # Single ticker scenario
                 price_series = data
            elif isinstance(data, pd.DataFrame) and ticker in data.columns:
                 price_series = data[ticker]
            
            if price_series is not None:
                 price_series = price_series.fillna(method='ffill').fillna(0)
                 val_contrib = price_series * qty
                 val_contrib = val_contrib.where(val_contrib.index >= buy_date_ts, 0)
                 total_value_series = total_value_series.add(val_contrib, fill_value=0)

        # Filter
        start_filter = earliest_date # Default
        end_date = datetime.now()
        if period == "1mo": start_filter = end_date - timedelta(days=30)
        elif period == "3mo": start_filter = end_date - timedelta(days=90)
        elif period == "6mo": start_filter = end_date - timedelta(days=180)
        elif period == "1y": start_filter = end_date - timedelta(days=365)
        elif period == "ytd": start_filter = datetime(end_date.year, 1, 1)

        mask = (total_value_series.index >= start_filter)
        final_dates = total_value_series[mask].index.strftime("%Y-%m-%d").tolist()
        final_values = total_value_series[mask].round(2).tolist()
        final_invested = invested_series[mask].round(2).tolist()
        
        return {
            "dates": final_dates,
            "portfolio_value": final_values,
            "invested_value": final_invested
        }
