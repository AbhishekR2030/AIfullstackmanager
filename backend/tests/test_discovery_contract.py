from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.utils.jwt_handler import get_current_user
from main import app


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides = {}


def _override_user(email: str, plan: str = "pro", plan_expires_at=None):
    async def _dependency():
        return SimpleNamespace(
            id=11,
            email=email,
            plan=plan,
            plan_expires_at=plan_expires_at,
            is_active=True,
        )

    return _dependency


def test_discovery_strategy_catalog_contract_for_free_user(client):
    app.dependency_overrides[get_current_user] = _override_user("free@test.com", plan="free")
    response = client.get("/api/v1/discovery/strategies")

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_plan"] == "free"
    assert isinstance(payload["strategies"], list)
    assert payload["strategies"]

    first = payload["strategies"][0]
    required_keys = {
        "strategy_id",
        "strategy_label",
        "strategy_tier",
        "strategy_summary",
        "strategy_logic",
        "locked",
    }
    assert required_keys.issubset(first.keys())

    tiers = {item["strategy_id"]: item["strategy_tier"] for item in payload["strategies"]}
    locks = {item["strategy_id"]: item["locked"] for item in payload["strategies"]}
    assert tiers.get("core") == "free"
    assert locks.get("core") is False
    assert locks.get("citadel_momentum") is True


def test_discovery_scan_response_contract_includes_metadata(client, monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("pro@test.com", plan="pro")

    monkeypatch.setattr(
        routes.market_scanner,
        "scan_market",
        lambda **_kwargs: [
            {
                "ticker": "TCS.NS",
                "price": 3800.0,
                "score": 88.2,
                "upside_potential": 12.4,
                "momentum_score": 72.1,
                "strategy_id": "citadel_momentum",
                "alpha_rationale": {"technical": "mock", "fundamental": "mock"},
                "risk_flags": [],
                "execution": {"slippage_bps": 7.5, "fill_probability": 0.81, "execution_quality": 92.5},
            }
        ],
    )
    monkeypatch.setattr(routes.market_scanner, "get_strategy_payload", lambda _s: {
        "strategy_id": "citadel_momentum",
        "strategy_label": "Citadel Momentum",
        "strategy_tier": "pro",
        "strategy_summary": "High-liquidity momentum and quality tilt.",
        "strategy_logic": ["Momentum", "Liquidity", "Quality"],
    })
    monkeypatch.setattr(routes.market_scanner, "last_scan_metadata", {"strategy_id": "citadel_momentum", "scan_time_seconds": 1.7})
    monkeypatch.setattr(routes.portfolio_manager, "get_portfolio", lambda _email: [])
    monkeypatch.setattr(routes.rebalancer, "analyze_portfolio", lambda _portfolio: [])
    monkeypatch.setattr(
        routes.analyst,
        "generate_thesis",
        lambda _ticker: {
            "thesis": ["mock thesis"],
            "risk_factors": ["mock risk"],
            "recommendation": "BUY",
            "confidence_score": 83,
        },
    )

    response = client.post("/api/v1/discovery/scan", json={"strategy": "citadel_momentum"})
    assert response.status_code == 200
    payload = response.json()

    for key in ["status", "strategy", "strategy_metadata", "scan_metadata", "scan_results", "portfolio_analysis", "swap_opportunities"]:
        assert key in payload

    assert payload["status"] == "complete"
    assert payload["strategy"] == "citadel_momentum"
    assert payload["strategy_metadata"]["strategy_id"] == "citadel_momentum"
    assert isinstance(payload["scan_results"], list)
    assert payload["scan_results"]

    candidate = payload["scan_results"][0]
    assert 0 <= candidate["score"] <= 100
    assert "alpha_rationale" in candidate
    assert "risk_flags" in candidate
    assert "execution" in candidate


def test_async_results_contract_includes_strategy_metadata(client, monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("pro@test.com", plan="pro")

    class FakeAsyncResult:
        state = "SUCCESS"
        result = {
            "strategy": "millennium_quality",
            "count": 1,
            "results": [{"ticker": "INFY.NS", "score": 79.1}],
        }

        def __init__(self, *_args, **_kwargs):
            pass

    monkeypatch.setattr(routes, "AsyncResult", FakeAsyncResult)
    monkeypatch.setattr(routes, "get_scan_results", lambda _job_id: [{"ticker": "INFY.NS", "score": 79.1}])
    monkeypatch.setattr(routes.market_scanner, "get_strategy_payload", lambda _s: {
        "strategy_id": "millennium_quality",
        "strategy_label": "Millennium Quality",
        "strategy_tier": "pro",
        "strategy_summary": "Quality-factor focused profitability and balance-sheet screen.",
        "strategy_logic": ["ROE", "ROCE", "Leverage"],
    })

    response = client.get("/api/v1/discovery/results/job-123")
    assert response.status_code == 200
    payload = response.json()

    assert payload["state"] == "SUCCESS"
    assert payload["strategy"] == "millennium_quality"
    assert payload["strategy_metadata"]["strategy_id"] == "millennium_quality"
    assert isinstance(payload["scan_results"], list)
