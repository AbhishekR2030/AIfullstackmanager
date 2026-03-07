from types import SimpleNamespace

import json
import math
import pandas as pd

from app.engines.scanner_engine import MarketScanner
from app.engines.strategy_base import ScanRuntimeContext
from app.engines.strategies.core import CoreStrategyPipeline


def _sample_ohlcv(rows: int = 90) -> pd.DataFrame:
    closes = [100 + (index * 0.8) for index in range(rows)]
    volumes = [1_200_000 + (index * 1200) for index in range(rows)]
    return pd.DataFrame({"Close": closes, "Volume": volumes})


def _scan_ready_ohlcv(rows: int = 90) -> pd.DataFrame:
    closes = [100 * (1 + 0.0025 * index + 0.06 * math.sin(index / 4)) for index in range(rows)]
    volumes = [1_200_000] * (rows - 1) + [2_500_000]
    return pd.DataFrame({"Close": closes, "Volume": volumes})


def test_strategy_catalog_contains_hybrid_set():
    scanner = MarketScanner()
    payload = scanner.get_supported_strategies()

    strategy_ids = [item["strategy_id"] for item in payload]
    assert strategy_ids == [
        "core",
        "custom",
        "citadel_momentum",
        "jane_street_stat",
        "millennium_quality",
        "de_shaw_multifactor",
    ]
    assert all("strategy_logic" in item and isinstance(item["strategy_logic"], list) for item in payload)


def test_shared_platform_layers_execute_in_scan(monkeypatch):
    scanner = MarketScanner()
    calls = []

    ohlcv = _sample_ohlcv()

    class StubPipeline:
        strategy_id = "citadel_momentum"
        strategy_label = "Citadel Momentum"
        strategy_tier = "pro"
        strategy_summary = "stub"
        strategy_logic = ["stub logic"]

        def compute_technical_features(self, df, context):
            calls.append("pipeline.compute")
            return {
                "current_price": float(df["Close"].iloc[-1]),
                "avg_vol_20": float(df["Volume"].rolling(20).mean().iloc[-1]),
                "current_vol": float(df["Volume"].iloc[-1]),
                "vol_shock": 2.0,
                "monthly_vol": 5.2,
                "sma_20": float(df["Close"].rolling(20).mean().iloc[-1]),
                "sma_50": float(df["Close"].rolling(50).mean().iloc[-1]),
            }

        def technical_filter(self, features, context, config):
            calls.append("pipeline.technical_filter")
            return True

        def evaluate_fundamentals(self, info_proxy, context, config):
            calls.append("pipeline.evaluate_fundamentals")
            return True, []

        def adjust_score(self, base_score, features, info_proxy, fundamentals_passed, context, config):
            calls.append("pipeline.adjust_score")
            return min(100.0, float(base_score) + 2.0)

        def build_technical_reason(self, features, context):
            calls.append("pipeline.reason")
            return "stub reason"

    def fake_load_universe(region):
        calls.append("data.load_universe")
        return ["ABC.NS"]

    def fake_fetch_ohlcv(tickers, period="3mo"):
        calls.append("data.fetch_ohlcv")
        return ohlcv

    def fake_evaluate_liquidity(features, config, region):
        calls.append("risk.evaluate_liquidity")
        return True, "ok", {"turnover_cr": 25.0, "daily_turnover_inr": 250000000.0}

    def fake_select_candidates(candidates, limit=30):
        calls.append("execution.select_candidates")
        return candidates

    def fake_estimate_execution(features, region):
        calls.append("execution.estimate")
        return {
            "slippage_bps": 8.5,
            "fill_probability": 0.82,
            "execution_quality": 91.5,
            "region": region,
        }

    def fake_attach_portfolio(candidates, holdings=None):
        calls.append("accounting.attach_portfolio")
        return candidates

    def fake_start_scan(strategy_id, region):
        calls.append("monitor.start")
        return SimpleNamespace(
            strategy_id=strategy_id,
            region=region,
            counters={},
            notes=[],
            increment=lambda key, value=1: None,
            add_note=lambda note: None,
            snapshot=lambda: {"strategy_id": strategy_id, "region": region, "scan_time_seconds": 0.1},
        )

    def fake_finalize_scan(telemetry):
        calls.append("monitor.finalize")
        return {"strategy_id": telemetry.strategy_id, "region": telemetry.region, "scan_time_seconds": 0.2}

    monkeypatch.setattr(scanner.strategy_registry, "normalize", lambda _strategy: "citadel_momentum")
    monkeypatch.setattr(scanner.strategy_registry, "get", lambda _strategy: StubPipeline())
    monkeypatch.setattr(scanner.data_platform, "load_universe", fake_load_universe)
    monkeypatch.setattr(scanner.data_platform, "fetch_ohlcv", fake_fetch_ohlcv)
    monkeypatch.setattr(scanner.risk_guard, "evaluate_liquidity", fake_evaluate_liquidity)
    monkeypatch.setattr(scanner.execution_simulator, "select_fundamental_candidates", fake_select_candidates)
    monkeypatch.setattr(scanner.execution_simulator, "estimate_execution", fake_estimate_execution)
    monkeypatch.setattr(scanner.portfolio_accounting, "attach_portfolio_context", fake_attach_portfolio)
    monkeypatch.setattr(scanner.monitoring, "start_scan", fake_start_scan)
    monkeypatch.setattr(scanner.monitoring, "finalize_scan", fake_finalize_scan)
    monkeypatch.setattr(
        scanner,
        "_fetch_yahoo_fundamentals",
        lambda _ticker, _region: {
            "source": "YahooFinance",
            "revenue_growth_yoy": 0.16,
            "return_on_equity": 0.24,
            "return_on_capital_employed": 0.21,
            "profit_growth_yoy": 0.18,
            "debt_to_equity": 22,
            "sector": "Financial Services",
            "beta": 1.1,
            "trailing_pe": 18,
        },
    )

    results = scanner.scan_market(region="IN", strategy="citadel_momentum", thresholds={}, user_plan="pro")

    assert len(results) == 1
    first = results[0]
    assert first["strategy_id"] == "citadel_momentum"
    assert "alpha_rationale" in first
    assert "risk_flags" in first
    assert "execution" in first
    assert 0 <= first["score"] <= 100

    expected_calls = {
        "monitor.start",
        "data.load_universe",
        "data.fetch_ohlcv",
        "pipeline.compute",
        "risk.evaluate_liquidity",
        "pipeline.technical_filter",
        "execution.select_candidates",
        "pipeline.evaluate_fundamentals",
        "pipeline.adjust_score",
        "execution.estimate",
        "accounting.attach_portfolio",
        "monitor.finalize",
    }
    assert expected_calls.issubset(set(calls))


def test_scan_market_free_plan_still_caps_results_with_hybrid_cache(monkeypatch):
    scanner = MarketScanner()
    key = scanner._cache_key("IN", "core", None)
    scanner.cache_by_key[key] = {
        "results": [{"ticker": f"T{i}.NS", "score": 90 - i} for i in range(15)],
        "timestamp": scanner.last_scan_time or 9999999999,
        "strategy_id": "core",
    }

    # Keep cache fresh
    monkeypatch.setattr("app.engines.scanner_engine.time.time", lambda: 1000.0)
    scanner.cache_by_key[key]["timestamp"] = 999.0

    results = scanner.scan_market(region="IN", strategy="core", thresholds={}, user_plan="free")
    assert len(results) == 10


def test_legacy_cache_does_not_bleed_between_strategies(monkeypatch):
    scanner = MarketScanner()
    scanner.cache = [{"ticker": "COREA.NS", "score": 99.0}]
    scanner.last_scan_time = 999.0
    scanner.legacy_cache_context = {
        "region": "IN",
        "strategy": "core",
        "thresholds_empty": True,
    }

    calls = {"load_universe": 0}

    def fake_load_universe(_region):
        calls["load_universe"] += 1
        return []

    monkeypatch.setattr("app.engines.scanner_engine.time.time", lambda: 1000.0)
    monkeypatch.setattr(scanner.data_platform, "load_universe", fake_load_universe)
    monkeypatch.setattr(scanner.data_platform, "fetch_ohlcv", lambda _tickers, period="3mo": pd.DataFrame())

    results = scanner.scan_market(region="IN", strategy="jane_street_stat", thresholds={}, user_plan="pro")

    assert results == []
    assert calls["load_universe"] == 1


def test_scan_result_serialization_handles_nan_fundamentals(monkeypatch):
    scanner = MarketScanner()
    ohlcv = _sample_ohlcv()

    class StubPipeline:
        strategy_id = "jane_street_stat"
        strategy_label = "Jane Street Statistical"
        strategy_tier = "pro"
        strategy_summary = "stub"
        strategy_logic = ["stub logic"]

        def compute_technical_features(self, df, context):
            return {
                "current_price": float(df["Close"].iloc[-1]),
                "avg_vol_20": float(df["Volume"].rolling(20).mean().iloc[-1]),
                "current_vol": float(df["Volume"].iloc[-1]),
                "vol_shock": 2.2,
                "monthly_vol": 4.9,
                "sma_20": float(df["Close"].rolling(20).mean().iloc[-1]),
                "sma_50": float(df["Close"].rolling(50).mean().iloc[-1]),
            }

        def technical_filter(self, features, context, config):
            return True

        def evaluate_fundamentals(self, info_proxy, context, config):
            return True, []

        def adjust_score(self, base_score, features, info_proxy, fundamentals_passed, context, config):
            return float(base_score)

        def build_technical_reason(self, features, context):
            return "stub"

    monkeypatch.setattr(scanner.strategy_registry, "normalize", lambda _strategy: "jane_street_stat")
    monkeypatch.setattr(scanner.strategy_registry, "get", lambda _strategy: StubPipeline())
    monkeypatch.setattr(scanner.data_platform, "load_universe", lambda _region: ["RELIANCE.NS"])
    monkeypatch.setattr(scanner.data_platform, "fetch_ohlcv", lambda _tickers, period="3mo": ohlcv)
    monkeypatch.setattr(
        scanner.risk_guard,
        "evaluate_liquidity",
        lambda _features, _config, _region: (True, "ok", {"turnover_cr": 18.0, "daily_turnover_inr": 180000000.0}),
    )
    monkeypatch.setattr(scanner.execution_simulator, "select_fundamental_candidates", lambda candidates, limit=30: candidates)
    monkeypatch.setattr(
        scanner.execution_simulator,
        "estimate_execution",
        lambda _features, region: {"slippage_bps": 8.0, "fill_probability": 0.8, "execution_quality": 92.0, "region": region},
    )
    monkeypatch.setattr(scanner.portfolio_accounting, "attach_portfolio_context", lambda candidates, holdings=None: candidates)
    monkeypatch.setattr(
        scanner.monitoring,
        "start_scan",
        lambda strategy_id, region: SimpleNamespace(
            strategy_id=strategy_id,
            region=region,
            counters={},
            notes=[],
            increment=lambda key, value=1: None,
            add_note=lambda note: None,
        ),
    )
    monkeypatch.setattr(scanner.monitoring, "finalize_scan", lambda telemetry: {"strategy_id": telemetry.strategy_id})
    monkeypatch.setattr(
        scanner,
        "_fetch_yahoo_fundamentals",
        lambda _ticker, _region: {
            "source": "YahooFinance",
            "revenue_growth_yoy": 0.12,
            "return_on_equity": 0.18,
            "return_on_capital_employed": float("nan"),
            "profit_growth_yoy": 0.09,
            "debt_to_equity": 45.0,
            "sector": "Energy",
            "beta": float("nan"),
            "trailing_pe": 18.0,
        },
    )

    results = scanner.scan_market(region="IN", strategy="jane_street_stat", thresholds={}, user_plan="pro")

    assert len(results) == 1
    candidate = results[0]
    assert candidate["fundamentals"]["roce"] == 0.0
    assert candidate["beta"] == 1.0

    # Mirrors FastAPI's strict JSON serialization behavior.
    json.dumps(results, allow_nan=False)


def test_strategy_specific_target_models_diverge_without_analyst_target():
    scanner = MarketScanner()
    features = {
        "current_price": 100.0,
        "avg_vol_20": 1_500_000.0,
        "current_vol": 3_600_000.0,
        "vol_shock": 2.4,
        "monthly_vol": 5.6,
        "sma_20": 96.5,
        "sma_50": 93.2,
        "rsi": 58.0,
        "macd_hist": 1.15,
        "rsi_slope_5": 3.2,
    }
    info_proxy = {
        "quoteType": "EQUITY",
        "revenueGrowth": 0.17,
        "profitGrowth": 0.13,
        "returnOnEquity": 0.24,
        "roce": 0.22,
        "debtToEquity": 28.0,
        "beta": 1.04,
        "targetMeanPrice": 0.0,
        "trailingPE": 20.0,
        "forwardPE": 18.0,
        "pegRatio": 1.1,
    }

    projections = {}
    for strategy_id in [
        "core",
        "citadel_momentum",
        "jane_street_stat",
        "millennium_quality",
        "de_shaw_multifactor",
    ]:
        pipeline = scanner.strategy_registry.get(strategy_id)
        projection = pipeline.project_target(
            current_price=100.0,
            features=features,
            info_proxy=info_proxy,
            context=ScanRuntimeContext(
                region="IN",
                strategy_id=strategy_id,
                thresholds={},
                user_plan="pro",
                volatility_min=3.0,
                volatility_max=8.0,
            ),
            config=scanner._resolve_scan_config(strategy_id),
        )
        projections[strategy_id] = round(projection.upside_pct, 4)

    assert projections["citadel_momentum"] > projections["jane_street_stat"]
    assert projections["millennium_quality"] != projections["de_shaw_multifactor"]
    assert projections["core"] != 0.2
    assert len(set(projections.values())) == len(projections)


def test_scan_market_does_not_inject_synthetic_twenty_percent_target(monkeypatch):
    scanner = MarketScanner()
    ohlcv = _scan_ready_ohlcv()

    class ScanReadyCorePipeline(CoreStrategyPipeline):
        def compute_technical_features(self, df, context):
            return {
                "current_price": float(df["Close"].iloc[-1]),
                "avg_vol_20": float(df["Volume"].rolling(20).mean().iloc[-1]),
                "current_vol": float(df["Volume"].iloc[-1]),
                "vol_shock": 1.98,
                "monthly_vol": 4.8,
                "sma_20": float(df["Close"].rolling(20).mean().iloc[-1]),
                "sma_50": float(df["Close"].rolling(50).mean().iloc[-1]),
                "rsi": 58.0,
                "macd_hist": 0.85,
                "rsi_slope_5": 1.4,
            }

        def technical_filter(self, features, context, config):
            return True

    monkeypatch.setattr(scanner.data_platform, "load_universe", lambda _region: ["INFY.NS"])
    monkeypatch.setattr(scanner.data_platform, "fetch_ohlcv", lambda _tickers, period="3mo": ohlcv)
    monkeypatch.setattr(scanner.strategy_registry, "normalize", lambda _strategy: "core")
    monkeypatch.setattr(scanner.strategy_registry, "get", lambda _strategy: ScanReadyCorePipeline())
    monkeypatch.setattr(
        scanner.risk_guard,
        "evaluate_liquidity",
        lambda _features, _config, _region: (True, "ok", {"turnover_cr": 18.0, "daily_turnover_inr": 180000000.0}),
    )
    monkeypatch.setattr(scanner.execution_simulator, "select_fundamental_candidates", lambda candidates, limit=30: candidates)
    monkeypatch.setattr(
        scanner.execution_simulator,
        "estimate_execution",
        lambda _features, region: {"slippage_bps": 7.5, "fill_probability": 0.84, "execution_quality": 93.0, "region": region},
    )
    monkeypatch.setattr(scanner.portfolio_accounting, "attach_portfolio_context", lambda candidates, holdings=None: candidates)
    monkeypatch.setattr(
        scanner.monitoring,
        "start_scan",
        lambda strategy_id, region: SimpleNamespace(
            strategy_id=strategy_id,
            region=region,
            counters={},
            notes=[],
            increment=lambda key, value=1: None,
            add_note=lambda note: None,
        ),
    )
    monkeypatch.setattr(scanner.monitoring, "finalize_scan", lambda telemetry: {"strategy_id": telemetry.strategy_id})
    monkeypatch.setattr(
        scanner,
        "_fetch_yahoo_fundamentals",
        lambda _ticker, _region: {
            "source": "YahooFinance",
            "revenue_growth_yoy": 0.15,
            "return_on_equity": 0.21,
            "return_on_capital_employed": 0.19,
            "profit_growth_yoy": 0.14,
            "debt_to_equity": 24.0,
            "sector": "Technology",
            "beta": 1.05,
            "trailing_pe": 22.0,
            "forward_pe": 19.0,
            "peg_ratio": 1.2,
            "target_mean_price": 0.0,
        },
    )

    results = scanner.scan_market(region="IN", strategy="core", thresholds={}, user_plan="pro")

    assert len(results) == 1
    candidate = results[0]
    assert candidate["target_source"] == "strategy_model"
    assert candidate["upside_potential"] != 20.0
    assert candidate["target_price"] > candidate["price"]
