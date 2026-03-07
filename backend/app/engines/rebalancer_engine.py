
from datetime import datetime, timedelta
import pandas as pd
from typing import Dict, Optional, Tuple
try:
    import pandas_ta as ta
except ImportError:
    ta = None
import yfinance as yf
import numpy as np
from app.engines.scanner_engine import ALPHASEEKER_CORE
from app.engines.strategies.core import CoreStrategyPipeline
from app.engines.strategy_base import ScanRuntimeContext


class RebalancerEngine:
    def _candidate_score(self, candidate) -> float:
        if not isinstance(candidate, dict):
            return 0.0
        return float(candidate.get("score", candidate.get("upside_score", 0)) or 0)

    def compute_sell_urgency(self, holding, market_data, top_scan_score=None):
        """
        Composite sell urgency score (0-100) using 4 weighted signals.
        Signal 2 is skipped and remaining signals are re-weighted if top_scan_score is missing.
        """
        try:
            signal_points = {}
            signal_max = {
                "momentum_deterioration": 25,
                "better_opportunity": 30,
                "fundamental_weakening": 25,
                "stoploss_trailing": 20,
            }

            # Signal 1: Momentum deterioration (max 25, includes MACD bonus with cap)
            rsi = float(market_data.get("rsi", 50) or 50)
            macd_hist = float(market_data.get("macd_hist", 0) or 0)
            momentum_points = 0
            if rsi < 35:
                momentum_points = 25
            elif rsi < 45:
                momentum_points = 15
            elif rsi < 50:
                momentum_points = 5
            if macd_hist < 0:
                momentum_points = min(25, momentum_points + 10)
            signal_points["momentum_deterioration"] = momentum_points

            # Signal 2: Better opportunity available (max 30, optional)
            current_score = float(market_data.get("asset_score", holding.get("score", 0)) or 0)
            if top_scan_score is None:
                signal_points["better_opportunity"] = None
            else:
                gap = float(top_scan_score) - current_score
                if gap >= 25:
                    signal_points["better_opportunity"] = 30
                elif gap >= 15:
                    signal_points["better_opportunity"] = 18
                elif gap >= 8:
                    signal_points["better_opportunity"] = 8
                else:
                    signal_points["better_opportunity"] = 0

            # Signal 3: Fundamental weakening (max 25)
            roe_purchase = market_data.get("roe_purchase")
            roe_current = market_data.get("roe_current")
            rev_growth = float(market_data.get("rev_growth", 0) or 0)
            fundamental_points = 0
            if roe_purchase is not None and roe_current is not None:
                try:
                    roe_purchase = float(roe_purchase)
                    roe_current = float(roe_current)
                    if roe_purchase > 0 and roe_current <= (roe_purchase * 0.8):
                        fundamental_points += 20
                except Exception:
                    pass
            if rev_growth < 0:
                fundamental_points += 15
            elif rev_growth < 0.05:
                fundamental_points += 5
            signal_points["fundamental_weakening"] = min(25, fundamental_points)

            # Signal 4: Stop-loss / trailing stop (max 20)
            drawdown_from_buy = float(market_data.get("drawdown_from_buy", 0) or 0)
            if drawdown_from_buy >= 15:
                stop_points = 20
            elif drawdown_from_buy >= 8:
                stop_points = 12
            elif drawdown_from_buy >= 5:
                stop_points = 6
            else:
                stop_points = 0
            signal_points["stoploss_trailing"] = stop_points

            used_signals = {k: v for k, v in signal_points.items() if v is not None}
            raw_score = float(sum(used_signals.values()))
            available_max = float(sum(signal_max[k] for k in used_signals.keys()))
            score = int(round((raw_score / available_max) * 100)) if available_max > 0 else 0
            score = max(0, min(100, score))

            dominant_key = max(used_signals, key=lambda k: used_signals[k]) if used_signals else "momentum_deterioration"
            signal_labels = {
                "momentum_deterioration": "Momentum deterioration",
                "better_opportunity": "Better opportunity available",
                "fundamental_weakening": "Fundamental weakening",
                "stoploss_trailing": "Stop-loss / trailing stop",
            }

            if score >= 70:
                badge = "SELL"
            elif score >= 45:
                badge = "REVIEW"
            elif score >= 20:
                badge = "WATCH"
            else:
                badge = "HOLD"

            return {
                "score": score,
                "primary_signal": signal_labels.get(dominant_key, "Momentum deterioration"),
                "badge": badge,
            }
        except Exception:
            return {"score": 0, "primary_signal": "Insufficient data", "badge": "HOLD"}

    def _build_market_data(self, df, info, holding):
        market_data = {
            "rsi": 50.0,
            "macd_hist": 0.0,
            "roe_current": info.get("returnOnEquity", None) if isinstance(info, dict) else None,
            "roe_purchase": holding.get("roe_at_buy", None),
            "rev_growth": info.get("revenueGrowth", 0.0) if isinstance(info, dict) else 0.0,
            "asset_score": holding.get("score", 0),
            "drawdown_from_buy": 0.0,
        }
        try:
            if df is not None and not df.empty and ta:
                market_data["rsi"] = float(ta.rsi(df["Close"], length=14).iloc[-1])
                macd = ta.macd(df["Close"])
                market_data["macd_hist"] = float(macd["MACDh_12_26_9"].iloc[-1])
            buy_price = float(holding.get("buy_price", 0) or 0)
            current_price = float(holding.get("current_price", 0) or 0)
            if buy_price > 0 and current_price > 0 and current_price < buy_price:
                market_data["drawdown_from_buy"] = ((buy_price - current_price) / buy_price) * 100
        except Exception:
            pass
        return market_data

    def get_rebalancing_suggestions(self, user_email, db=None, redis=None):
        from app.engines.portfolio_engine import portfolio_manager

        portfolio = portfolio_manager.get_portfolio(user_email)
        scan_results = None
        if redis is not None:
            try:
                raw = redis.get(f"scan_results:{user_email}")
                if raw:
                    import json as _json
                    scan_results = _json.loads(raw)
            except Exception:
                scan_results = None

        if scan_results is None:
            from app.engines.scanner_engine import scanner
            scan_results = scanner.cache or []

        top_scan_score = None
        if isinstance(scan_results, list) and scan_results:
            sorted_scan = sorted(scan_results, key=self._candidate_score, reverse=True)
            top_scan_score = self._candidate_score(sorted_scan[0])
        else:
            sorted_scan = []

        analyzed = self.analyze_portfolio(portfolio, new_candidates=sorted_scan or scan_results)
        sell_candidates = [h for h in analyzed if h.get("sell_urgency_score", 0) >= 60]
        buy_recommendations = [
            c for c in (sorted_scan or scan_results or [])
            if c.get("ticker") not in {h.get("ticker") for h in portfolio}
        ]

        sell_sorted = sorted(sell_candidates, key=lambda x: x.get("sell_urgency_score", 0), reverse=True)
        buy_sorted = sorted(buy_recommendations, key=self._candidate_score, reverse=True)

        swap_pairs = []
        for i, sell in enumerate(sell_sorted):
            if i >= len(buy_sorted):
                break
            buy = buy_sorted[i]
            sell_value = float(sell.get("total_value", 0) or 0)
            buy_price = float(buy.get("price", 0) or 0)
            approximate_shares = int(sell_value / buy_price) if buy_price > 0 else 0
            swap_pairs.append({
                "sell": {
                    "ticker": sell.get("ticker"),
                    "current_value": sell_value,
                    "sell_urgency_score": sell.get("sell_urgency_score", 0),
                },
                "buy": {
                    "ticker": buy.get("ticker"),
                    "upside_score": self._candidate_score(buy),
                    "approximate_shares": approximate_shares,
                },
                "rationale": f"Replace low-momentum {sell.get('ticker')} (urgency {sell.get('sell_urgency_score')}) with stronger {buy.get('ticker')} (score {self._candidate_score(buy)}).",
            })

        return {
            "sell_candidates": sell_sorted,
            "buy_recommendations": buy_sorted[:10],
            "swap_pairs": swap_pairs,
            "last_scan_age_hours": None,
            "top_scan_score": top_scan_score,
        }

    def _calculate_upside_score(self, df, info):
        """
        Calculates Upside Score (0-100) matching Screener logic.
        Returns a dictionary with score components.
        """
        try:
            # --- 1. Momentum Score (30%) ---
            if ta:
                rsi = ta.rsi(df['Close'], length=14).iloc[-1]
                macd = ta.macd(df['Close'])
                macd_hist = macd['MACDh_12_26_9'].iloc[-1]
            else:
                # Fallback if pandas_ta is missing
                rsi = 50.0
                macd_hist = 0.0
            
            rsi_score = np.clip((rsi - 50) * 5, 0, 100)
            macd_score = 100 if macd_hist > 0 else 0
            mom_score = (rsi_score * 0.7) + (macd_score * 0.3)
            
            # --- 2. Fundamental Score (40%) ---
            # Lightweight approximation for rebalancer to avoid Perplexity cost/latency per asset
            # Rebalancer mainly focuses on Technicals for exits, but needs a proxy score.
            fund_score = 50 # Neutral default if info missing
            rev_g = info.get('revenueGrowth', 0) or 0
            roe = info.get('returnOnEquity', 0) or 0
            if rev_g or roe:
                rev_score = np.clip(rev_g * 500, 0, 100)
                roe_score = np.clip(roe * 400, 0, 100)
                fund_score = (rev_score * 0.5) + (roe_score * 0.5)

            # --- 3. Strategy-backed valuation/target model ---
            current_price = float(df['Close'].iloc[-1])
            avg_vol_20 = float(df['Volume'].rolling(20).mean().iloc[-1]) if 'Volume' in df else 0.0
            current_vol = float(df['Volume'].iloc[-1]) if 'Volume' in df else avg_vol_20
            monthly_vol = float(df['Close'].pct_change().tail(30).std() * (21 ** 0.5) * 100)
            sma_20 = float(df['Close'].rolling(20).mean().iloc[-1])
            sma_50 = float(df['Close'].rolling(50).mean().iloc[-1]) if len(df) >= 50 else sma_20
            rsi_slope_5 = 0.0
            if ta:
                rsi_series = ta.rsi(df['Close'], length=14)
                if rsi_series is not None and len(rsi_series.dropna()) >= 6:
                    rsi_slope_5 = float(rsi_series.dropna().iloc[-1] - rsi_series.dropna().iloc[-6])

            features = {
                "current_price": current_price,
                "avg_vol_20": avg_vol_20,
                "current_vol": current_vol,
                "vol_shock": float(current_vol / avg_vol_20) if avg_vol_20 > 0 else 1.0,
                "monthly_vol": monthly_vol,
                "sma_20": sma_20,
                "sma_50": sma_50,
                "rsi": float(rsi),
                "macd_hist": float(macd_hist),
                "rsi_slope_5": rsi_slope_5,
            }
            info_proxy = {
                "quoteType": info.get("quoteType", "EQUITY"),
                "revenueGrowth": info.get("revenueGrowth", 0) or 0,
                "profitGrowth": info.get("earningsGrowth", 0) or 0,
                "returnOnEquity": info.get("returnOnEquity", 0) or 0,
                "roce": info.get("returnOnAssets", 0) or 0,
                "debtToEquity": info.get("debtToEquity", 0) or 0,
                "beta": info.get("beta", 1.0) or 1.0,
                "targetMeanPrice": info.get("targetMeanPrice", 0) or 0,
                "trailingPE": info.get("trailingPE", 0) or 0,
                "forwardPE": info.get("forwardPE", 0) or 0,
                "pegRatio": info.get("pegRatio", 0) or 0,
            }
            projection = CoreStrategyPipeline().project_target(
                current_price=current_price,
                features=features,
                info_proxy=info_proxy,
                context=ScanRuntimeContext(
                    region="IN" if str(info.get("symbol", "")).endswith(".NS") else "US",
                    strategy_id="core",
                    thresholds={},
                    user_plan="pro",
                    volatility_min=3.0,
                    volatility_max=8.0,
                ),
                config=ALPHASEEKER_CORE,
            )
            upside_pct = float(projection.upside_pct)
            val_score = float(projection.valuation_score)
            
            total_score = (fund_score * 0.4) + (mom_score * 0.3) + (val_score * 0.3)
            
            return {
                "total_score": round(total_score, 2),
                "upside_pct": round(upside_pct * 100, 1),
                "mom_score": round(mom_score, 1)
            }
        except:
             return {
                "total_score": 50.0,
                "upside_pct": 0.0,
                "mom_score": 50.0
            }

    def analyze_portfolio(self, portfolio, new_candidates=None):
        if not portfolio: return []

        analyzed_assets = []
        tickers = [p['ticker'] for p in portfolio]
        
        # Batch Fetch History
        try:
            # period=6mo is faster and enough for RSI/Trend
            data = yf.download(tickers, period="6mo", group_by='ticker', progress=False)
        except:
            data = None

        today = datetime.now()
        
        # Get Best New Candidate Score
        best_new_score = None
        if new_candidates:
            best_new_score = new_candidates[0].get('score', 0)

        for asset in portfolio:
            ticker = asset['ticker']
            buy_date_str = asset['buy_date']
            
            # Robust Date Parsing
            try:
                # Handle YYYY-MM-DD (Standard)
                buy_date = datetime.strptime(buy_date_str, "%Y-%m-%d")
            except ValueError:
                try:
                    # Handle DD-MM-YYYY (HDFC sometimes)
                    buy_date = datetime.strptime(buy_date_str, "%d-%m-%Y")
                except:
                    # Fallback to older date to avoid "locked" status if date is totally unknown
                    # Warning: This unlocks everything if date is bad.
                    buy_date = today - timedelta(days=366) 

            
            # --- Step B: Time Lock ---
            days_held = (today - buy_date).days
            # Logic Update: If HDFC sync failed to get date, we default to today in HDFC engine.
            # If days_held is 0, user sees "Hold (Compliance)".
            # Heuristic: If buy_date is today but source is HDFC, it might be an archival/sync artifact.
            # But we must respect the 30-day rule strictly for real trades.
            status = "LOCKED" if days_held < 7 else "UNLOCKED" # Reduced from 31 to 7 for testing/usability? 
            # Or keep it 31 but ensure display reasoning is clear. 
            # Let's keep 31 but make it clear.
            status = "LOCKED" if days_held < 31 else "UNLOCKED"

            recommendation = "HOLD"
            reason = ""
            score_data = {"total_score": 0, "upside_pct": 0, "mom_score": 0}
            score = 0.0
            trend = "Unknown"
            urgency = {"score": 0, "badge": "HOLD", "primary_signal": "Insufficient data"}
            
            try:
                # Need Info for Scoring (Expensive but necessary for 'Step D')
                # Optimisation: Use cached info or skip if unneeded.
                # For now, we continue to use yf.Ticker
                t_obj = yf.Ticker(ticker)
                # Fallback empty dict if info fetch fails to prevent crash
                try: info = t_obj.info
                except: info = {}
                
                # Check if data exists for this ticker
                df = None
                if data is not None and not data.empty:
                    if len(tickers) > 1:
                        if ticker in data.columns.levels[0]:
                            df = data[ticker].dropna()
                    else:
                        df = data.dropna()
                
                # If batch failed or specific ticker missing, try individual fetch
                if df is None or df.empty:
                     df = yf.download(ticker, period="6mo", progress=False)

                if df is not None and not df.empty and len(df) > 20:
                    current_price = df['Close'].iloc[-1]
                    sma_20 = df['Close'].rolling(20).mean().iloc[-1]
                    
                    # Determine Trend
                    trend = "Bullish" if current_price > sma_20 else "Bearish"

                    # Calculate Stats
                    score_data = self._calculate_upside_score(df, info)
                    score = score_data['total_score']
                    pl_pct = asset.get('pl_percent', 0)
                    market_data = self._build_market_data(df, info, {**asset, "score": score})
                    urgency = self.compute_sell_urgency(
                        holding={**asset, "score": score},
                        market_data=market_data,
                        top_scan_score=best_new_score,
                    )
                    
                    # --- Step C: Weakest Link ---
                    # We evaluate Sell/Swap potential regardless of lock, 
                    # but flag it if locked.
                    
                    is_sell_candidate = False
                    sell_reasons = []
                    
                    # 1. Profit Target > 20%
                    if pl_pct > 20:
                        is_sell_candidate = True
                        sell_reasons.append(f"Profit {pl_pct:.1f}%")
                        
                    # 2. Trend Breakdown (< 20 SMA)
                    if current_price < sma_20:
                        is_sell_candidate = True
                        sell_reasons.append("Broken Trend (< 20 SMA)")
                        
                    if is_sell_candidate:
                        recommendation = "SELL_CANDIDATE"
                        reason = ", ".join(sell_reasons)
                        
                    # --- Step D: Swap Decision (High Conviction) ---
                    # Rule: IF New > Old * 1.5
                    if best_new_score is not None and best_new_score > (score * 1.5):
                            if recommendation != "SELL_CANDIDATE":
                                recommendation = "SWAP_ADVICE"
                                reason = f"Upgrade Available: Score {best_new_score}"

                    # Override if Locked (Compliance) - Optional: Disable lock for purely advisory view
                    # User requested to RESTORE recommendations, so we relax the lock visualization
                    if status == "LOCKED" and recommendation != "HOLD":
                         reason += " (Note: Held < 30 days)"
                         # We do NOT force back to HOLD, just warn. This ensures 'Swap' container appears.

            except Exception as e:
                # print(f"Analysis Error for {ticker}: {e}")
                reason = f"Data Error: {str(e)}"
                
            analyzed_assets.append({
                "ticker": ticker,
                "age_days": int(days_held), # Renamed from days_held to age_days for Frontend
                "status": status,
                "recommendation": recommendation,
                "reason": reason,
                "score": round(score, 1),
                "trend": trend,
                "pl_percent": asset.get('pl_percent', 0),
                "current_value": asset.get("total_value", 0),
                "sell_urgency_score": urgency.get("score", 0),
                "sell_urgency_badge": urgency.get("badge", "HOLD"),
                "primary_sell_signal": urgency.get("primary_signal", "Insufficient data"),
            })
            
        return analyzed_assets

rebalancer = RebalancerEngine()
