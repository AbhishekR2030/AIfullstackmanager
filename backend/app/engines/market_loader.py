
import yfinance as yf
from app.utils.tickers import NIFTY_500_TICKERS

class MarketLoader:
    def __init__(self):
        # India Universe
        # Ideally we fetch Nifty Midcap 150 and Smallcap 250 dynamically or from a DB.
        # For this implementation, we use NIFTY_500_TICKERS which acts as a superset proxy.
        self.india_equities = NIFTY_500_TICKERS 
        self.india_etfs = ["GOLDBEES.NS", "SILVERBEES.NS", "NIFTYBEES.NS", "BANKBEES.NS"]
        
        # US Universe
        self.us_equities = [
            # Tech / Growth (Nasdaq 100 proxy)
            "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK-B", "LLY", "AVGO",
            "JPM", "V", "UNH", "PG", "MA", "HD", "CVX", "MRK", "ABBV", "COST", 
            "AMD", "NFLX", "INTC", "CSCO", "CMCSA", "PEP", "ADBE", "TXN", "QCOM", "TMUS",
            "CRM", "WMT", "XOM", "BAC", "ACN", "LIN", "MCD", "DIS", "TMO", "ABT"
        ]
        self.us_etfs = ["GLD", "SLV", "USO", "SPY", "QQQ", "IWM"]

    def get_india_tickers(self):
        # Combine and deduplicate
        return list(set(self.india_equities + self.india_etfs))

    def get_us_tickers(self):
        return list(set(self.us_equities + self.us_etfs))

    def fetch_data(self, tickers, period="6mo"):
        """
        Fetches historical data for a list of tickers.
        """
        if not tickers:
            return None
        
        try:
            # Download data in batch
            data = yf.download(tickers, period=period, group_by='ticker', progress=False, threads=True)
            return data
        except Exception as e:
            print(f"Error fetching data: {e}")
            return None
            
market_loader = MarketLoader()
