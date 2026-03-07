"""Strategy pipeline contracts for Discovery hybrid architecture.

The existing scanner logic remains authoritative for data retrieval and scoring.
This module adds explicit interfaces so each strategy can customize alpha logic
without rewriting shared platform services.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol


@dataclass
class ScanRuntimeContext:
    """Runtime context passed through strategy and shared service layers."""

    region: str
    strategy_id: str
    thresholds: Dict[str, Any]
    user_plan: str
    volatility_min: float
    volatility_max: float


@dataclass
class StrategyScanMetadata:
    """Metadata emitted for UI explainability and monitoring."""

    strategy_id: str
    strategy_label: str
    strategy_tier: str
    strategy_summary: str
    strategy_logic: List[str] = field(default_factory=list)


class StrategyPipeline(Protocol):
    """Contract for strategy-specific alpha behavior."""

    strategy_id: str
    strategy_label: str
    strategy_tier: str
    strategy_summary: str
    strategy_logic: List[str]

    def compute_technical_features(self, df: Any, context: ScanRuntimeContext) -> Optional[Dict[str, float]]:
        ...

    def technical_filter(
        self,
        features: Dict[str, float],
        context: ScanRuntimeContext,
        config: Any,
    ) -> bool:
        ...

    def evaluate_fundamentals(
        self,
        info_proxy: Dict[str, Any],
        context: ScanRuntimeContext,
        config: Any,
    ) -> tuple[bool, List[str]]:
        ...

    def adjust_score(
        self,
        base_score: float,
        features: Dict[str, float],
        info_proxy: Dict[str, Any],
        fundamentals_passed: bool,
        context: ScanRuntimeContext,
        config: Any,
    ) -> float:
        ...

    def build_technical_reason(self, features: Dict[str, float], context: ScanRuntimeContext) -> str:
        ...


class BaseStrategyPipeline:
    """Default implementation used by Core and inherited by other strategies."""

    strategy_id = "core"
    strategy_label = "Alphaseeker Core"
    strategy_tier = "free"
    strategy_summary = "Balanced momentum + quality composite baseline."
    strategy_logic = [
        "Balanced momentum and quality factor blend.",
        "Conservative liquidity, trend, and risk filters.",
        "Normalized conviction scoring for portfolio ranking.",
    ]

    def compute_technical_features(self, df: Any, context: ScanRuntimeContext) -> Optional[Dict[str, float]]:
        if df is None or len(df) < 55:
            return None

        close = df["Close"]
        volume = df["Volume"]

        current_price = float(close.iloc[-1])
        avg_vol_20 = float(volume.rolling(20).mean().iloc[-1])
        if avg_vol_20 <= 0:
            return None

        current_vol = float(volume.iloc[-1])
        monthly_vol = float(close.pct_change().tail(30).std() * (21 ** 0.5) * 100)
        sma_20 = float(close.rolling(20).mean().iloc[-1])
        sma_50 = float(close.rolling(50).mean().iloc[-1])

        # Optional RSI/MACD when pandas_ta is available via scanner wrapper.
        rsi = None
        macd_hist = None
        rsi_slope_5 = None

        return {
            "current_price": current_price,
            "avg_vol_20": avg_vol_20,
            "current_vol": current_vol,
            "vol_shock": float(current_vol / avg_vol_20),
            "monthly_vol": monthly_vol,
            "sma_20": sma_20,
            "sma_50": sma_50,
            "rsi": rsi if rsi is not None else 50.0,
            "macd_hist": macd_hist if macd_hist is not None else 1.0,
            "rsi_slope_5": rsi_slope_5 if rsi_slope_5 is not None else 0.0,
        }

    def technical_filter(self, features: Dict[str, float], context: ScanRuntimeContext, config: Any) -> bool:
        if not (config.min_price <= features["current_price"] <= config.max_price):
            return False

        if features["monthly_vol"] < context.volatility_min or features["monthly_vol"] > context.volatility_max:
            return False

        if features["current_price"] <= features["sma_20"] or features["current_price"] <= features["sma_50"]:
            return False

        if features["vol_shock"] <= config.volume_multiplier:
            return False

        if not (config.rsi_min <= features["rsi"] <= config.rsi_max):
            return False

        if features["macd_hist"] <= 0:
            return False

        return True

    def evaluate_fundamentals(
        self,
        info_proxy: Dict[str, Any],
        context: ScanRuntimeContext,
        config: Any,
    ) -> tuple[bool, List[str]]:
        failed_checks: List[str] = []

        rev_growth = float(info_proxy.get("revenueGrowth", 0))
        roe = float(info_proxy.get("returnOnEquity", 0))
        roce = float(info_proxy.get("roce", 0))
        profit_growth = float(info_proxy.get("profitGrowth", 0))
        debt = float(info_proxy.get("debtToEquity", 0))

        if not ((config.rev_growth_min / 100) <= rev_growth <= (config.rev_growth_max / 100)):
            failed_checks.append(f"RevGrowth: {rev_growth:.1%}")
        if not ((config.roe_min / 100) <= roe <= 1.0):
            failed_checks.append(f"ROE: {roe:.1%}")
        if not ((config.roce_min / 100) <= roce <= 1.0):
            failed_checks.append(f"ROCE: {roce:.1%}")
        if not ((config.profit_growth_min / 100) <= profit_growth <= (config.profit_growth_max / 100)):
            failed_checks.append(f"ProfitGrowth: {profit_growth:.1%}")
        if not (0.0 <= debt <= config.max_debt_equity):
            failed_checks.append(f"D/E: {debt:.1f}")

        return len(failed_checks) == 0, failed_checks

    def adjust_score(
        self,
        base_score: float,
        features: Dict[str, float],
        info_proxy: Dict[str, Any],
        fundamentals_passed: bool,
        context: ScanRuntimeContext,
        config: Any,
    ) -> float:
        adjusted = float(base_score)
        if not fundamentals_passed:
            adjusted = max(45.0, adjusted - 10.0)
        return max(0.0, min(100.0, adjusted))

    def build_technical_reason(self, features: Dict[str, float], context: ScanRuntimeContext) -> str:
        return (
            f"Momentum blend | RSI: {features.get('rsi', 50):.1f} | "
            f"Volume Shock: {features.get('vol_shock', 1):.1f}x | "
            "Price > SMA20/SMA50"
        )
