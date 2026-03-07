"""Citadel-style momentum continuation strategy."""

from typing import Any, Dict

from app.engines.strategy_base import BaseStrategyPipeline, ScanRuntimeContext


class CitadelMomentumPipeline(BaseStrategyPipeline):
    strategy_id = "citadel_momentum"
    strategy_label = "Citadel Momentum"
    strategy_tier = "pro"
    strategy_summary = "High-liquidity momentum and quality tilt."
    strategy_logic = [
        "Targets 12-1 momentum continuation with strict liquidity confirmation.",
        "Requires stronger relative RSI and volume shock than the core strategy.",
        "Adds mild quality guardrails to avoid weak balance-sheet breakouts.",
    ]

    def technical_filter(self, features: Dict[str, float], context: ScanRuntimeContext, config: Any) -> bool:
        if not super().technical_filter(features, context, config):
            return False

        if float(features.get("vol_shock", 0.0)) < max(float(config.volume_multiplier), 1.6):
            return False

        rsi = float(features.get("rsi", 50.0))
        if rsi < max(float(config.rsi_min), 53.0) or rsi > min(float(config.rsi_max), 70.0):
            return False

        if float(features.get("rsi_slope_5", 0.0)) < -0.05:
            return False

        return True

    def adjust_score(
        self,
        base_score: float,
        features: Dict[str, float],
        info_proxy: Dict[str, Any],
        fundamentals_passed: bool,
        context: ScanRuntimeContext,
        config: Any,
    ) -> float:
        adjusted = super().adjust_score(base_score, features, info_proxy, fundamentals_passed, context, config)
        adjusted += min(8.0, max(0.0, (float(features.get("vol_shock", 1.0)) - 1.2) * 4.0))
        adjusted += min(6.0, max(0.0, (float(features.get("rsi", 50.0)) - 55.0) * 0.45))
        return max(0.0, min(100.0, adjusted))

    def build_technical_reason(self, features: Dict[str, float], context: ScanRuntimeContext) -> str:
        return (
            f"Momentum continuation | RSI {features.get('rsi', 50):.1f} | "
            f"Volume shock {features.get('vol_shock', 1):.2f}x | "
            "Trend aligned above SMA20/SMA50"
        )
