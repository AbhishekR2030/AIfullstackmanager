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

    def project_target(self, current_price, features, info_proxy, context, config):
        analyst_upside = self._analyst_upside(current_price, info_proxy)
        reversion = self._reversion_factor(features)
        quality = self._quality_factor(info_proxy)
        valuation = self._valuation_factor(info_proxy, analyst_upside)
        stability = self._stability_factor(features, info_proxy)
        liquidity = self._normalise(float(features.get("vol_shock", 1.0)), 1.0, 2.4)
        risk = self._risk_penalty(features, info_proxy)

        model_upside = (
            0.025
            + (0.06 * reversion)
            + (0.02 * valuation)
            + (0.02 * quality)
            + (0.015 * stability)
            + (0.01 * liquidity)
            - (0.02 * risk)
        )
        blended_upside, source = self._blend_upside(model_upside, analyst_upside, analyst_weight=0.2)
        final_upside = self._clamp(blended_upside, 0.02, 0.12)
        signal_strength = self._clamp(
            (0.42 * reversion) + (0.18 * liquidity) + (0.18 * valuation) + (0.12 * quality) + (0.10 * stability),
            0.0,
            1.0,
        )
        return self._build_projection(
            current_price=current_price,
            upside_pct=final_upside,
            source=source,
            model_name="jane_street_stat_target_model",
            max_upside=0.12,
            signal_strength=signal_strength,
            components={
                "reversion": round(reversion, 4),
                "valuation": round(valuation, 4),
                "quality": round(quality, 4),
                "stability": round(stability, 4),
                "risk": round(risk, 4),
            },
        )
