"""Millennium-style quality factor strategy."""

from typing import Any, Dict, List

from app.engines.strategy_base import BaseStrategyPipeline, ScanRuntimeContext


class MillenniumQualityPipeline(BaseStrategyPipeline):
    strategy_id = "millennium_quality"
    strategy_label = "Millennium Quality"
    strategy_tier = "pro"
    strategy_summary = "Quality-factor focused profitability and balance-sheet screen."
    strategy_logic = [
        "Uses quality-factor style signals centered on ROE/ROCE and leverage control.",
        "Prioritizes stable profitability with cleaner balance sheets.",
        "De-emphasizes noisy momentum spikes in favor of durability.",
    ]

    def evaluate_fundamentals(
        self,
        info_proxy: Dict[str, Any],
        context: ScanRuntimeContext,
        config: Any,
    ) -> tuple[bool, List[str]]:
        passed, failed = super().evaluate_fundamentals(info_proxy, context, config)

        roe = float(info_proxy.get("returnOnEquity", 0.0))
        roce = float(info_proxy.get("roce", 0.0))
        rev_growth = float(info_proxy.get("revenueGrowth", 0.0))
        debt = float(info_proxy.get("debtToEquity", 0.0) or 0.0)

        if roe < max(0.16, float(config.roe_min) / 100.0):
            failed.append("ROE quality floor")
        if roce < max(0.16, float(config.roce_min) / 100.0):
            failed.append("ROCE quality floor")
        if rev_growth < max(0.08, float(config.rev_growth_min) / 100.0):
            failed.append("Revenue growth floor")
        if debt > min(80.0, float(config.max_debt_equity)):
            failed.append("Leverage cap breached")

        return len(failed) == 0, failed

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
        roe = float(info_proxy.get("returnOnEquity", 0.0))
        roce = float(info_proxy.get("roce", 0.0))
        debt = float(info_proxy.get("debtToEquity", 0.0) or 0.0)

        adjusted += min(8.0, max(0.0, (roe - 0.16) * 100.0 * 0.25))
        adjusted += min(6.0, max(0.0, (roce - 0.16) * 100.0 * 0.22))
        adjusted -= min(6.0, max(0.0, (debt - 40.0) * 0.08))
        return max(0.0, min(100.0, adjusted))

    def build_technical_reason(self, features: Dict[str, float], context: ScanRuntimeContext) -> str:
        return (
            f"Quality tilt | Vol shock {features.get('vol_shock', 1):.2f}x | "
            f"RSI {features.get('rsi', 50):.1f} with durable trend filter"
        )

    def project_target(self, current_price, features, info_proxy, context, config):
        analyst_upside = self._analyst_upside(current_price, info_proxy)
        quality = self._quality_factor(info_proxy)
        stability = self._stability_factor(features, info_proxy)
        valuation = self._valuation_factor(info_proxy, analyst_upside)
        momentum = self._momentum_factor(features)
        risk = self._risk_penalty(features, info_proxy)

        durability = self._clamp((0.58 * quality) + (0.42 * stability), 0.0, 1.0)
        model_upside = (
            0.04
            + (0.075 * quality)
            + (0.04 * durability)
            + (0.025 * valuation)
            + (0.01 * momentum)
            - (0.025 * risk)
        )
        blended_upside, source = self._blend_upside(model_upside, analyst_upside, analyst_weight=0.65)
        final_upside = self._clamp(blended_upside, 0.04, 0.18)
        signal_strength = self._clamp((0.42 * quality) + (0.24 * durability) + (0.2 * valuation) + (0.14 * stability), 0.0, 1.0)
        return self._build_projection(
            current_price=current_price,
            upside_pct=final_upside,
            source=source,
            model_name="millennium_quality_target_model",
            max_upside=0.18,
            signal_strength=signal_strength,
            components={
                "quality": round(quality, 4),
                "durability": round(durability, 4),
                "valuation": round(valuation, 4),
                "stability": round(stability, 4),
                "risk": round(risk, 4),
            },
        )
