"""Core baseline strategy pipeline."""

from app.engines.strategy_base import BaseStrategyPipeline


class CoreStrategyPipeline(BaseStrategyPipeline):
    strategy_id = "core"
    strategy_label = "Alphaseeker Core"
    strategy_tier = "free"
    strategy_summary = "Balanced momentum + quality composite baseline."
    strategy_logic = [
        "Balanced score blending technical momentum and fundamental quality.",
        "Broad-market compatible filters for liquid trend candidates.",
        "Acts as the baseline model for free-tier and fallback scans.",
    ]
