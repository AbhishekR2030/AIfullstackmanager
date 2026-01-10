import yfinance as yf
import os
import google.generativeai as genai
import json
from datetime import datetime, timedelta

class AnalystEngine:
    def __init__(self):
        self.api_key = os.getenv("GOOGLE_API_KEY")
        if self.api_key:
            genai.configure(api_key=self.api_key)
        else:
            print("Warning: GOOGLE_API_KEY not found in environment variables.")

        # Priority List: Try powerful models first, fallback to reliable/fast ones
        # Priority List: Try powerful models first, fallback to reliable/fast ones
        # Priority List: Try powerful models first, fallback to reliable/fast ones
        self.models = [
            'models/gemini-2.0-flash-001',  # 1. User Selected
            'models/gemini-2.0-flash',      # 2. Alternates
            'models/gemini-flash-latest',   # 3. Fallback (Flash 1.5)
            'models/gemini-pro-latest',     # 4. Fallback (Pro 1.5)
        ]

    # ... (fetch_market_data, fetch_news, get_macro_data remain same)

    def generate_thesis(self, ticker_symbol):
        if not self.api_key:
            return {"error": "LLM not initialized (Missing API Key)"}

        data = self.fetch_market_data(ticker_symbol)
        news = self.fetch_news(ticker_symbol)
        macro = self.get_macro_data()

        prompt = f"""
        You are a Citadel Quant Researcher focusing on the Indian Market.
        Analyze the following asset for a High-Alpha Swing Trade (>3% Monthly potential): {ticker_symbol}

        **Market Data:**
        {json.dumps(data, default=str)}

        **Recent News:**
        {json.dumps(news)}

        **Macro Context:**
        {json.dumps(macro)}

        **Task:**
        Provide a structured investment thesis. 
        Output STRICT JSON format with the following keys:
        - recommendation: "Buy", "Sell", or "Hold"
        - thesis: [List of 3 distinct reasons for selection (Key Drivers)]
        - risk_factors: [List of 3 specific reasons why this prediction could go WRONG (Bear Case)]
        - confidence_score: (0-100 integer)
        """

        last_error = None

        # Smart Tiering Strategy
        for model_name in self.models:
            print(f"Trying AI Model: {model_name}...")
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(prompt)
                
                # Basic cleanup
                text = response.text.replace("```json", "").replace("```", "").strip()
                result = json.loads(text)
                
                # If successful, inject the model name used for transparency
                result['model_used'] = model_name 
                return result

            except Exception as e:
                print(f"Failed with {model_name}: {e}")
                last_error = e
                continue # Try next model
        
        # If all failed
        return {"error": f"All AI tiers failed. Last error: {str(last_error)}"}



    def fetch_market_data(self, ticker_symbol):
        """Fetches price data and issuer info."""
        ticker = yf.Ticker(ticker_symbol)
        
        # Get last 1 month of data for context
        hist = ticker.history(period="1mo")
        current_price = hist['Close'].iloc[-1] if not hist.empty else 0
        
        info = ticker.info
        return {
            "symbol": ticker_symbol,
            "current_price": current_price,
            "sector": info.get("sector", "Unknown"),
            "industry": info.get("industry", "Unknown"),
            "beta": info.get("beta", 0),
            "market_cap": info.get("marketCap", 0),
            "price_history": {str(k.date()): v for k, v in hist['Close'].to_dict().items()} # keys explicitly converted to string
        }

    def fetch_news(self, ticker_symbol):
        """Fetches recent news using yfinance."""
        ticker = yf.Ticker(ticker_symbol)
        news_list = ticker.news
        return [n.get('title', '') for n in news_list[:5]] # Top 5 headlines

    def get_macro_data(self):
        """Mock macro data (In production, fetch from APIs)."""
        return {
            "repo_rate": "6.5%", # RBI Repo Rate
            "crude_oil": "78 USD/bbl",
            "us_fed_rate": "5.25%"
        }




if __name__ == "__main__":
    # For quick testing
    from dotenv import load_dotenv
    load_dotenv(dotenv_path="../.env") # Adjust path as needed
    
    engine = AnalystEngine()
    result = engine.generate_thesis("TATASTEEL.NS")
    print(json.dumps(result, indent=2))
