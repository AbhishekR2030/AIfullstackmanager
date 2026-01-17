import yfinance as yf
import os
import google.generativeai as genai
import json
import time
from datetime import datetime, timedelta

class AnalystEngine:
    def __init__(self):
        self.api_key = os.getenv("GOOGLE_API_KEY")
        if self.api_key:
            genai.configure(api_key=self.api_key)
        else:
            print("Warning: GOOGLE_API_KEY not found in environment variables.")

        # Model Tier List (from user's Google AI Studio - Jan 2026)
        # Ordered by preference, will fallback on 429 rate limit errors
        self.models = [
            'models/gemini-2.5-flash',       # 1. Primary (5 RPM, 20 RPD)
            'models/gemini-2.5-flash-lite',  # 2. Fallback (10 RPM, 20 RPD) - higher rate limit
            'models/gemini-3-flash',         # 3. Fallback (5 RPM, 20 RPD)
            'models/gemini-2.0-flash',       # 4. Legacy fallback
        ]
        
        # Track rate-limited models to skip them temporarily
        self.rate_limited_models = {}  # {model_name: expire_time}

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
        current_time = time.time()

        # Clean up expired rate limits
        self.rate_limited_models = {
            k: v for k, v in self.rate_limited_models.items() 
            if v > current_time
        }

        # Smart Tiering Strategy with Rate Limit Handling
        for model_name in self.models:
            # Skip temporarily rate-limited models
            if model_name in self.rate_limited_models:
                print(f"[AI] Skipping {model_name} (rate limited until {self.rate_limited_models[model_name] - current_time:.0f}s)", flush=True)
                continue
                
            print(f"[AI] Trying Model: {model_name}...", flush=True)
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(prompt)
                
                # Basic cleanup
                text = response.text.replace("```json", "").replace("```", "").strip()
                result = json.loads(text)
                
                # If successful, inject the model name used for transparency
                result['model_used'] = model_name 
                print(f"[AI] Success with {model_name}", flush=True)
                return result

            except Exception as e:
                error_str = str(e)
                print(f"[AI] Failed with {model_name}: {error_str[:100]}", flush=True)
                last_error = e
                
                # Check for rate limit error (429)
                if "429" in error_str or "quota" in error_str.lower() or "rate" in error_str.lower():
                    # Mark model as rate limited for 60 seconds
                    self.rate_limited_models[model_name] = current_time + 60
                    print(f"[AI] Rate limited: {model_name} - trying next model", flush=True)
                
                continue  # Try next model
        
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
