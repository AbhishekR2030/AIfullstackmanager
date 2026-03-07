"""DE Shaw-inspired multi-factor strategy."""

from typing import Any, Dict

from app.engines.strategy_base import BaseStrategyPipeline, ScanRuntimeContext


class DEShawMultiFactorPipeline(BaseStrategyPipeline):
    strategy_id = "de_shaw_multifactor"
    strategy_label = "DE Shaw Multi-Factor"
    strategy_tier = "pro"
    strategy_summary = "Momentum + quality + valuation blended multi-factor screen."
    strategy_logic = [
        "Combines momentum, quality, and valuation into a composite factor score.",
        "Uses shared risk controls with slightly broader trend acceptance than pure momentum.",
        "Optimized for robust factor diversification rather than single-signal bets.",
    ]

    def technical_filter(self, features: Dict[str, float], context: ScanRuntimeContext, config: Any) -> bool:
        # Reuse baseline gates but allow modestly wider RSI window for factor blending.
        if float(features.get("current_price", 0.0)) <= 0:
            return False

        if float(features.get("vol_shock", 0.0)) < max(1.25, float(config.volume_multiplier) - 0.1):
            return False

        monthly_vol = float(features.get("monthly_vol", 0.0))
        if monthly_vol < max(2.0, context.volatility_min - 0.5) or monthly_vol > max(10.5, context.volatility_max + 1.0):
            return False

        rsi = float(features.get("rsi", 50.0))
        if rsi < min(43.0, float(config.rsi_min)) or rsi > max(67.0, float(config.rsi_max)):
            return False

        sma_20 = float(features.get("sma_20", 0.0))
        sma_50 = float(features.get("sma_50", 0.0))
        if float(features.get("current_price", 0.0)) <= min(sma_20, sma_50):
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

        rsi = float(features.get("rsi", 50.0))
        momentum_component = max(0.0, min(100.0, (rsi - 40.0) * 2.1))

        roe = float(info_proxy.get("returnOnEquity", 0.0))
        quality_component = max(0.0, min(100.0, (roe * 100.0 - 10.0) * 2.5))

        pe = float(info_proxy.get("trailingPE", 0.0) or 0.0)
        valuation_component = 70.0 if pe <= 0 else max(0.0, min(100.0, 110.0 - pe * 2.7))

        factor_score = 0.4 * momentum_component + 0.35 * quality_component + 0.25 * valuation_component
        blended = 0.5 * adjusted + 0.5 * factor_score
        return max(0.0, min(100.0, blended))

    def build_technical_reason(self, features: Dict[str, float], context: ScanRuntimeContext) -> str:
        return (
            f"Multi-factor blend | RSI {features.get('rsi', 50):.1f} | "
            f"Vol shock {features.get('vol_shock', 1):.2f}x | "
            "Trend + valuation balance"
        )
