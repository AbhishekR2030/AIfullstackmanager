"""Strategy pipeline registry for discovery scans."""

from __future__ import annotations

from dataclasses import asdict
from typing import Dict, List

from app.engines.strategy_base import StrategyPipeline, StrategyScanMetadata
from app.engines.strategies.citadel_momentum import CitadelMomentumPipeline
from app.engines.strategies.core import CoreStrategyPipeline
from app.engines.strategies.custom import CustomStrategyPipeline
from app.engines.strategies.de_shaw_multifactor import DEShawMultiFactorPipeline
from app.engines.strategies.jane_street_stat import JaneStreetStatPipeline
from app.engines.strategies.millennium_quality import MillenniumQualityPipeline


ALIASES: Dict[str, str] = {
    "alphaseeker_core": "core",
    "custom_trade": "custom",
    "janestreet_quant": "jane_street_stat",
    "jane_street": "jane_street_stat",
    "deshaw_quality": "de_shaw_multifactor",
    "de_shaw_quality": "de_shaw_multifactor",
}


class StrategyRegistry:
    """Holds strategy pipeline instances and normalization aliases."""

    def __init__(self) -> None:
        pipelines: List[StrategyPipeline] = [
            CoreStrategyPipeline(),
            CustomStrategyPipeline(),
            CitadelMomentumPipeline(),
            JaneStreetStatPipeline(),
            MillenniumQualityPipeline(),
            DEShawMultiFactorPipeline(),
        ]
        self._pipelines: Dict[str, StrategyPipeline] = {
            pipeline.strategy_id: pipeline for pipeline in pipelines
        }

    def normalize(self, strategy_id: str) -> str:
        value = (strategy_id or "core").strip().lower()
        if not value:
            return "core"
        value = ALIASES.get(value, value)
        return value if value in self._pipelines else "core"

    def get(self, strategy_id: str) -> StrategyPipeline:
        normalized = self.normalize(strategy_id)
        return self._pipelines[normalized]

    def list_metadata(self) -> List[StrategyScanMetadata]:
        ordered_ids = [
            "core",
            "custom",
            "citadel_momentum",
            "jane_street_stat",
            "millennium_quality",
            "de_shaw_multifactor",
        ]
        result: List[StrategyScanMetadata] = []
        for strategy_id in ordered_ids:
            pipeline = self._pipelines[strategy_id]
            result.append(
                StrategyScanMetadata(
                    strategy_id=pipeline.strategy_id,
                    strategy_label=pipeline.strategy_label,
                    strategy_tier=pipeline.strategy_tier,
                    strategy_summary=pipeline.strategy_summary,
                    strategy_logic=list(pipeline.strategy_logic),
                )
            )
        return result

    def to_payload(self) -> List[Dict[str, object]]:
        return [asdict(item) for item in self.list_metadata()]
