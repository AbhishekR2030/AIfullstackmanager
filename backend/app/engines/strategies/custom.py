"""Custom thresholds strategy pipeline."""

from app.engines.strategy_base import BaseStrategyPipeline


class CustomStrategyPipeline(BaseStrategyPipeline):
    strategy_id = "custom"
    strategy_label = "Custom Thresholds"
    strategy_tier = "pro"
    strategy_summary = "User-defined thresholds and scan logic."
    strategy_logic = [
        "Uses user-configured technical and fundamental bounds.",
        "Keeps shared liquidity and execution checks for safety.",
        "Best suited for manual hypothesis testing and iteration.",
    ]
