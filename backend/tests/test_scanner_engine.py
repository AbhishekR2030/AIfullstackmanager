from app.engines import scanner_engine as scanner_mod
from app.engines.scanner_engine import CITADEL_MOMENTUM, MarketScanner


def test_strategy_preset_and_custom_override_resolution():
    scanner = MarketScanner()
    preset = scanner._resolve_scan_config("citadel_momentum", None)
    assert preset == CITADEL_MOMENTUM

    custom = scanner._resolve_scan_config(
        "custom",
        {
            "technical": {"rsi_min": 44, "volume_multiplier": 2.0, "min_turnover_cr": 3},
            "fundamental": {"rev_growth_min": 12, "debt_equity_max": 80, "moat_check": True},
        },
    )
    assert custom.strategy == "custom"
    assert custom.rsi_min == 44
    assert custom.volume_multiplier == 2.0
    assert custom.min_turnover_cr == 3
    assert custom.rev_growth_min == 12
    assert custom.max_debt_equity == 80
    assert custom.moat_check is True


def test_moat_check_accepts_decimal_and_percent_roe():
    scanner = MarketScanner()
    info = {"beta": 1.0}
    assert scanner._economic_moat_check(info, 0.24) is True
    assert scanner._economic_moat_check(info, 24.0) is True
    assert scanner._economic_moat_check(info, 0.08) is False


def test_composite_upside_score_is_bounded():
    scanner = MarketScanner()
    cfg = scanner._resolve_scan_config("core", None)
    score = scanner._composite_upside_score(
        {
            "rsi": 120,
            "macd_hist": 100,
            "roe": 80,
            "rev_growth": 250,
            "pe_ratio": 1,
        },
        cfg,
    )
    assert 0.0 <= score <= 100.0


def test_free_plan_cache_and_result_cap():
    scanner = MarketScanner()
    scanner.cache = [{"ticker": f"TICK{i}.NS", "score": 90 - i} for i in range(12)]
    scanner.last_scan_time = scanner_mod.time.time()

    pro_results = scanner.scan_market(strategy="core", user_plan="pro")
    free_results = scanner.scan_market(strategy="core", user_plan="free")
    assert len(pro_results) == 12
    assert len(free_results) == 10
