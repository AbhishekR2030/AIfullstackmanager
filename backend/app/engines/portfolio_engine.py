import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd
import json
import os
from sqlalchemy import Column, Integer, String, Float, Text, ForeignKey, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Use the same database as auth
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./users.db")

# Handle postgres:// vs postgresql:// for SQLAlchemy 1.4+
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False} if "sqlite" in SQLALCHEMY_DATABASE_URL else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Portfolio Model
class PortfolioItem(Base):
    __tablename__ = "portfolio_items"
    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True)
    ticker = Column(String)
    company_name = Column(String, nullable=True)
    quantity = Column(Integer)
    buy_price = Column(Float)
    buy_date = Column(String)
    source = Column(String, default="MANUAL")

# Create tables
Base.metadata.create_all(bind=engine)

class PortfolioEngine:
    def __init__(self):
        pass

    def _get_db(self):
        return SessionLocal()

    def add_trade(self, trade_data, user_email):
        db = self._get_db()
        try:
            item = PortfolioItem(
                user_email=user_email,
                ticker=trade_data.get('ticker'),
                company_name=trade_data.get('company_name', ''),
                quantity=int(trade_data.get('quantity', 0)),
                buy_price=float(trade_data.get('buy_price', 0)),
                buy_date=trade_data.get('buy_date', datetime.now().strftime("%Y-%m-%d")),
                source=trade_data.get('source', 'MANUAL')
            )
            db.add(item)
            db.commit()
            return {"message": "Trade added successfully", "trade": trade_data}
        finally:
            db.close()

    def sync_hdfc_trades(self, hdfc_trades, user_email):
        """
        Replaces ALL existing HDFC trades with the fresh batch.
        This ensures the portfolio is always up-to-date with HDFC.
        """
        db = self._get_db()
        try:
            # Delete existing HDFC trades for this user
            db.query(PortfolioItem).filter(
                PortfolioItem.user_email == user_email,
                PortfolioItem.source == "HDFC"
            ).delete()
            
            # Add new trades
            for trade in hdfc_trades:
                item = PortfolioItem(
                    user_email=user_email,
                    ticker=trade.get('ticker'),
                    company_name=trade.get('company_name', ''),
                    quantity=int(trade.get('quantity', 0)),
                    buy_price=float(trade.get('buy_price', 0)),
                    buy_date=trade.get('buy_date', datetime.now().strftime("%Y-%m-%d")),
                    source="HDFC"
                )
                db.add(item)
            
            db.commit()
            return {
                "message": "Portfolio fully synced with HDFC", 
                "added_count": len(hdfc_trades),
                "total_count": len(hdfc_trades)
            }
        finally:
            db.close()

    def delete_trade(self, ticker, user_email):
        db = self._get_db()
        try:
            deleted = db.query(PortfolioItem).filter(
                PortfolioItem.user_email == user_email,
                PortfolioItem.ticker == ticker
            ).delete()
            db.commit()
            if deleted:
                return {"message": "Trade deleted successfully", "success": True}
            return {"message": "Trade not found", "success": False}
        finally:
            db.close()

    def _sanitize_float(self, val):
        import math
        if val is None: return 0.0
        try:
            f_val = float(val)
            if math.isnan(f_val) or math.isinf(f_val):
                return 0.0
            return f_val
        except:
            return 0.0

    def get_portfolio(self, user_email):
        """
        Returns portfolio with live metrics for specific user.
        """
        db = self._get_db()
        try:
            items = db.query(PortfolioItem).filter(
                PortfolioItem.user_email == user_email
            ).all()
            
            if not items:
                return []
            
            user_trades = [
                {
                    "ticker": item.ticker,
                    "company_name": item.company_name,
                    "quantity": item.quantity,
                    "buy_price": item.buy_price,
                    "buy_date": item.buy_date,
                    "source": item.source
                }
                for item in items
            ]
        finally:
            db.close()

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
                    pass

            # 3. Calculate Metrics
            current_price = self._sanitize_float(current_price)
            
            total_value = current_price * qty
            invested_value = buy_price * qty
            pl_amount = total_value - invested_value
            pl_percent = ((current_price - buy_price) / buy_price) * 100 if buy_price and buy_price != 0 else 0

            # 4. Construct Safe Response
            enriched_portfolio.append({
                **trade,
                "current_price": round(current_price, 2),
                "total_value": round(self._sanitize_float(total_value), 2),
                "pl_amount": round(self._sanitize_float(pl_amount), 2),
                "pl_percent": round(self._sanitize_float(pl_percent), 2)
            })
            
        return enriched_portfolio

    def get_portfolio_history(self, user_email, period="1y"):
        db = self._get_db()
        try:
            items = db.query(PortfolioItem).filter(
                PortfolioItem.user_email == user_email
            ).all()
            
            if not items:
                return {"dates": [], "portfolio_value": [], "invested_value": []}
            
            user_trades = [
                {
                    "ticker": item.ticker,
                    "quantity": item.quantity,
                    "buy_price": item.buy_price,
                    "buy_date": item.buy_date
                }
                for item in items
            ]
        finally:
            db.close()

        tickers = list(set([t['ticker'] for t in user_trades]))
        
        parsed_dates = []
        for t in user_trades:
            d_str = t.get('buy_date')
            if not d_str: continue
            
            p_date = None
            for fmt in ["%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%Y/%m/%d"]:
                try:
                    p_date = datetime.strptime(d_str, fmt)
                    break
                except ValueError:
                    continue
            
            if p_date:
                parsed_dates.append(p_date)
        
        if not parsed_dates:
             return {"dates": [], "portfolio_value": [], "invested_value": []}

        earliest_date = min(parsed_dates)
        start_date = earliest_date.strftime("%Y-%m-%d")
        
        try:
            data = yf.download(tickers, start=start_date, progress=False)
            if 'Close' in data.columns:
                data = data['Close']
            
            if len(tickers) == 1 and isinstance(data, pd.DataFrame) and tickers[0] not in data.columns:
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
            
            d_str = trade.get('buy_date', '')
            buy_date_ts = pd.Timestamp.now()
            for fmt in ["%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%Y/%m/%d"]:
                try:
                    buy_date_ts = pd.Timestamp(datetime.strptime(d_str, fmt))
                    break
                except ValueError:
                    continue
            
            invested_series.loc[buy_date_ts:] += (buy_price * qty)
            
            price_series = None
            if isinstance(data, pd.Series):
                 price_series = data
            elif isinstance(data, pd.DataFrame) and ticker in data.columns:
                 price_series = data[ticker]
            
            if price_series is not None:
                 price_series = price_series.fillna(method='ffill').fillna(0)
                 val_contrib = price_series * qty
                 val_contrib = val_contrib.where(val_contrib.index >= buy_date_ts, 0)
                 total_value_series = total_value_series.add(val_contrib, fill_value=0)

        # Filter by period
        start_filter = earliest_date
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

portfolio_manager = PortfolioEngine()
