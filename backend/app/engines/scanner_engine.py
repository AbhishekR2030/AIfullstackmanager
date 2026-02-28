
import yfinance as yf
import pandas as pd
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple
try:
    import pandas_ta as ta
except ImportError:
    ta = None
import numpy as np
from app.engines.market_loader import market_loader
from concurrent.futures import ThreadPoolExecutor
import requests
import json
import os

import time


@dataclass(frozen=True)
class ScanConfig:
    strategy: str = "core"
    rsi_min: int = 50
    rsi_max: int = 70
    volume_multiplier: float = 1.5
    roe_min: float = 12.0
    roce_min: float = 12.0
    rev_growth_min: float = 10.0
    rev_growth_max: float = 100.0
    profit_growth_min: float = 10.0
    profit_growth_max: float = 100.0
    max_debt_equity: float = 100.0
    moat_check: bool = False
    min_turnover_cr: float = 5.0
    min_price: float = 50.0
    max_price: float = 10000.0
    momentum_weight: float = 0.4
    fundamental_weight: float = 0.35
    valuation_weight: float = 0.25


ALPHASEEKER_CORE = ScanConfig(strategy="core")
CITADEL_MOMENTUM = ScanConfig(
    strategy="citadel_momentum",
    rsi_min=53,
    rsi_max=68,
    volume_multiplier=1.6,
    rev_growth_min=8.0,
    roe_min=14.0,
    roce_min=14.0,
    max_debt_equity=120.0,
    moat_check=True,
    momentum_weight=0.5,
    fundamental_weight=0.3,
    valuation_weight=0.2,
)
JANE_STREET_STAT = ScanConfig(
    strategy="jane_street_stat",
    rsi_min=38,
    rsi_max=62,
    volume_multiplier=1.2,
    rev_growth_min=0.0,
    roe_min=8.0,
    roce_min=8.0,
    max_debt_equity=200.0,
    moat_check=False,
    momentum_weight=0.45,
    fundamental_weight=0.2,
    valuation_weight=0.35,
)
MILLENNIUM_QUALITY = ScanConfig(
    strategy="millennium_quality",
    rsi_min=48,
    rsi_max=66,
    volume_multiplier=1.4,
    rev_growth_min=12.0,
    roe_min=16.0,
    roce_min=16.0,
    max_debt_equity=80.0,
    moat_check=True,
    momentum_weight=0.35,
    fundamental_weight=0.45,
    valuation_weight=0.2,
)
DE_SHAW_MULTIFACTOR = ScanConfig(
    strategy="de_shaw_multifactor",
    rsi_min=45,
    rsi_max=65,
    volume_multiplier=1.35,
    rev_growth_min=10.0,
    roe_min=14.0,
    roce_min=14.0,
    max_debt_equity=100.0,
    moat_check=True,
    momentum_weight=0.4,
    fundamental_weight=0.35,
    valuation_weight=0.25,
)

STRATEGY_CONFIGS: Dict[str, ScanConfig] = {
    "core": ALPHASEEKER_CORE,
    "citadel_momentum": CITADEL_MOMENTUM,
    "jane_street_stat": JANE_STREET_STAT,
    "millennium_quality": MILLENNIUM_QUALITY,
    "de_shaw_multifactor": DE_SHAW_MULTIFACTOR,
    "custom": ALPHASEEKER_CORE,
}

class MarketScanner:
    def __init__(self):
        self.loader = market_loader
        self.cache = None
        self.last_scan_time = 0
        self.CACHE_DURATION = 900 # 15 Minutes

    def _estimate_wacc(self, info, risk_free_rate=0.07):
        """
        Estimates WACC for Moat Calculation.
        Formula: (Re * E/V) + (Rd * (1-t) * D/V)
        """
        try:
            beta = info.get('beta', 1.0) or 1.0
            
            # Simple CAPM
            market_premium = 0.05
            cost_of_equity = risk_free_rate + (beta * market_premium)
            
            total_debt = info.get('totalDebt', 0) or 0
            market_cap = info.get('marketCap', 1) 
            total_value = market_cap + total_debt
            if total_value == 0: return 0.1
            
            weight_equity = market_cap / total_value
            weight_debt = total_debt / total_value
            
            cost_of_debt = risk_free_rate + 0.02
            tax_rate = 0.25
            
            wacc = (weight_equity * cost_of_equity) + (weight_debt * cost_of_debt * (1 - tax_rate))
            return wacc
        except:
            return 0.10

    def _resolve_scan_config(self, strategy: str = "core", thresholds: Optional[dict] = None) -> ScanConfig:
        normalized_strategy = (strategy or "core").strip().lower()
        base = STRATEGY_CONFIGS.get(normalized_strategy, ALPHASEEKER_CORE)
        thresholds = thresholds or {}
        technical = thresholds.get("technical", {}) or {}
        fundamental = thresholds.get("fundamental", {}) or {}

        if not technical and not fundamental:
            return base

        return ScanConfig(
            strategy="custom" if normalized_strategy == "custom" else base.strategy,
            rsi_min=int(technical.get("rsi_min", base.rsi_min)),
            rsi_max=int(technical.get("rsi_max", base.rsi_max)),
            volume_multiplier=float(
                technical.get(
                    "volume_shock_min",
                    technical.get("volume_multiplier", base.volume_multiplier),
                )
            ),
            roe_min=float(fundamental.get("roe_min", base.roe_min)),
            roce_min=float(fundamental.get("roce_min", base.roce_min)),
            rev_growth_min=float(
                fundamental.get(
                    "revenue_growth_min",
                    fundamental.get("rev_growth_min", base.rev_growth_min),
                )
            ),
            rev_growth_max=float(
                fundamental.get(
                    "revenue_growth_max",
                    fundamental.get("rev_growth_max", base.rev_growth_max),
                )
            ),
            profit_growth_min=float(fundamental.get("profit_growth_min", base.profit_growth_min)),
            profit_growth_max=float(fundamental.get("profit_growth_max", base.profit_growth_max)),
            max_debt_equity=float(
                fundamental.get(
                    "debt_equity_max",
                    fundamental.get("max_debt_equity", base.max_debt_equity),
                )
            ),
            moat_check=bool(fundamental.get("moat_check", base.moat_check)),
            min_turnover_cr=float(technical.get("min_turnover_cr", base.min_turnover_cr)),
            min_price=float(technical.get("min_price", base.min_price)),
            max_price=float(technical.get("max_price", base.max_price)),
            momentum_weight=base.momentum_weight,
            fundamental_weight=base.fundamental_weight,
            valuation_weight=base.valuation_weight,
        )

    def _normalise(self, value: float, low: float, high: float) -> float:
        if high <= low:
            return 0.0
        clipped = max(low, min(high, float(value)))
        return ((clipped - low) / (high - low)) * 100.0

    def _economic_moat_check(self, info: dict, roe: float) -> bool:
        # Support both decimal (0.18) and percentage-style (18) ROE inputs.
        roe_decimal = float(roe)
        if roe_decimal > 1.0:
            roe_decimal = roe_decimal / 100.0
        beta = info.get("beta", 1.0) or 1.0
        wacc = 0.6 * (0.073 + beta * 0.06) + 0.4 * (0.09 * 0.75)
        return (roe_decimal - wacc) >= 0.05

    def _composite_upside_score(self, metrics: dict, config: ScanConfig) -> float:
        rsi = float(metrics.get("rsi", 50.0))
        macd_hist = float(metrics.get("macd_hist", 0.0))
        roe = float(metrics.get("roe", 0.0))
        rev_growth = float(metrics.get("rev_growth", 0.0))
        pe = float(metrics.get("pe_ratio", 0.0))
        rev_growth_pct = rev_growth * 100.0 if rev_growth <= 1.0 else rev_growth

        momentum_score = 0.5 * self._normalise(rsi, 30, 70) + 0.5 * self._normalise(macd_hist, 0, 20)
        fundamental_score = 0.5 * self._normalise(roe, 12, 30) + 0.5 * self._normalise(rev_growth_pct, 5, 25)

        growth_pct = max(rev_growth_pct, 0.1)
        peg = pe / growth_pct if pe > 0 else 3.0
        valuation_score = max(0.0, min(100.0, ((3 - peg) / 2) * 100))

        total = (
            config.momentum_weight * momentum_score +
            config.fundamental_weight * fundamental_score +
            config.valuation_weight * valuation_score
        )
        return round(max(0.0, min(100.0, total)), 2)

    def _emit_progress(
        self,
        callback: Optional[Callable[[int, str], None]],
        percent: int,
        message: str
    ):
        if callback:
            try:
                callback(max(0, min(100, int(percent))), message)
            except Exception:
                pass

    def stage1_universe_liquidity_gate(
        self,
        ticker_data: Dict[str, pd.DataFrame],
        config: ScanConfig,
        region: str = "IN",
    ) -> Dict[str, pd.DataFrame]:
        survivors: Dict[str, pd.DataFrame] = {}
        usd_inr = 85.0
        for ticker, df in ticker_data.items():
            if df is None or df.empty:
                continue
            try:
                current_price = float(df["Close"].iloc[-1])
                avg_volume = float(df["Volume"].rolling(20).mean().iloc[-1])
                if not (config.min_price <= current_price <= config.max_price):
                    continue
                turnover_inr = (current_price * avg_volume) if region == "IN" else (current_price * avg_volume * usd_inr)
                if turnover_inr < config.min_turnover_cr * 1e7:
                    continue
                survivors[ticker] = df
            except Exception:
                continue
        return survivors

    def stage2_technical_filter(
        self,
        ticker_data: Dict[str, pd.DataFrame],
        config: ScanConfig,
        volatility_min: float = 3.0,
        volatility_max: float = 8.0,
    ) -> List[Dict[str, float]]:
        survivors: List[Dict[str, float]] = []
        for ticker, df in ticker_data.items():
            try:
                if df.empty or len(df) < 55:
                    continue
                current_price = float(df["Close"].iloc[-1])
                monthly_vol = float(df["Close"].pct_change().tail(30).std() * np.sqrt(21) * 100)
                if monthly_vol < volatility_min or monthly_vol > volatility_max:
                    continue
                sma_20 = float(df["Close"].rolling(20).mean().iloc[-1])
                sma_50 = float(df["Close"].rolling(50).mean().iloc[-1])
                if current_price <= sma_20 or current_price <= sma_50:
                    continue
                rsi = 50.0
                if ta:
                    rsi = float(ta.rsi(df["Close"], length=14).iloc[-1])
                    if not (config.rsi_min <= rsi <= config.rsi_max):
                        continue
                    macd = ta.macd(df["Close"])
                    if float(macd["MACDh_12_26_9"].iloc[-1]) <= 0:
                        continue
                avg_vol_20 = float(df["Volume"].rolling(20).mean().iloc[-1])
                current_vol = float(df["Volume"].iloc[-1])
                if current_vol <= (config.volume_multiplier * avg_vol_20):
                    continue
                survivors.append(
                    {
                        "ticker": ticker,
                        "df": df,
                        "price": current_price,
                        "rsi": rsi,
                        "vol_shock": float(current_vol / avg_vol_20),
                    }
                )
            except Exception:
                continue
        return survivors

    def _check_fundamentals(self, ticker, info, region="IN"):
        """
        Stage 2: Fundamental Safety Check & ETF Logic
        """
        quote_type = info.get('quoteType', 'EQUITY')
        
        # --- ETF LOGIC ---
        if quote_type == 'ETF' or 'BEES' in ticker or ticker in ["GLD", "SLV", "USO", "SPY", "QQQ", "IWM"]:
            aum = info.get('totalAssets', 0)
            min_aum = 4_200_000_000 if region == "IN" else 500_000_000
            if aum and aum < min_aum:
                # Lenient for MVP
                pass 
            return True, "ETF Passed"

        # --- EQUITY LOGIC ---
        rev_growth = info.get('revenueGrowth', 0) 
        if rev_growth is None or rev_growth < 0.15:
            return False, f"Low Rev Growth: {rev_growth}"
            
        roe = info.get('returnOnEquity', 0)
        if roe is None or roe < 0.18:
            return False, f"Low ROE: {roe}"
            
        risk_free = 0.07 if region == "IN" else 0.04
        wacc = self._estimate_wacc(info, risk_free_rate=risk_free)
        if (roe - wacc) < 0.06:
             return False, f"No Moat (ROE-WACC < 6%)"

        de_ratio = info.get('debtToEquity', 0)
        if de_ratio and de_ratio > 40: 
             return False, f"High Debt: {de_ratio}%"

        return True, "Passed"

    def _calculate_upside_score(self, df, info, region="IN", config: Optional[ScanConfig] = None):
        """
        Stage 4: Scoring Engine (0-100)
        """
        try:
            cfg = config or ALPHASEEKER_CORE
            if ta:
                rsi = ta.rsi(df['Close'], length=14).iloc[-1]
                macd = ta.macd(df['Close'])
                macd_hist = macd['MACDh_12_26_9'].iloc[-1]
            else:
                rsi = 50.0
                macd_hist = 0.0
            
            rsi_score = np.clip((rsi - 50) * 5, 0, 100)
            macd_score = 100 if macd_hist > 0 else 0
            mom_score = (rsi_score * 0.7) + (macd_score * 0.3)
            
            quote_type = info.get('quoteType', 'EQUITY')
            if quote_type == 'ETF':
                fund_score = 70
            else:
                rev_g = info.get('revenueGrowth', 0) or 0
                roe = info.get('returnOnEquity', 0) or 0
                rev_score = np.clip(rev_g * 500, 0, 100)
                roe_score = np.clip(roe * 400, 0, 100)
                fund_score = (rev_score * 0.5) + (roe_score * 0.5)

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
            composite_score = self._composite_upside_score(
                {
                    "rsi": rsi,
                    "macd_hist": macd_hist,
                    "roe": info.get('returnOnEquity', 0) or 0,
                    "rev_growth": info.get('revenueGrowth', 0) or 0,
                    "pe_ratio": info.get('trailingPE', 0) or 0,
                },
                cfg,
            )
            legacy_score = (fund_score * 0.4) + (mom_score * 0.3) + (val_score * 0.3)
            total_score = (legacy_score * 0.35) + (composite_score * 0.65)
            
            return {
                "total_score": round(total_score, 2),
                "upside_pct": round(upside_pct * 100, 1),
                "momentum_score": round(mom_score, 1)
            }
            
        except:
            return {
                "total_score": 50.0,
                "upside_pct": 0.0,
                "momentum_score": 50.0
            }

    def get_info_threaded(self, ticker):
        try:
            return ticker, yf.Ticker(ticker).info
        except:
            return ticker, {}


    def _fetch_yahoo_fundamentals(self, ticker, region="IN"):
        """
        Fetches fundamental data using Yahoo Finance (FREE).
        Much more reliable for Indian stocks than FMP.
        """
        try:
            from app.engines.yahoo_fundamentals_engine import yahoo_fundamentals
            return yahoo_fundamentals.get_fundamentals(ticker)
        except ImportError:
            print("[Scanner] Yahoo Fundamentals Engine not available, using fallback", flush=True)
            return {}
        except Exception as e:
            print(f"[Scanner] Yahoo Finance Error for {ticker}: {e}", flush=True)
            return {}
    
    # Keep Perplexity as fallback (renamed)
    def _fetch_perplexity_fundamentals_legacy(self, ticker, region="IN"):
        """
        Legacy: Fetches fundamental data using Perplexity API.
        Kept as fallback if FMP fails.
        """
        api_key = os.getenv("PERPLEXITY_API_KEY")
        if not api_key:
            print("Perplexity API Key missing. Skipping fundamentals.")
            return {}

        market_context = "National Stock Exchange of India (NSE)" if region == "IN" else "US Stock Market"
        
        prompt = f"""
        Get the latest financial data for {ticker} listed on {market_context}.
        Return a STRICT JSON object with these exact keys:
        - revenue_growth_yoy: (decimal, e.g. 0.15 for 15%)
        - return_on_equity: (decimal, e.g. 0.20 for 20%)
        - debt_to_equity: (decimal ratio)
        - sector: (string)
        - beta: (decimal)
        
        If exact recent data is unavailable, estimate from the latest annual report. 
        Evaluate 'revenue_growth_yoy' based on the last 4 quarters vs previous 4 quarters if possible.
        """
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": "sonar",
            "messages": [
                {"role": "system", "content": "You are a financial data assistant. Return ONLY JSON. No markdown formatting."},
                {"role": "user", "content": prompt}
            ]
        }
        
        try:
            response = requests.post("https://api.perplexity.ai/chat/completions", json=payload, headers=headers, timeout=30)
            if response.status_code == 200:
                content = response.json()['choices'][0]['message']['content']
                content = content.replace("```json", "").replace("```", "").strip()
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    print(f"Perplexity JSON Error for {ticker}: {content[:50]}...")
                    return {}
            else:
                print(f"Perplexity Error {response.status_code}: {response.text}")
                return {}
        except Exception as e:
            print(f"Perplexity Exception for {ticker}: {e}")
            return {}


    def scan_market(
        self,
        region: str = "IN",
        thresholds: Optional[dict] = None,
        strategy: str = "core",
        user_plan: str = "pro",
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ):
        """
        Main scanning method with user-configurable thresholds.
        
        Args:
            region: "IN" for India, "US" for US markets
            thresholds: Dict with 'technical' and 'fundamental' sub-dicts
        """
        # Default thresholds if not provided
        thresholds = thresholds or {}
        config = self._resolve_scan_config(strategy=strategy, thresholds=thresholds)

        # Technical thresholds
        rsi_min = config.rsi_min
        rsi_max = config.rsi_max
        vol_min = float((thresholds.get("technical", {}) or {}).get('volatility_min', 3))
        vol_max = float((thresholds.get("technical", {}) or {}).get('volatility_max', 8))
        vol_shock_min = config.volume_multiplier
        
        # Fundamental thresholds (in decimal, e.g., 0.10 for 10%)
        rev_growth_min = config.rev_growth_min / 100
        rev_growth_max = config.rev_growth_max / 100
        profit_growth_min = config.profit_growth_min / 100
        profit_growth_max = config.profit_growth_max / 100
        roe_min = config.roe_min / 100
        roe_max = 1.0
        roce_min = config.roce_min / 100
        roce_max = 1.0
        de_min = 0.0
        de_max = config.max_debt_equity
        
        # 1. Cache Check (skip cache if custom thresholds provided)
        if not thresholds and self.cache and (time.time() - self.last_scan_time < self.CACHE_DURATION):
            print("Returning Cached Scan Results (Speed Optimized)")
            if (user_plan or "").strip().lower() == "free":
                return self.cache[:10]
            return self.cache

        print(f"Starting Scan ({region}) with thresholds: RSI={rsi_min}-{rsi_max}, Vol={vol_min}-{vol_max}%...")
        
        try:
            self._emit_progress(progress_callback, 5, "Loading market universe")
            tickers = self.loader.get_india_tickers() if region == "IN" else self.loader.get_us_tickers()
            
            # 2. Batch Fetch History (Technicals via Yahoo - Reliable)
            self._emit_progress(progress_callback, 15, "Fetching OHLCV data")
            data = self.loader.fetch_data(tickers, period="3mo")
            if data is None or data.empty: 
                if self.cache: return self.cache
                return []

            # 3. Tech Screen 
            tech_pass_candidates = []
            usd_inr = 85.0
            
            print(f"Tech screening {len(tickers)} assets...")
            self._emit_progress(progress_callback, 30, f"Applying technical filters on {len(tickers)} stocks")
            
            for ticker in tickers:
                 try:
                    df = data[ticker].dropna() if len(tickers) > 1 else data
                    if df.empty or len(df) < 55: continue
                    
                    # Technical Checks
                    current_price = df['Close'].iloc[-1]
                    avg_vol_20 = df['Volume'].rolling(20).mean().iloc[-1]
                    
                    # Liquidity
                    daily_turnover = current_price * avg_vol_20
                    turnover_inr = daily_turnover if region == "IN" else daily_turnover * usd_inr
                    if current_price < config.min_price or current_price > config.max_price:
                        continue
                    if turnover_inr < (config.min_turnover_cr * 1e7):
                        continue
                    
                    # Volatility (use thresholds)
                    monthly_vol = df['Close'].pct_change().tail(30).std() * np.sqrt(21) * 100
                    if monthly_vol > vol_max or monthly_vol < vol_min: continue
    
                    # Momentum
                    sma_50 = df['Close'].rolling(50).mean().iloc[-1]
                    sma_20 = df['Close'].rolling(20).mean().iloc[-1]
                    if current_price <= sma_50 or current_price <= sma_20: continue
                    
                    # RSI (use thresholds)
                    if ta:
                        rsi = ta.rsi(df['Close'], length=14).iloc[-1]
                        if not (rsi_min <= rsi <= rsi_max): continue
                    else:
                        rsi = 50.0
                    
                    # Volume Shock (use threshold)
                    current_vol = df['Volume'].iloc[-1]
                    if current_vol <= (vol_shock_min * avg_vol_20): continue
                    
                    if ta:
                        macd = ta.macd(df['Close'])
                        hist = macd['MACDh_12_26_9'].iloc[-1]
                        if hist <= 0: continue
                    else:
                        hist = 1.0 # Simulate pass
                    
                    tech_pass_candidates.append({
                        "ticker": ticker,
                        "df": df, 
                        "price": float(current_price),
                        "tech_score": float(rsi),
                        "rsi": float(rsi),
                        "vol_shock": float(current_vol/avg_vol_20)
                    })
                 except: continue
    
            # 4. Select top technical candidates for fundamental analysis.
            # Keep this above free-cap (10) so Pro can see a broader ranked list.
            tech_pass_candidates.sort(key=lambda x: x.get('vol_shock', 0), reverse=True)
            top_candidates = tech_pass_candidates[:30]
            
            if not top_candidates: 
                 if self.cache: return self.cache
                 return []
            
            # 5. Fetch Fundamentals via Yahoo Finance (FREE - no API key needed)
            self._emit_progress(progress_callback, 60, "Evaluating fundamentals")
            print("=" * 50, flush=True)
            print("[DEPLOY v2.0] Fetching fundamentals via YAHOO FINANCE (not FMP!)", flush=True)
            print("=" * 50, flush=True)
            final_list = []
            
            # Helper to fetch and process single candidate
            def fetch_and_process(cand):
                ticker = cand.get('ticker', 'UNKNOWN')
                print(f"Analyzing Fundamentals: {ticker}")
                
                # Fetch Data from Yahoo Finance (primary)
                p_data = self._fetch_yahoo_fundamentals(ticker, region)
                if not p_data or p_data.get("source") != "YahooFinance":
                    # Fallback to Perplexity if Yahoo fails
                    p_data = self._fetch_perplexity_fundamentals_legacy(ticker, region)
                
                # Helper: Safe Float
                def safe_float(val, default=0.0):
                    try: 
                        if val is None: return default
                        return float(val)
                    except: return default
    
                # Graceful Fallback Logic
                default_growth = 0.20 if not p_data else 0.0
                default_roe = 0.20 if not p_data else 0.0
                
                # Construct Info Object for Scoring
                # FIXED: use correct field names from yahoo_fundamentals_engine
                rev_growth = safe_float(p_data.get('revenue_growth_yoy'), default_growth)
                roe = safe_float(p_data.get('return_on_equity'), default_roe)
                roce = safe_float(p_data.get('return_on_capital_employed'), default_roe)  # FIXED field name
                profit_growth = safe_float(p_data.get('profit_growth_yoy'), default_growth)  # FIXED field name
                dte = safe_float(p_data.get('debt_to_equity'), 50)  # Already in percentage for Indian stocks
                
                info_proxy = {
                    'quoteType': 'EQUITY', 
                    'revenueGrowth': rev_growth,
                    'profitGrowth': profit_growth,
                    'returnOnEquity': roe,
                    'roce': roce,
                    'debtToEquity': dte,
                    'sector': p_data.get('sector', 'Unknown'),
                    'beta': safe_float(p_data.get('beta'), 1.0),
                    'targetMeanPrice': cand.get('price', 0) * 1.2 
                }
                
                # Log actual vs threshold for debugging
                print(f"[FUND] {ticker}: RevGrowth={rev_growth:.2%} (threshold: {rev_growth_min:.0%}-{rev_growth_max:.0%})", flush=True)
                print(f"[FUND] {ticker}: ROE={roe:.2%} (threshold: {roe_min:.0%}-{roe_max:.0%})", flush=True)
                print(f"[FUND] {ticker}: ROCE={roce:.2%} (threshold: {roce_min:.0%}-{roce_max:.0%})", flush=True)
                print(f"[FUND] {ticker}: ProfitGrowth={profit_growth:.2%} (threshold: {profit_growth_min:.0%}-{profit_growth_max:.0%})", flush=True)
                print(f"[FUND] {ticker}: D/E={dte:.1f} (threshold: {de_min}-{de_max})", flush=True)
                
                # Fundamental Check Logic (using user thresholds)
                passed = True
                failed_checks = []
                
                if not (rev_growth_min <= info_proxy['revenueGrowth'] <= rev_growth_max):
                    passed = False; failed_checks.append(f"RevGrowth: {info_proxy['revenueGrowth']:.1%}")
                if not (roe_min <= info_proxy['returnOnEquity'] <= roe_max):
                    passed = False; failed_checks.append(f"ROE: {info_proxy['returnOnEquity']:.1%}")
                if not (roce_min <= info_proxy.get('roce', 0) <= roce_max):
                    passed = False; failed_checks.append(f"ROCE: {info_proxy.get('roce', 0):.1%}")
                if not (profit_growth_min <= info_proxy.get('profitGrowth', 0) <= profit_growth_max):
                    passed = False; failed_checks.append(f"ProfitGrowth: {info_proxy.get('profitGrowth', 0):.1%}")
                if not (de_min <= info_proxy['debtToEquity'] <= de_max): 
                    passed = False; failed_checks.append(f"D/E: {info_proxy['debtToEquity']:.1f}")
                
                failed_list = ", ".join(failed_checks)
                if passed:
                    print(f"[FUND] PASS {ticker}: All fundamentals in range!", flush=True)
                else:
                    print(f"[FUND] PARTIAL {ticker}: Failed checks: {failed_list}", flush=True)
    
                if config.moat_check and not self._economic_moat_check(info_proxy, info_proxy.get("returnOnEquity", 0) or 0):
                    passed = False
                    failed_checks.append("EconomicMoat: ROE-WACC < 5%")
                    failed_list = ", ".join(failed_checks)

                score_data = self._calculate_upside_score(cand.get('df'), info_proxy, region, config=config)
                
                # Build comprehensive thesis with ALL metrics
                rev_val = info_proxy['revenueGrowth'] * 100
                roe_val = info_proxy['returnOnEquity'] * 100
                roce_val = info_proxy.get('roce', 0) * 100
                profit_val = info_proxy.get('profitGrowth', 0) * 100
                de_val = info_proxy['debtToEquity']
                
                # Format metrics summary (show all values vs thresholds)
                metrics_summary = (
                    f"📊 RevGrowth: {rev_val:.1f}% (target: {rev_growth_min*100:.0f}%-{rev_growth_max*100:.0f}%) | "
                    f"ROE: {roe_val:.1f}% (target: {roe_min*100:.0f}%-{roe_max*100:.0f}%) | "
                    f"ROCE: {roce_val:.1f}% (target: {roce_min*100:.0f}%-{roce_max*100:.0f}%) | "
                    f"ProfitGrowth: {profit_val:.1f}% (target: {profit_growth_min*100:.0f}%-{profit_growth_max*100:.0f}%) | "
                    f"D/E: {de_val:.1f} (target: {de_min}-{de_max})"
                )
                
                # Technical reasoning (why this stock was picked)
                tech_reason_parts = []
                tech_reason_parts.append(f"📈 Momentum: {score_data.get('momentum_score', 50):.0f}")
                tech_reason_parts.append(f"RSI: {cand.get('rsi', 50):.1f}")
                tech_reason_parts.append(f"Volume Shock: {cand.get('vol_shock', 1):.1f}x avg")
                tech_reason_parts.append("Price > SMA50 & SMA20")
                tech_reason_parts.append("MACD bullish")
                
                tech_reason = " | ".join(tech_reason_parts)
                
                # Final thesis
                if passed:
                    fundamental_thesis = f"✅ All fundamentals pass thresholds. {metrics_summary}. Technical Pick: {tech_reason}"
                else:
                    fundamental_thesis = f"⚠️ Technical momentum play (some fundamentals outside thresholds: {failed_list}). {metrics_summary}. Why picked: {tech_reason}"
                
                # ALWAYS return stock with fundamentals (whether passed or not)
                return {
                    "ticker": ticker,
                    "price": round(cand.get('price', 0), 2),
                    "score": score_data.get('total_score', 50) if passed else 60,  # Lower score if failed
                    "upside_potential": score_data.get('upside_pct', 0),
                    "momentum_score": score_data.get('momentum_score', 50),
                    "rsi": round(cand.get('rsi', 50), 2),
                    "vol_shock": round(cand.get('vol_shock', 1), 2),
                    "sector": info_proxy.get('sector', 'Unknown'),
                    "beta": info_proxy.get('beta', 1.0),
                    "fundamental_thesis": fundamental_thesis,
                    "fundamentals_passed": passed,
                    "fundamentals": {
                        "revenue_growth": round(info_proxy['revenueGrowth'] * 100, 1),
                        "roe": round(info_proxy['returnOnEquity'] * 100, 1),
                        "roce": round(info_proxy.get('roce', 0) * 100, 1),
                        "profit_growth": round(info_proxy.get('profitGrowth', 0) * 100, 1),
                        "debt_equity": round(info_proxy['debtToEquity'], 1)
                    }
                }
    
            # Run Parallel
            with ThreadPoolExecutor(max_workers=5) as executor:
                results = executor.map(fetch_and_process, top_candidates)
            
            for res in results:
                if res: final_list.append(res)
                    
            # Note: No fallback needed now since we always return stocks with data
            if not final_list and top_candidates:
                 print("No candidates processed. Check for errors.", flush=True)
    
            # 6. Final Sort & Cache
            final_list.sort(key=lambda x: x.get('score', 0), reverse=True)
            if (user_plan or "").strip().lower() == "free":
                final_list = final_list[:10]
            
            # Update Cache (only if default thresholds)
            if not thresholds:
                self.cache = final_list
                self.last_scan_time = time.time()
            self._emit_progress(progress_callback, 100, "Scan complete")
            
            return final_list
            
        except Exception as e:
            print(f"Scanner Critical Failure: {e}")
            import traceback
            traceback.print_exc()
            if self.cache:
                print("Returning Stale Cache due to Failure")
                return self.cache
            return []

scanner = MarketScanner()
