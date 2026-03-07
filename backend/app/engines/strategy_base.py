"""Strategy pipeline contracts for Discovery hybrid architecture.

The existing scanner logic remains authoritative for data retrieval and scoring.
This module adds explicit interfaces so each strategy can customize alpha logic
without rewriting shared platform services.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
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


@dataclass
class TargetProjection:
    upside_pct: float
    target_price: float
    source: str
    model_name: str
    valuation_score: float
    components: Dict[str, float] = field(default_factory=dict)


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

    def project_target(
        self,
        current_price: float,
        features: Dict[str, float],
        info_proxy: Dict[str, Any],
        context: ScanRuntimeContext,
        config: Any,
    ) -> TargetProjection:
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

    def _safe_float(self, value: Any, default: float = 0.0) -> float:
        try:
            numeric = float(value)
            if not math.isfinite(numeric):
                return default
            return numeric
        except Exception:
            return default

    def _clamp(self, value: float, lower: float, upper: float) -> float:
        return max(lower, min(upper, value))

    def _normalise(self, value: float, lower: float, upper: float) -> float:
        if upper <= lower:
            return 0.0
        return self._clamp((value - lower) / (upper - lower), 0.0, 1.0)

    def _inverse_normalise(self, value: float, ideal_low: float, weak_high: float) -> float:
        if weak_high <= ideal_low:
            return 0.0
        return 1.0 - self._normalise(value, ideal_low, weak_high)

    def _analyst_upside(self, current_price: float, info_proxy: Dict[str, Any]) -> Optional[float]:
        if current_price <= 0:
            return None
        target_price = self._safe_float(
            info_proxy.get("targetMeanPrice", info_proxy.get("target_mean_price", 0.0)),
            0.0,
        )
        if target_price <= 0:
            return None
        upside = (target_price - current_price) / current_price
        if upside <= 0:
            return None
        return self._clamp(upside, 0.0, 0.45)

    def _momentum_factor(self, features: Dict[str, float]) -> float:
        rsi = self._safe_float(features.get("rsi"), 50.0)
        macd_hist = self._safe_float(features.get("macd_hist"), 0.0)
        vol_shock = self._safe_float(features.get("vol_shock"), 1.0)
        rsi_slope = self._safe_float(features.get("rsi_slope_5"), 0.0)
        sma_20 = self._safe_float(features.get("sma_20"), 0.0)
        sma_50 = self._safe_float(features.get("sma_50"), 0.0)
        current_price = self._safe_float(features.get("current_price"), 0.0)
        trend_base = max(sma_20, sma_50, 1.0)
        trend_gap = ((current_price / trend_base) - 1.0) if trend_base > 0 else 0.0

        return self._clamp(
            0.32 * self._normalise(rsi, 50.0, 72.0)
            + 0.18 * self._normalise(macd_hist, 0.0, 2.0)
            + 0.18 * self._normalise(vol_shock, 1.0, 3.0)
            + 0.14 * self._normalise(rsi_slope, 0.0, 8.0)
            + 0.18 * self._normalise(trend_gap, 0.0, 0.12),
            0.0,
            1.0,
        )

    def _reversion_factor(self, features: Dict[str, float]) -> float:
        rsi = self._safe_float(features.get("rsi"), 50.0)
        macd_hist = abs(self._safe_float(features.get("macd_hist"), 0.0))
        vol_shock = self._safe_float(features.get("vol_shock"), 1.0)
        monthly_vol = self._safe_float(features.get("monthly_vol"), 5.0)
        neutral_rsi = 1.0 - self._clamp(abs(rsi - 50.0) / 18.0, 0.0, 1.0)
        quiet_macd = 1.0 - self._normalise(macd_hist, 0.0, 2.0)
        moderate_vol = 1.0 - self._clamp(abs(monthly_vol - 6.0) / 8.0, 0.0, 1.0)
        return self._clamp(
            0.4 * neutral_rsi
            + 0.2 * quiet_macd
            + 0.2 * self._normalise(vol_shock, 1.0, 2.4)
            + 0.2 * moderate_vol,
            0.0,
            1.0,
        )

    def _quality_factor(self, info_proxy: Dict[str, Any]) -> float:
        roe = self._safe_float(info_proxy.get("returnOnEquity"), 0.0)
        roce = self._safe_float(info_proxy.get("roce"), 0.0)
        rev_growth = self._safe_float(info_proxy.get("revenueGrowth"), 0.0)
        profit_growth = self._safe_float(info_proxy.get("profitGrowth"), 0.0)
        debt = self._safe_float(info_proxy.get("debtToEquity"), 0.0)

        return self._clamp(
            0.24 * self._normalise(roe, 0.12, 0.32)
            + 0.22 * self._normalise(roce, 0.12, 0.32)
            + 0.2 * self._normalise(rev_growth, 0.05, 0.25)
            + 0.17 * self._normalise(profit_growth, 0.0, 0.25)
            + 0.17 * self._inverse_normalise(debt, 20.0, 150.0),
            0.0,
            1.0,
        )

    def _valuation_factor(self, info_proxy: Dict[str, Any], analyst_upside: Optional[float] = None) -> float:
        peg = self._safe_float(info_proxy.get("pegRatio", info_proxy.get("peg_ratio", 0.0)), 0.0)
        trailing_pe = self._safe_float(info_proxy.get("trailingPE", info_proxy.get("pe_ratio", 0.0)), 0.0)
        forward_pe = self._safe_float(info_proxy.get("forwardPE", info_proxy.get("forward_pe", 0.0)), 0.0)

        peg_component = self._inverse_normalise(peg if peg > 0 else 1.8, 0.8, 2.2)
        trailing_component = self._inverse_normalise(trailing_pe if trailing_pe > 0 else 26.0, 12.0, 32.0)
        forward_component = self._inverse_normalise(forward_pe if forward_pe > 0 else trailing_pe or 26.0, 12.0, 30.0)
        analyst_component = self._normalise(analyst_upside or 0.0, 0.04, 0.25)

        return self._clamp(
            0.38 * peg_component
            + 0.2 * trailing_component
            + 0.17 * forward_component
            + 0.25 * analyst_component,
            0.0,
            1.0,
        )

    def _stability_factor(self, features: Dict[str, float], info_proxy: Dict[str, Any]) -> float:
        monthly_vol = self._safe_float(features.get("monthly_vol"), 6.0)
        beta = self._safe_float(info_proxy.get("beta"), 1.0)
        debt = self._safe_float(info_proxy.get("debtToEquity"), 0.0)
        return self._clamp(
            0.45 * self._inverse_normalise(monthly_vol, 4.0, 14.0)
            + 0.3 * self._inverse_normalise(beta, 0.9, 1.8)
            + 0.25 * self._inverse_normalise(debt, 20.0, 140.0),
            0.0,
            1.0,
        )

    def _risk_penalty(self, features: Dict[str, float], info_proxy: Dict[str, Any]) -> float:
        monthly_vol = self._safe_float(features.get("monthly_vol"), 6.0)
        beta = self._safe_float(info_proxy.get("beta"), 1.0)
        debt = self._safe_float(info_proxy.get("debtToEquity"), 0.0)
        return self._clamp(
            0.45 * self._normalise(monthly_vol, 8.0, 18.0)
            + 0.3 * self._normalise(beta, 1.2, 2.2)
            + 0.25 * self._normalise(debt, 70.0, 180.0),
            0.0,
            1.0,
        )

    def _blend_upside(self, model_upside: float, analyst_upside: Optional[float], analyst_weight: float) -> tuple[float, str]:
        if analyst_upside is None:
            return model_upside, "strategy_model"

        weight = self._clamp(analyst_weight, 0.0, 1.0)
        blended = (analyst_upside * weight) + (model_upside * (1.0 - weight))
        return blended, "analyst_blend"

    def _build_projection(
        self,
        *,
        current_price: float,
        upside_pct: float,
        source: str,
        model_name: str,
        max_upside: float,
        signal_strength: float,
        components: Optional[Dict[str, float]] = None,
    ) -> TargetProjection:
        bounded_upside = self._clamp(upside_pct, 0.0, max_upside)
        target_price = current_price * (1.0 + bounded_upside)
        upside_score = self._normalise(bounded_upside, 0.0, max_upside)
        valuation_score = self._clamp((0.65 * upside_score + 0.35 * signal_strength) * 100.0, 0.0, 100.0)
        return TargetProjection(
            upside_pct=bounded_upside,
            target_price=round(target_price, 2),
            source=source,
            model_name=model_name,
            valuation_score=round(valuation_score, 2),
            components=components or {},
        )

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

    def project_target(
        self,
        current_price: float,
        features: Dict[str, float],
        info_proxy: Dict[str, Any],
        context: ScanRuntimeContext,
        config: Any,
    ) -> TargetProjection:
        analyst_upside = self._analyst_upside(current_price, info_proxy)
        momentum = self._momentum_factor(features)
        quality = self._quality_factor(info_proxy)
        valuation = self._valuation_factor(info_proxy, analyst_upside)
        stability = self._stability_factor(features, info_proxy)
        risk = self._risk_penalty(features, info_proxy)

        model_upside = (
            0.035
            + (0.055 * momentum)
            + (0.04 * quality)
            + (0.035 * valuation)
            + (0.015 * stability)
            - (0.02 * risk)
        )
        blended_upside, source = self._blend_upside(model_upside, analyst_upside, analyst_weight=0.55)
        final_upside = self._clamp(blended_upside, 0.03, 0.18)
        signal_strength = self._clamp(
            (0.3 * momentum) + (0.26 * quality) + (0.24 * valuation) + (0.2 * stability),
            0.0,
            1.0,
        )
        return self._build_projection(
            current_price=current_price,
            upside_pct=final_upside,
            source=source,
            model_name=f"{self.strategy_id}_target_model",
            max_upside=0.18,
            signal_strength=signal_strength,
            components={
                "momentum": round(momentum, 4),
                "quality": round(quality, 4),
                "valuation": round(valuation, 4),
                "stability": round(stability, 4),
                "risk": round(risk, 4),
            },
        )
