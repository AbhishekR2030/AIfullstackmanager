
import yfinance as yf
import pandas as pd
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple
import math
try:
    import pandas_ta as ta
except ImportError:
    ta = None
import numpy as np
from app.engines.market_loader import market_loader
from app.engines.discovery_platform import (
    DataPlatformService,
    ExecutionSimulationService,
    MonitoringService,
    PortfolioAccountingService,
    RiskGuardService,
)
from app.engines.strategy_base import ScanRuntimeContext
from app.engines.strategies import StrategyRegistry
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
    # Backward-compatible aliases for older frontend IDs.
    "alphaseeker_core": ALPHASEEKER_CORE,
    "custom_trade": ALPHASEEKER_CORE,
    "janestreet_quant": JANE_STREET_STAT,
    "jane_street": JANE_STREET_STAT,
    "deshaw_quality": DE_SHAW_MULTIFACTOR,
    "de_shaw_quality": DE_SHAW_MULTIFACTOR,
    "custom": ALPHASEEKER_CORE,
}

class MarketScanner:
    def __init__(self):
        self.loader = market_loader
        self.data_platform = DataPlatformService(self.loader)
        self.risk_guard = RiskGuardService()
        self.execution_simulator = ExecutionSimulationService()
        self.portfolio_accounting = PortfolioAccountingService()
        self.monitoring = MonitoringService()
        self.strategy_registry = StrategyRegistry()
        self.cache = None
        self.last_scan_time = 0
        self.cache_by_key: Dict[str, Dict[str, Any]] = {}
        self.legacy_cache_context: Dict[str, Any] = {
            "region": "IN",
            "strategy": "core",
            "thresholds_empty": True,
        }
        self.last_scan_metadata: Dict[str, Any] = {}
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

    def _cache_key(self, region: str, strategy: str, thresholds: Optional[dict]) -> str:
        threshold_payload = thresholds or {}
        return json.dumps(
            {
                "region": (region or "IN").strip().upper(),
                "strategy": self.strategy_registry.normalize(strategy),
                "thresholds": threshold_payload,
            },
            sort_keys=True,
        )

    def _legacy_cache_matches(self, region: str, strategy: str, thresholds: Optional[dict]) -> bool:
        context = self.legacy_cache_context or {}
        return (
            bool(context.get("thresholds_empty", True))
            and bool(not (thresholds or {}))
            and str(context.get("region", "IN")).upper() == str(region or "IN").upper()
            and str(context.get("strategy", "core")).lower() == self.strategy_registry.normalize(strategy)
        )

    def get_supported_strategies(self) -> List[Dict[str, Any]]:
        return self.strategy_registry.to_payload()

    def get_strategy_payload(self, strategy: str) -> Dict[str, Any]:
        pipeline = self.strategy_registry.get(strategy)
        return {
            "strategy_id": pipeline.strategy_id,
            "strategy_label": pipeline.strategy_label,
            "strategy_tier": pipeline.strategy_tier,
            "strategy_summary": pipeline.strategy_summary,
            "strategy_logic": list(pipeline.strategy_logic),
        }

    def _resolve_scan_config(self, strategy: str = "core", thresholds: Optional[dict] = None) -> ScanConfig:
        normalized_strategy = self.strategy_registry.normalize(strategy)
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

    def _safe_float(self, value: Any, default: float = 0.0) -> float:
        """
        Ensures scanner outputs are JSON-serializable numeric values.
        Replaces NaN/Inf from upstream data providers with defaults.
        """
        try:
            if value is None:
                return float(default)
            parsed = float(value)
            if not math.isfinite(parsed):
                return float(default)
            return parsed
        except Exception:
            return float(default)

    def _economic_moat_check(self, info: dict, roe: float) -> bool:
        # Support both decimal (0.18) and percentage-style (18) ROE inputs.
        roe_decimal = float(roe)
        if roe_decimal > 1.0:
            roe_decimal = roe_decimal / 100.0
        beta = info.get("beta", 1.0) or 1.0
        wacc = 0.6 * (0.073 + beta * 0.06) + 0.4 * (0.09 * 0.75)
        return (roe_decimal - wacc) >= 0.05

    def _composite_upside_score(self, metrics: dict, config: ScanConfig) -> float:
        rsi = self._safe_float(metrics.get("rsi", 50.0), 50.0)
        macd_hist = self._safe_float(metrics.get("macd_hist", 0.0), 0.0)
        roe = self._safe_float(metrics.get("roe", 0.0), 0.0)
        rev_growth = self._safe_float(metrics.get("rev_growth", 0.0), 0.0)
        pe = self._safe_float(metrics.get("pe_ratio", 0.0), 0.0)
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

    def _calculate_upside_score(
        self,
        df,
        info,
        region="IN",
        config: Optional[ScanConfig] = None,
        pipeline=None,
        context: Optional[ScanRuntimeContext] = None,
        features: Optional[Dict[str, Any]] = None,
    ):
        """
        Stage 4: Scoring Engine (0-100)
        """
        try:
            cfg = config or ALPHASEEKER_CORE
            feature_map = dict(features or {})
            if ta and not feature_map:
                rsi = self._safe_float(ta.rsi(df['Close'], length=14).iloc[-1], 50.0)
                macd = ta.macd(df['Close'])
                macd_hist = self._safe_float(macd['MACDh_12_26_9'].iloc[-1], 0.0)
                feature_map.update({"rsi": rsi, "macd_hist": macd_hist})
            else:
                rsi = self._safe_float(feature_map.get("rsi"), 50.0)
                macd_hist = self._safe_float(feature_map.get("macd_hist"), 0.0)
            
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

            current_price = self._safe_float(feature_map.get("current_price"), self._safe_float(df['Close'].iloc[-1], 0.0))
            runtime_context = context or ScanRuntimeContext(
                region=(region or "IN").strip().upper(),
                strategy_id=getattr(pipeline, "strategy_id", "core"),
                thresholds={},
                user_plan="pro",
                volatility_min=3.0,
                volatility_max=8.0,
            )
            projector = getattr(pipeline, "project_target", None)
            projection = (
                projector(current_price, feature_map, info, runtime_context, cfg)
                if callable(projector)
                else self.strategy_registry.get("core").project_target(current_price, feature_map, info, runtime_context, cfg)
            )

            upside_pct = self._safe_float(getattr(projection, "upside_pct", 0.0), 0.0)
            val_score = self._safe_float(getattr(projection, "valuation_score", np.clip(upside_pct * 500, 0, 100)), 0.0)
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
                "momentum_score": round(mom_score, 1),
                "target_price": round(self._safe_float(getattr(projection, "target_price", current_price), current_price), 2),
                "target_source": getattr(projection, "source", "strategy_model"),
                "target_model": getattr(projection, "model_name", f"{getattr(pipeline, 'strategy_id', 'core')}_target_model"),
            }
            
        except:
            return {
                "total_score": 50.0,
                "upside_pct": 0.0,
                "momentum_score": 50.0,
                "target_price": 0.0,
                "target_source": "unavailable",
                "target_model": "unavailable",
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
        Main scanner entrypoint using shared platform layers + strategy pipelines.
        """
        thresholds = thresholds or {}
        normalized_strategy = self.strategy_registry.normalize(strategy)
        config = self._resolve_scan_config(strategy=normalized_strategy, thresholds=thresholds)
        pipeline = self.strategy_registry.get(normalized_strategy)

        vol_min = float((thresholds.get("technical", {}) or {}).get("volatility_min", 3))
        vol_max = float((thresholds.get("technical", {}) or {}).get("volatility_max", 8))

        runtime_context = ScanRuntimeContext(
            region=(region or "IN").strip().upper(),
            strategy_id=pipeline.strategy_id,
            thresholds=thresholds,
            user_plan=(user_plan or "pro").strip().lower(),
            volatility_min=vol_min,
            volatility_max=vol_max,
        )

        cache_key = self._cache_key(runtime_context.region, normalized_strategy, thresholds if thresholds else None)
        now = time.time()

        if not thresholds:
            cache_entry = self.cache_by_key.get(cache_key)
            if cache_entry and (now - float(cache_entry.get("timestamp", 0)) < self.CACHE_DURATION):
                cached_results = cache_entry.get("results", [])
                if runtime_context.user_plan == "free":
                    return list(cached_results)[:10]
                return list(cached_results)

            # Backward compatibility for legacy single-cache usage and tests.
            if (
                self.cache
                and (now - self.last_scan_time < self.CACHE_DURATION)
                and self._legacy_cache_matches(runtime_context.region, normalized_strategy, thresholds)
            ):
                print("Returning Cached Scan Results (legacy cache path)")
                if runtime_context.user_plan == "free":
                    return list(self.cache)[:10]
                return list(self.cache)

        print(
            f"Starting Scan ({runtime_context.region}) with strategy={pipeline.strategy_id} "
            f"RSI={config.rsi_min}-{config.rsi_max}, Vol={vol_min}-{vol_max}%..."
        )

        telemetry = self.monitoring.start_scan(strategy_id=pipeline.strategy_id, region=runtime_context.region)
        telemetry.increment("strategy_runs", 1)

        rev_growth_min = config.rev_growth_min / 100.0
        rev_growth_max = config.rev_growth_max / 100.0
        profit_growth_min = config.profit_growth_min / 100.0
        profit_growth_max = config.profit_growth_max / 100.0
        roe_min = config.roe_min / 100.0
        roe_max = 1.0
        roce_min = config.roce_min / 100.0
        roce_max = 1.0
        de_min = 0.0
        de_max = config.max_debt_equity

        try:
            self._emit_progress(progress_callback, 5, "Loading market universe")
            tickers = self.data_platform.load_universe(runtime_context.region)
            telemetry.increment("total_screened", len(tickers))

            self._emit_progress(progress_callback, 15, "Fetching OHLCV data")
            data = self.data_platform.fetch_ohlcv(tickers, period="3mo")
            if data is None or getattr(data, "empty", True):
                if self.cache and self._legacy_cache_matches(runtime_context.region, normalized_strategy, thresholds):
                    return list(self.cache)[:10] if runtime_context.user_plan == "free" else list(self.cache)
                return []

            self._emit_progress(progress_callback, 30, f"Applying technical filters on {len(tickers)} stocks")
            tech_pass_candidates: List[Dict[str, Any]] = []

            for ticker in tickers:
                try:
                    df = data[ticker].dropna() if len(tickers) > 1 else data.dropna()
                    if df.empty or len(df) < 55:
                        telemetry.increment("rejected_short_history", 1)
                        continue

                    features = pipeline.compute_technical_features(df, runtime_context)
                    if not features:
                        telemetry.increment("rejected_feature_compute", 1)
                        continue

                    rsi = 50.0
                    macd_hist = 1.0
                    rsi_slope_5 = 0.0
                    if ta:
                        rsi_series = ta.rsi(df["Close"], length=14)
                        if rsi_series is not None and not rsi_series.empty and pd.notna(rsi_series.iloc[-1]):
                            rsi = float(rsi_series.iloc[-1])
                        if rsi_series is not None and len(rsi_series.dropna()) >= 6:
                            rsi_slope_5 = float(rsi_series.dropna().iloc[-1] - rsi_series.dropna().iloc[-6])

                        macd_df = ta.macd(df["Close"])
                        if macd_df is not None and "MACDh_12_26_9" in macd_df and pd.notna(macd_df["MACDh_12_26_9"].iloc[-1]):
                            macd_hist = float(macd_df["MACDh_12_26_9"].iloc[-1])

                    features.update(
                        {
                            "rsi": rsi,
                            "macd_hist": macd_hist,
                            "rsi_slope_5": rsi_slope_5,
                        }
                    )

                    liquidity_ok, liquidity_reason, liquidity_metrics = self.risk_guard.evaluate_liquidity(
                        features, config, runtime_context.region
                    )
                    if not liquidity_ok:
                        telemetry.increment(f"rejected_{liquidity_reason}", 1)
                        continue

                    features.update(liquidity_metrics)
                    if not pipeline.technical_filter(features, runtime_context, config):
                        telemetry.increment("rejected_strategy_technical", 1)
                        continue

                    tech_pass_candidates.append(
                        {
                            "ticker": ticker,
                            "df": df,
                            "price": round(float(features.get("current_price", 0.0)), 2),
                            "rsi": round(rsi, 2),
                            "vol_shock": round(float(features.get("vol_shock", 0.0)), 2),
                            "features": features,
                            "region": runtime_context.region,
                        }
                    )
                except Exception:
                    telemetry.increment("technical_processing_errors", 1)
                    continue

            telemetry.increment("technical_passed", len(tech_pass_candidates))
            top_candidates = self.execution_simulator.select_fundamental_candidates(tech_pass_candidates, limit=30)

            if not top_candidates:
                if self.cache and self._legacy_cache_matches(runtime_context.region, normalized_strategy, thresholds):
                    return list(self.cache)[:10] if runtime_context.user_plan == "free" else list(self.cache)
                return []

            self._emit_progress(progress_callback, 60, "Evaluating fundamentals")
            final_list: List[Dict[str, Any]] = []

            def fetch_and_process(candidate: Dict[str, Any]) -> Optional[Dict[str, Any]]:
                ticker = candidate.get("ticker", "UNKNOWN")
                print(f"Analyzing Fundamentals: {ticker}", flush=True)

                p_data = self._fetch_yahoo_fundamentals(ticker, runtime_context.region)
                if not p_data or p_data.get("source") != "YahooFinance":
                    p_data = self._fetch_perplexity_fundamentals_legacy(ticker, runtime_context.region)

                def safe_float(value: Any, default: float = 0.0) -> float:
                    return self._safe_float(value, default)

                default_growth = 0.20 if not p_data else 0.0
                default_roe = 0.20 if not p_data else 0.0

                rev_growth = safe_float(p_data.get("revenue_growth_yoy"), default_growth)
                roe = safe_float(p_data.get("return_on_equity"), default_roe)
                roce = safe_float(p_data.get("return_on_capital_employed"), default_roe)
                profit_growth = safe_float(p_data.get("profit_growth_yoy"), default_growth)
                debt_to_equity = safe_float(p_data.get("debt_to_equity"), 50.0)
                trailing_pe = safe_float(
                    p_data.get("trailing_pe", p_data.get("trailingPE", p_data.get("pe_ratio", 0.0))),
                    0.0,
                )

                info_proxy = {
                    "quoteType": "EQUITY",
                    "revenueGrowth": rev_growth,
                    "profitGrowth": profit_growth,
                    "returnOnEquity": roe,
                    "roce": roce,
                    "debtToEquity": debt_to_equity,
                    "sector": p_data.get("sector", "Unknown"),
                    "beta": safe_float(p_data.get("beta"), 1.0),
                    "targetMeanPrice": safe_float(
                        p_data.get("target_mean_price", p_data.get("targetMeanPrice", 0.0)),
                        0.0,
                    ),
                    "trailingPE": trailing_pe,
                    "forwardPE": safe_float(p_data.get("forward_pe", p_data.get("forwardPE", 0.0)), 0.0),
                    "pegRatio": safe_float(p_data.get("peg_ratio", p_data.get("pegRatio", 0.0)), 0.0),
                }

                fundamentals_passed, failed_checks = pipeline.evaluate_fundamentals(
                    info_proxy,
                    runtime_context,
                    config,
                )

                moat_failed = False
                if config.moat_check and not self._economic_moat_check(info_proxy, info_proxy.get("returnOnEquity", 0) or 0):
                    fundamentals_passed = False
                    moat_failed = True
                    failed_checks.append("EconomicMoat: ROE-WACC < 5%")

                score_data = self._calculate_upside_score(
                    candidate.get("df"),
                    info_proxy,
                    runtime_context.region,
                    config=config,
                    pipeline=pipeline,
                    context=runtime_context,
                    features=candidate.get("features", {}),
                )
                adjusted_score = pipeline.adjust_score(
                    score_data.get("total_score", 50.0),
                    candidate.get("features", {}),
                    info_proxy,
                    fundamentals_passed,
                    runtime_context,
                    config,
                )

                execution_estimate = self.execution_simulator.estimate_execution(
                    candidate.get("features", {}),
                    runtime_context.region,
                )
                risk_flags = self.risk_guard.build_risk_flags(
                    candidate.get("features", {}),
                    info_proxy,
                    fundamentals_passed,
                    failed_checks,
                    execution_estimate,
                    moat_failed=moat_failed,
                )

                rev_val = self._safe_float(info_proxy["revenueGrowth"], 0.0) * 100
                roe_val = self._safe_float(info_proxy["returnOnEquity"], 0.0) * 100
                roce_val = self._safe_float(info_proxy.get("roce", 0), 0.0) * 100
                profit_val = self._safe_float(info_proxy.get("profitGrowth", 0), 0.0) * 100
                debt_val = self._safe_float(info_proxy["debtToEquity"], 0.0)

                metrics_summary = (
                    f"RevGrowth: {rev_val:.1f}% ({rev_growth_min*100:.0f}%–{rev_growth_max*100:.0f}%) | "
                    f"ROE: {roe_val:.1f}% ({roe_min*100:.0f}%–{roe_max*100:.0f}%) | "
                    f"ROCE: {roce_val:.1f}% ({roce_min*100:.0f}%–{roce_max*100:.0f}%) | "
                    f"ProfitGrowth: {profit_val:.1f}% ({profit_growth_min*100:.0f}%–{profit_growth_max*100:.0f}%) | "
                    f"D/E: {debt_val:.1f} ({de_min:.0f}–{de_max:.0f})"
                )

                technical_reason = pipeline.build_technical_reason(candidate.get("features", {}), runtime_context)
                failed_label = ", ".join(failed_checks)
                if fundamentals_passed:
                    fundamental_thesis = f"All fundamentals pass thresholds. {metrics_summary}. {technical_reason}"
                else:
                    fundamental_thesis = (
                        "Momentum setup with selective fundamental misses "
                        f"({failed_label if failed_label else 'none noted'}). "
                        f"{metrics_summary}. {technical_reason}"
                    )

                return {
                    "ticker": ticker,
                    "price": round(self._safe_float(candidate.get("price", 0.0), 0.0), 2),
                    "score": round(self._safe_float(adjusted_score, 0.0), 2),
                    "upside_potential": self._safe_float(score_data.get("upside_pct", 0), 0.0),
                    "target_price": self._safe_float(score_data.get("target_price", 0), 0.0),
                    "target_source": score_data.get("target_source", "strategy_model"),
                    "target_model": score_data.get("target_model", f"{pipeline.strategy_id}_target_model"),
                    "momentum_score": self._safe_float(score_data.get("momentum_score", 50), 50.0),
                    "rsi": round(self._safe_float(candidate.get("rsi", 50.0), 50.0), 2),
                    "vol_shock": round(self._safe_float(candidate.get("vol_shock", 1.0), 1.0), 2),
                    "sector": info_proxy.get("sector", "Unknown"),
                    "beta": self._safe_float(info_proxy.get("beta", 1.0), 1.0),
                    "fundamental_thesis": fundamental_thesis,
                    "fundamentals_passed": fundamentals_passed,
                    "fundamentals": {
                        "revenue_growth": round(self._safe_float(info_proxy["revenueGrowth"], 0.0) * 100, 1),
                        "roe": round(self._safe_float(info_proxy["returnOnEquity"], 0.0) * 100, 1),
                        "roce": round(self._safe_float(info_proxy.get("roce", 0), 0.0) * 100, 1),
                        "profit_growth": round(self._safe_float(info_proxy.get("profitGrowth", 0), 0.0) * 100, 1),
                        "debt_equity": round(self._safe_float(info_proxy["debtToEquity"], 0.0), 1),
                    },
                    "strategy_id": pipeline.strategy_id,
                    "strategy_label": pipeline.strategy_label,
                    "strategy_summary": pipeline.strategy_summary,
                    "strategy_tier": pipeline.strategy_tier,
                    "alpha_rationale": {
                        "technical": technical_reason,
                        "fundamental": "All fundamental checks passed"
                        if fundamentals_passed
                        else f"Failed checks: {failed_label if failed_label else 'Not specified'}",
                    },
                    "risk_flags": risk_flags,
                    "execution": execution_estimate,
                }

            with ThreadPoolExecutor(max_workers=5) as executor:
                results = executor.map(fetch_and_process, top_candidates)

            for result in results:
                if result:
                    final_list.append(result)

            final_list.sort(key=lambda stock: stock.get("score", 0), reverse=True)
            telemetry.increment("total_passed", len(final_list))
            self.portfolio_accounting.attach_portfolio_context(final_list)

            if runtime_context.user_plan == "free":
                final_list = final_list[:10]

            if not thresholds:
                cache_timestamp = time.time()
                cache_entry = {
                    "results": list(final_list),
                    "timestamp": cache_timestamp,
                    "strategy_id": pipeline.strategy_id,
                }
                self.cache_by_key[cache_key] = cache_entry
                self.cache = list(final_list)
                self.legacy_cache_context = {
                    "region": runtime_context.region,
                    "strategy": pipeline.strategy_id,
                    "thresholds_empty": True,
                }
                self.last_scan_time = cache_timestamp

            self.last_scan_metadata = self.monitoring.finalize_scan(telemetry)
            self._emit_progress(progress_callback, 100, "Scan complete")
            return final_list

        except Exception as e:
            print(f"Scanner Critical Failure: {e}")
            import traceback
            traceback.print_exc()
            telemetry.add_note(f"critical_failure: {e}")
            self.last_scan_metadata = self.monitoring.finalize_scan(telemetry)
            if self.cache and self._legacy_cache_matches(runtime_context.region, normalized_strategy, thresholds):
                print("Returning Stale Cache due to Failure")
                return list(self.cache)[:10] if runtime_context.user_plan == "free" else list(self.cache)
            return []

scanner = MarketScanner()
