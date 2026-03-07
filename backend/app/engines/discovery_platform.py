"""Shared platform layers for Discovery hybrid architecture.

The scanner orchestration remains in ``scanner_engine.py``.
These services encapsulate cross-strategy platform concerns so each
alpha pipeline can focus on strategy-specific signal logic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple


@dataclass
class ScanTelemetry:
    """Mutable telemetry container for a single scan execution."""

    strategy_id: str
    region: str
    started_at: float = field(default_factory=time.time)
    counters: Dict[str, int] = field(default_factory=dict)
    notes: List[str] = field(default_factory=list)

    def increment(self, key: str, value: int = 1) -> None:
        self.counters[key] = int(self.counters.get(key, 0)) + int(value)

    def add_note(self, note: str) -> None:
        if note:
            self.notes.append(note)

    def snapshot(self) -> Dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "region": self.region,
            "scan_time_seconds": round(time.time() - self.started_at, 2),
            "counters": dict(self.counters),
            "notes": list(self.notes),
        }


class DataPlatformService:
    """Shared universe and market data access service."""

    def __init__(self, loader: Any):
        self.loader = loader

    def load_universe(self, region: str) -> List[str]:
        if (region or "IN").strip().upper() == "US":
            return list(self.loader.get_us_tickers())
        return list(self.loader.get_india_tickers())

    def fetch_ohlcv(self, tickers: Sequence[str], period: str = "3mo"):
        return self.loader.fetch_data(list(tickers), period=period)


class RiskGuardService:
    """Hard tradability and safety checks shared by all strategies."""

    USD_INR = 85.0

    def evaluate_liquidity(self, features: Dict[str, float], config: Any, region: str) -> Tuple[bool, str, Dict[str, float]]:
        current_price = float(features.get("current_price", 0.0))
        avg_vol_20 = float(features.get("avg_vol_20", 0.0))

        if current_price <= 0 or avg_vol_20 <= 0:
            return False, "missing_price_or_volume", {}

        if not (float(config.min_price) <= current_price <= float(config.max_price)):
            return False, "price_out_of_range", {"current_price": current_price}

        turnover_native = current_price * avg_vol_20
        turnover_inr = turnover_native if region == "IN" else turnover_native * self.USD_INR
        turnover_cr = turnover_inr / 1e7
        if turnover_cr < float(config.min_turnover_cr):
            return False, "turnover_below_threshold", {"turnover_cr": round(turnover_cr, 2)}

        return True, "ok", {
            "turnover_cr": round(turnover_cr, 2),
            "daily_turnover_inr": round(turnover_inr, 2),
        }

    def build_risk_flags(
        self,
        features: Dict[str, float],
        info_proxy: Dict[str, Any],
        fundamentals_passed: bool,
        failed_checks: List[str],
        execution_estimate: Dict[str, Any],
        moat_failed: bool = False,
    ) -> List[str]:
        flags: List[str] = []

        if not fundamentals_passed:
            flags.append("fundamentals_out_of_range")
        if failed_checks:
            flags.extend([f"fundamental:{item}" for item in failed_checks[:3]])
        if moat_failed:
            flags.append("economic_moat_failed")

        monthly_vol = float(features.get("monthly_vol", 0.0))
        if monthly_vol >= 10.0:
            flags.append("high_volatility")

        debt = float(info_proxy.get("debtToEquity", 0.0) or 0.0)
        if debt >= 120:
            flags.append("high_leverage")

        fill_probability = float(execution_estimate.get("fill_probability", 0.0))
        if fill_probability < 0.55:
            flags.append("low_execution_confidence")

        return flags


class ExecutionSimulationService:
    """Simple execution quality simulator for candidate ranking."""

    def estimate_execution(self, features: Dict[str, float], region: str) -> Dict[str, float]:
        vol_shock = max(float(features.get("vol_shock", 1.0)), 0.1)
        turnover_cr = max(float(features.get("turnover_cr", 0.0)), 0.0)
        monthly_vol = max(float(features.get("monthly_vol", 0.0)), 0.0)

        # Lower turnover and higher volatility imply worse execution quality.
        slippage_bps = max(3.0, min(95.0, (24.0 / max(turnover_cr, 1.0)) + (monthly_vol * 0.8)))
        fill_probability = max(0.2, min(0.99, 0.5 + (min(turnover_cr, 25.0) / 40.0) + (min(vol_shock, 4.0) / 15.0) - (monthly_vol / 120.0)))
        execution_quality = max(0.0, min(100.0, 100.0 - slippage_bps))

        return {
            "slippage_bps": round(slippage_bps, 2),
            "fill_probability": round(fill_probability, 2),
            "execution_quality": round(execution_quality, 2),
            "region": region,
        }

    def select_fundamental_candidates(self, candidates: List[Dict[str, Any]], limit: int = 30) -> List[Dict[str, Any]]:
        for candidate in candidates:
            preview = self.estimate_execution(candidate.get("features", {}), candidate.get("region", "IN"))
            candidate["execution_preview"] = preview
            candidate["_selection_rank"] = (
                float(candidate.get("features", {}).get("vol_shock", 0.0)) * 0.55
                + float(preview.get("execution_quality", 0.0)) * 0.45
            )
        ranked = sorted(candidates, key=lambda item: item.get("_selection_rank", 0.0), reverse=True)
        return ranked[: max(1, int(limit))]


class PortfolioAccountingService:
    """Adds optional portfolio context to scanner output."""

    def attach_portfolio_context(
        self,
        candidates: List[Dict[str, Any]],
        holdings: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        if not candidates:
            return candidates
        holdings = holdings or []
        owned = {(item.get("ticker") or "").strip().upper() for item in holdings if item.get("ticker")}

        for candidate in candidates:
            ticker = (candidate.get("ticker") or "").strip().upper()
            candidate["portfolio_overlap"] = ticker in owned
        return candidates


class MonitoringService:
    """Collects scan telemetry without introducing global mutable state."""

    def start_scan(self, strategy_id: str, region: str) -> ScanTelemetry:
        telemetry = ScanTelemetry(strategy_id=strategy_id, region=region)
        telemetry.increment("scan_started", 1)
        return telemetry

    def finalize_scan(self, telemetry: ScanTelemetry) -> Dict[str, Any]:
        telemetry.increment("scan_completed", 1)
        return telemetry.snapshot()
