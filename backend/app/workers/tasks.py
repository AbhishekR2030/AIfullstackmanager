"""
Celery Worker Tasks for Discovery Module
Async background processing for market scanning
"""

import gc
import json
import time
import redis
import yfinance as yf
import pandas as pd
try:
    import pandas_ta as ta
except ImportError:
    ta = None
import numpy as np
from typing import List, Dict, Any, Optional
from celery import group, chain, chord
from celery.exceptions import MaxRetriesExceededError
import os

from app.core.celery_app import celery_app
from app.engines.market_loader import market_loader
from app.engines.scanner_engine import scanner as market_scanner
from app.engines.strategy_base import ScanRuntimeContext
from app.engines.strategies.core import CoreStrategyPipeline

# Redis client for progress tracking
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Handle Render's Redis TLS connection
if REDIS_URL.startswith("rediss://"):
    # For TLS connections (Render), disable certificate verification
    redis_client = redis.from_url(REDIS_URL, ssl_cert_reqs=None)
else:
    redis_client = redis.from_url(REDIS_URL)


# ============================================================================
# TASK 1: Fetch Batch Data (with retry mechanism)
# ============================================================================
@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=5,  # 5 second exponential backoff
    retry_kwargs={"max_retries": 3},
    retry_jitter=True
)
def fetch_batch_data(self, tickers: List[str], batch_id: int, job_id: str) -> Dict[str, Any]:
    """
    Fetch OHLCV data for a batch of tickers.
    
    Args:
        tickers: List of ticker symbols (max 50)
        batch_id: Batch number for tracking
        job_id: Parent job ID for progress updates
        
    Returns:
        Dictionary with ticker data in JSON-serializable format
    """
    try:
        # Update progress
        update_progress(job_id, f"Fetching batch {batch_id}...", batch_id * 5)
        
        # Fetch data from Yahoo Finance
        data = yf.download(
            tickers, 
            period="3mo", 
            group_by='ticker', 
            progress=False, 
            threads=True
        )
        
        if data is None or data.empty:
            return {"batch_id": batch_id, "data": {}, "error": "No data returned"}
        
        # Convert to JSON-serializable format
        result = {"batch_id": batch_id, "data": {}}
        
        if len(tickers) == 1:
            # Single ticker - different structure
            ticker = tickers[0]
            if not data.empty:
                result["data"][ticker] = {
                    "Close": data["Close"].dropna().tolist(),
                    "Volume": data["Volume"].dropna().tolist(),
                    "dates": [str(d.date()) for d in data.index]
                }
        else:
            # Multiple tickers
            for ticker in tickers:
                try:
                    ticker_data = data[ticker].dropna()
                    if not ticker_data.empty and len(ticker_data) >= 55:
                        result["data"][ticker] = {
                            "Close": ticker_data["Close"].tolist(),
                            "Volume": ticker_data["Volume"].tolist(),
                            "dates": [str(d.date()) for d in ticker_data.index]
                        }
                except Exception as e:
                    print(f"Error extracting {ticker}: {e}")
                    continue
        
        # Rate limiting - respect Yahoo Finance limits
        time.sleep(2)
        
        # Memory cleanup
        del data
        gc.collect()
        
        return result
        
    except Exception as e:
        print(f"Batch {batch_id} fetch error: {e}")
        raise  # Let Celery retry


# ============================================================================
# TASK 2: Compute Technical Indicators
# ============================================================================
@celery_app.task(bind=True)
def compute_technicals(self, batch_result: Dict[str, Any], job_id: str) -> List[Dict[str, Any]]:
    """
    Compute technical indicators for a batch of ticker data.
    
    Args:
        batch_result: Result from fetch_batch_data containing OHLCV data
        job_id: Parent job ID for progress updates
        
    Returns:
        List of stocks passing technical screening with scores
    """
    batch_id = batch_result.get("batch_id", 0)
    data = batch_result.get("data", {})
    
    if not data:
        return []
    
    update_progress(job_id, f"Computing technicals for batch {batch_id}...", 50 + batch_id * 5)
    
    passed_stocks = []
    usd_inr = 85.0
    
    for ticker, ticker_data in data.items():
        try:
            closes = pd.Series(ticker_data["Close"])
            volumes = pd.Series(ticker_data["Volume"])
            
            if len(closes) < 55:
                continue
            
            current_price = closes.iloc[-1]
            avg_vol_20 = volumes.rolling(20).mean().iloc[-1]
            
            # Liquidity Check
            daily_turnover = current_price * avg_vol_20
            turnover_usd = daily_turnover / usd_inr
            if turnover_usd < 1_000_000:
                continue
            
            # Volatility Check
            monthly_vol = closes.pct_change().tail(30).std() * np.sqrt(21) * 100
            if monthly_vol > 8.0 or monthly_vol < 3.0:
                continue
            
            # Momentum: Price > SMA-50 and SMA-20
            sma_50 = closes.rolling(50).mean().iloc[-1]
            sma_20 = closes.rolling(20).mean().iloc[-1]
            if current_price <= sma_50 or current_price <= sma_20:
                continue
            
            # RSI Check (50 <= RSI <= 70)
            if ta:
                rsi = ta.rsi(closes, length=14).iloc[-1]
                if not (50 <= rsi <= 70):
                    continue
            else:
                rsi = 50.0
            
            # Volume Shock Check
            current_vol = volumes.iloc[-1]
            if current_vol <= (1.5 * avg_vol_20):
                continue
            
            # MACD Check
            if ta:
                macd = ta.macd(closes)
                hist = macd['MACDh_12_26_9'].iloc[-1]
                if hist <= 0:
                    continue
            else:
                hist = 1.0
            
            # Stock passed all filters
            passed_stocks.append({
                "ticker": ticker,
                "price": round(float(current_price), 2),
                "rsi": round(float(rsi), 2),
                "vol_shock": round(float(current_vol / avg_vol_20), 2),
                "tech_score": round(float(rsi), 2)
            })
            
        except Exception as e:
            print(f"Technical analysis error for {ticker}: {e}")
            continue
    
    # Memory cleanup
    gc.collect()
    
    return passed_stocks


# ============================================================================
# TASK 3: Master Scan Workflow (Orchestrator)
# ============================================================================
@celery_app.task(bind=True)
def master_scan_workflow(
    self,
    region: str = "IN",
    strategy: str = "core",
    thresholds: Optional[Dict[str, Any]] = None,
    user_plan: str = "pro",
) -> Dict[str, Any]:
    """
    Main orchestrator task that splits work into parallel batches.
    
    Args:
        region: Market region ("IN" for India, "US" for US)
        
    Returns:
        Final scan results with top stocks
    """
    job_id = self.request.id
    
    try:
        # Use scanner_engine's progress callback contract so sync/async scans behave consistently.
        update_progress(job_id, "Starting market scan...", 0)

        def _progress(percent: int, message: str):
            update_progress(job_id, message, percent)

        final_results = market_scanner.scan_market(
            region=region,
            thresholds=thresholds or {},
            strategy=strategy,
            user_plan=user_plan,
            progress_callback=_progress,
        )

        update_progress(job_id, "Scan complete!", 100)

        redis_client.setex(
            f"scan_results_{job_id}",
            3600,
            json.dumps(final_results),
        )

        return {
            "status": "SUCCESS",
            "job_id": job_id,
            "strategy": strategy,
            "count": len(final_results),
            "results": final_results,
        }
        
    except Exception as e:
        update_progress(job_id, f"Scan failed: {str(e)}", -1)
        return {
            "status": "FAILURE",
            "job_id": job_id,
            "error": str(e)
        }


# ============================================================================
# Helper Functions
# ============================================================================
def update_progress(job_id: str, message: str, percent: int):
    """Update scan progress in Redis."""
    redis_client.setex(
        f"scan_progress_{job_id}",
        3600,  # 1 hour expiry
        json.dumps({
            "message": message,
            "percent": percent,
            "timestamp": time.time()
        })
    )


def calculate_upside_score(cand: Dict[str, Any]) -> Dict[str, float]:
    """Calculate upside score for a candidate stock."""
    try:
        pipeline = CoreStrategyPipeline()
        current_price = float(cand.get("price", 0.0) or 0.0)
        features = {
            "current_price": current_price,
            "rsi": float(cand.get("rsi", 50.0) or 50.0),
            "macd_hist": float(cand.get("macd_hist", 1.0) or 1.0),
            "vol_shock": float(cand.get("vol_shock", 1.0) or 1.0),
            "monthly_vol": float(cand.get("monthly_vol", 6.0) or 6.0),
            "sma_20": float(cand.get("sma_20", current_price) or current_price),
            "sma_50": float(cand.get("sma_50", current_price) or current_price),
            "rsi_slope_5": float(cand.get("rsi_slope_5", 0.0) or 0.0),
        }
        info_proxy = {
            "quoteType": "EQUITY",
            "revenueGrowth": float(cand.get("revenue_growth", 0.0) or 0.0),
            "profitGrowth": float(cand.get("profit_growth", 0.0) or 0.0),
            "returnOnEquity": float(cand.get("roe", 0.0) or 0.0),
            "roce": float(cand.get("roce", cand.get("roe", 0.0)) or 0.0),
            "debtToEquity": float(cand.get("debt_to_equity", 0.0) or 0.0),
            "beta": float(cand.get("beta", 1.0) or 1.0),
            "trailingPE": float(cand.get("trailing_pe", 0.0) or 0.0),
            "forwardPE": float(cand.get("forward_pe", 0.0) or 0.0),
            "pegRatio": float(cand.get("peg_ratio", 0.0) or 0.0),
            "targetMeanPrice": float(cand.get("target_mean_price", 0.0) or 0.0),
        }
        projection = pipeline.project_target(
            current_price=current_price,
            features=features,
            info_proxy=info_proxy,
            context=ScanRuntimeContext(
                region="IN",
                strategy_id="core",
                thresholds={},
                user_plan="pro",
                volatility_min=3.0,
                volatility_max=8.0,
            ),
            config=market_scanner._resolve_scan_config(strategy="core", thresholds={}),
        )

        rsi_score = np.clip((features["rsi"] - 50) * 5, 0, 100)
        macd_score = 100 if features["macd_hist"] > 0 else 0
        mom_score = (rsi_score * 0.7) + (macd_score * 0.3)
        quality = 70.0 if info_proxy["quoteType"] == "ETF" else np.clip(
            (info_proxy["revenueGrowth"] * 500 * 0.5) + (info_proxy["returnOnEquity"] * 400 * 0.5),
            0,
            100,
        )
        total_score = (quality * 0.4) + (mom_score * 0.3) + (projection.valuation_score * 0.3)

        return {
            "total_score": round(float(total_score), 2),
            "upside_pct": round(float(projection.upside_pct) * 100, 1),
            "momentum_score": round(float(mom_score), 1),
            "target_price": round(float(projection.target_price), 2),
            "target_source": projection.source,
            "target_model": projection.model_name,
        }
        
    except Exception:
        return {
            "total_score": 50.0,
            "upside_pct": 0.0,
            "momentum_score": 50.0,
            "target_price": 0.0,
            "target_source": "unavailable",
            "target_model": "unavailable",
        }


def get_scan_progress(job_id: str) -> Optional[Dict[str, Any]]:
    """Get current scan progress from Redis."""
    data = redis_client.get(f"scan_progress_{job_id}")
    if data:
        return json.loads(data)
    return None


def get_scan_results(job_id: str) -> Optional[List[Dict[str, Any]]]:
    """Get scan results from Redis."""
    data = redis_client.get(f"scan_results_{job_id}")
    if data:
        return json.loads(data)
    return None
