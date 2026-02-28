from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from main import app
from app.api import routes
from app.utils.jwt_handler import get_current_user


def _override_user(email: str, plan: str = "free", plan_expires_at=None):
    async def _dependency():
        return SimpleNamespace(
            id=1,
            email=email,
            plan=plan,
            plan_expires_at=plan_expires_at,
            is_active=True,
        )

    return _dependency


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides = {}


def test_gate_01_discovery_strategy_locked_for_free(client):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    response = client.post("/api/v1/discovery/scan", json={"strategy": "citadel_momentum"})
    assert response.status_code == 403
    payload = response.json()
    assert payload["error"]["code"] == "STRATEGY_LOCKED"


def test_gate_02_discovery_custom_thresholds_pro_required(client):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    response = client.post(
        "/api/v1/discovery/scan",
        json={"strategy": "core", "thresholds": {"technical": {"rsi_min": 55}}},
    )
    assert response.status_code == 403
    payload = response.json()
    assert payload["error"]["code"] == "PRO_REQUIRED"


def test_gate_03_discovery_results_capped_for_free(client, monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")

    fake_results = [
        {"ticker": f"STOCK{i}.NS", "score": 80 - i, "thesis": []}
        for i in range(15)
    ]
    monkeypatch.setattr(routes.market_scanner, "scan_market", lambda **kwargs: fake_results)
    monkeypatch.setattr(routes.portfolio_manager, "get_portfolio", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(routes.rebalancer, "analyze_portfolio", lambda *_args, **_kwargs: [])

    response = client.post("/api/v1/discovery/scan", json={"strategy": "core"})
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["scan_results"]) == 10
    assert payload["result_notice"]["code"] == "RESULTS_CAPPED"


def test_gate_04_analyze_daily_limit(client, monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    monkeypatch.setattr(routes, "check_daily_limit", lambda *_args, **_kwargs: True)

    response = client.post("/api/v1/analyze", json={"ticker": "TCS.NS"})
    assert response.status_code == 429
    payload = response.json()
    assert payload["error"]["code"] == "DAILY_LIMIT"


def test_gate_05_analyze_partial_thesis_for_free(client, monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    monkeypatch.setattr(routes, "check_daily_limit", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(
        routes.analyst,
        "generate_thesis",
        lambda _ticker, **_kwargs: {
            "recommendation": "BUY",
            "thesis": ["Summary line", "Second line"],
            "risk_factors": ["Risk 1", "Risk 2"],
            "confidence_score": 82,
            "data": {},
        },
    )

    response = client.post("/api/v1/analyze", json={"ticker": "INFY.NS"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["thesis"] == ["Summary line"]
    assert payload["risk_factors"] == ["Upgrade to Pro to view full analysis"]
    assert payload["data"]["code"] == "THESIS_PARTIAL"


def test_gate_06_portfolio_holding_limit(client, monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    monkeypatch.setattr(routes.portfolio_manager, "count_holdings", lambda *_args, **_kwargs: 10)

    payload = {
        "ticker": "TCS.NS",
        "buy_date": "2026-02-01",
        "buy_price": 3500.0,
        "quantity": 1,
    }
    response = client.post("/api/v1/portfolio/add", json=payload)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "HOLDING_LIMIT"


def test_gate_07_portfolio_history_limit(client):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    response = client.get("/api/v1/portfolio/history?period=1y")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "HISTORY_LIMIT"


def test_gate_08_rebalance_pro_required(client):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    response = client.get("/api/v1/portfolio/rebalance")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PRO_REQUIRED"


def test_gate_09_sell_ranking_limited_for_free(client, monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    monkeypatch.setattr(
        routes.portfolio_manager,
        "get_portfolio",
        lambda *_args, **_kwargs: [{"ticker": "ABC.NS", "buy_price": 100, "quantity": 1, "buy_date": "2025-01-01"}],
    )
    monkeypatch.setattr(
        routes.rebalancer,
        "analyze_portfolio",
        lambda *_args, **_kwargs: [{"ticker": "ABC.NS", "trend": "Bearish", "score": 60}],
    )

    response = client.get("/api/v1/portfolio/sell-ranking")
    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "momentum_only"
    assert payload["warning"]["error"]["code"] == "SELL_RANKING_LIMITED"


def test_gate_10_sync_hdfc_pro_required(client):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    response = client.post("/api/v1/portfolio/sync/hdfc")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PRO_REQUIRED"


def test_gate_11_sync_zerodha_pro_required(client):
    app.dependency_overrides[get_current_user] = _override_user("free@user.com", plan="free")
    response = client.post("/api/v1/portfolio/sync/zerodha")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PRO_REQUIRED"
