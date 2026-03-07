"""Jane Street-inspired statistical/mean-reversion strategy."""

from typing import Any, Dict

from app.engines.strategy_base import BaseStrategyPipeline, ScanRuntimeContext


class JaneStreetStatPipeline(BaseStrategyPipeline):
    strategy_id = "jane_street_stat"
    strategy_label = "Jane Street Statistical"
    strategy_tier = "pro"
    strategy_summary = "Pairs-trading and mean-reversion inspired blend."
    strategy_logic = [
        "Looks for tactical dislocations with controlled volatility.",
        "Allows neutral RSI zones to capture reversion opportunities.",
        "Blends statistical flow setup with shared risk controls.",
    ]

    def technical_filter(self, features: Dict[str, float], context: ScanRuntimeContext, config: Any) -> bool:
        current_price = float(features.get("current_price", 0.0))
        if current_price <= 0:
            return False

        monthly_vol = float(features.get("monthly_vol", 0.0))
        if monthly_vol < max(2.0, context.volatility_min - 1.0) or monthly_vol > max(12.0, context.volatility_max + 1.0):
            return False

        vol_shock = float(features.get("vol_shock", 0.0))
        if vol_shock < max(1.1, float(config.volume_multiplier) - 0.2):
            return False

        rsi = float(features.get("rsi", 50.0))
        if rsi < min(35.0, float(config.rsi_min)) or rsi > max(65.0, float(config.rsi_max)):
            return False

        # Mean-reversion style tolerates transient MACD weakness unlike strict momentum strategies.
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

        rsi = float(features.get("rsi", 50.0))
        rsi_center_bonus = max(0.0, 8.0 - abs(rsi - 50.0) * 0.5)
        mean_reversion_bonus = max(0.0, 6.0 - abs(float(features.get("macd_hist", 0.0))) * 0.4)

        adjusted += rsi_center_bonus + mean_reversion_bonus
        return max(0.0, min(100.0, adjusted))

    def build_technical_reason(self, features: Dict[str, float], context: ScanRuntimeContext) -> str:
        return (
            f"Stat-arb reversion | RSI {features.get('rsi', 50):.1f} near neutral | "
            f"Volatility {features.get('monthly_vol', 0):.1f}% | "
            "Flow dislocation candidate"
        )
