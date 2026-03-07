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

    def project_target(self, current_price, features, info_proxy, context, config):
        analyst_upside = self._analyst_upside(current_price, info_proxy)
        momentum = self._momentum_factor(features)
        trend_strength = self._normalise(float(features.get("rsi_slope_5", 0.0)), 0.0, 8.0)
        liquidity = self._normalise(float(features.get("vol_shock", 1.0)), 1.2, 3.5)
        quality = self._quality_factor(info_proxy)
        valuation = self._valuation_factor(info_proxy, analyst_upside)
        risk = self._risk_penalty(features, info_proxy)

        continuation = self._clamp(
            (0.45 * momentum) + (0.3 * trend_strength) + (0.25 * liquidity),
            0.0,
            1.0,
        )
        model_upside = 0.045 + (0.09 * continuation) + (0.03 * quality) + (0.02 * valuation) - (0.025 * risk)
        blended_upside, source = self._blend_upside(model_upside, analyst_upside, analyst_weight=0.35)
        final_upside = self._clamp(blended_upside, 0.05, 0.24)
        signal_strength = self._clamp((0.52 * continuation) + (0.24 * quality) + (0.24 * valuation), 0.0, 1.0)
        return self._build_projection(
            current_price=current_price,
            upside_pct=final_upside,
            source=source,
            model_name="citadel_momentum_target_model",
            max_upside=0.24,
            signal_strength=signal_strength,
            components={
                "continuation": round(continuation, 4),
                "quality": round(quality, 4),
                "valuation": round(valuation, 4),
                "risk": round(risk, 4),
            },
        )
