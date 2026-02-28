import pytest

from app.engines.rebalancer_engine import RebalancerEngine

try:
    from hypothesis import given, strategies as st
    HYPOTHESIS_AVAILABLE = True
except Exception:
    HYPOTHESIS_AVAILABLE = False


def test_compute_sell_urgency_handles_missing_fields():
    engine = RebalancerEngine()
    result = engine.compute_sell_urgency(
        holding={"ticker": "ABC.NS"},
        market_data={},
        top_scan_score=None,
    )
    assert 0 <= result["score"] <= 100
    assert result["badge"] in {"SELL", "REVIEW", "WATCH", "HOLD"}
    assert isinstance(result["primary_signal"], str)


@pytest.mark.skipif(not HYPOTHESIS_AVAILABLE, reason="hypothesis not installed")
@given(
    rsi=st.floats(min_value=0, max_value=100, allow_nan=False, allow_infinity=False),
    macd=st.floats(min_value=-10, max_value=10, allow_nan=False, allow_infinity=False),
    score=st.floats(min_value=0, max_value=100, allow_nan=False, allow_infinity=False),
    top_scan=st.one_of(st.none(), st.floats(min_value=0, max_value=100, allow_nan=False, allow_infinity=False)),
    drawdown=st.floats(min_value=0, max_value=60, allow_nan=False, allow_infinity=False),
    rev_growth=st.floats(min_value=-1, max_value=1, allow_nan=False, allow_infinity=False),
)
def test_compute_sell_urgency_property_bounds(rsi, macd, score, top_scan, drawdown, rev_growth):
    engine = RebalancerEngine()
    result = engine.compute_sell_urgency(
        holding={"score": score},
        market_data={
            "rsi": rsi,
            "macd_hist": macd,
            "asset_score": score,
            "drawdown_from_buy": drawdown,
            "rev_growth": rev_growth,
        },
        top_scan_score=top_scan,
    )
    assert 0 <= result["score"] <= 100
    assert result["badge"] in {"SELL", "REVIEW", "WATCH", "HOLD"}


def test_get_rebalancing_suggestions_creates_swap_pairs(monkeypatch):
    engine = RebalancerEngine()

    from app.engines import portfolio_engine as portfolio_module
    from app.engines import scanner_engine as scanner_module

    monkeypatch.setattr(
        portfolio_module.portfolio_manager,
        "get_portfolio",
        lambda _email: [{"ticker": "OLD.NS", "buy_price": 100.0, "quantity": 10, "total_value": 1000.0}],
    )
    monkeypatch.setattr(
        engine,
        "analyze_portfolio",
        lambda _portfolio, new_candidates=None: [
            {
                "ticker": "OLD.NS",
                "sell_urgency_score": 74,
                "sell_urgency_badge": "SELL",
                "primary_sell_signal": "Momentum deterioration",
                "total_value": 1000.0,
            }
        ],
    )

    scanner_module.scanner.cache = [
        {"ticker": "NEW.NS", "score": 88, "price": 200.0},
        {"ticker": "ALT.NS", "score": 82, "price": 180.0},
    ]

    result = engine.get_rebalancing_suggestions("user@demo.com", db=None, redis=None)
    assert result["sell_candidates"]
    assert result["buy_recommendations"]
    assert result["swap_pairs"]
    assert result["swap_pairs"][0]["buy"]["ticker"] == "NEW.NS"
