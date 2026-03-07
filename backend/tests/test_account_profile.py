from types import SimpleNamespace
from typing import Optional

from fastapi.testclient import TestClient

from app.api import routes
from app.utils.jwt_handler import get_current_user
from main import app


def _override_user(
    email: str,
    plan: str = "free",
    billing_plan: Optional[str] = None,
    plan_expires_at=None,
):
    async def _dependency():
        return SimpleNamespace(
            id=1,
            email=email,
            plan=plan,
            billing_plan=billing_plan,
            plan_expires_at=plan_expires_at,
            is_active=True,
        )

    return _dependency


def test_account_profile_returns_pricing_and_entitlements():
    app.dependency_overrides[get_current_user] = _override_user(
        "subscriber@example.com",
        plan="pro",
        billing_plan="monthly",
    )

    with TestClient(app) as client:
        response = client.get("/api/v1/account/profile")

    assert response.status_code == 200
    payload = response.json()
    assert payload["profile"]["email"] == "subscriber@example.com"
    assert payload["profile"]["plan"] == "pro"
    assert payload["subscription"]["entitlements"]["rebalancing"] is True
    assert payload["subscription"]["entitlements"]["strategy_access"] == "all"
    assert payload["subscription"]["can_subscribe"] is False
    assert len(payload["pricing"]) == 3

    app.dependency_overrides = {}


def test_account_profile_update_persists_fields(monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("builder@example.com", plan="free")

    updated_user = SimpleNamespace(
        id=1,
        email="builder@example.com",
        plan="free",
        billing_plan=None,
        plan_expires_at=None,
        first_name="Abhishek",
        middle_name="C",
        last_name="Reddy",
        profession="Investor",
    )

    monkeypatch.setattr(routes.auth_engine, "update_user_profile", lambda *args, **kwargs: updated_user)

    with TestClient(app) as client:
        response = client.put(
            "/api/v1/account/profile",
            json={
                "first_name": "Abhishek",
                "middle_name": "C",
                "last_name": "Reddy",
                "profession": "Investor",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["profile"]["first_name"] == "Abhishek"
    assert payload["profile"]["profession"] == "Investor"

    app.dependency_overrides = {}


def test_razorpay_order_returns_config_error_when_not_set(monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("free@example.com", plan="free")
    monkeypatch.setattr(routes, "_razorpay_credentials", lambda: ("", ""))

    with TestClient(app) as client:
        response = client.post("/api/v1/billing/razorpay/order", json={"plan": "monthly"})

    assert response.status_code == 503
    payload = response.json()
    assert payload["error"]["code"] == "PAYMENT_NOT_CONFIGURED"

    app.dependency_overrides = {}


def test_discovery_scan_rotates_ranked_buys_for_multiple_sells(monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("pro@example.com", plan="pro")

    monkeypatch.setattr(
        routes.market_scanner,
        "scan_market",
        lambda **_kwargs: [
            {"ticker": "BUY1.NS", "score": 92, "price": 100.0, "thesis": []},
            {"ticker": "BUY2.NS", "score": 86, "price": 140.0, "thesis": []},
            {"ticker": "BUY3.NS", "score": 78, "price": 180.0, "thesis": []},
        ],
    )
    monkeypatch.setattr(
        routes.portfolio_manager,
        "get_portfolio",
        lambda *_args, **_kwargs: [
            {"ticker": "SELL1.NS", "buy_price": 100.0, "quantity": 5},
            {"ticker": "SELL2.NS", "buy_price": 100.0, "quantity": 5},
        ],
    )
    monkeypatch.setattr(
        routes.rebalancer,
        "analyze_portfolio",
        lambda *_args, **_kwargs: [
            {"ticker": "SELL1.NS", "sell_urgency_score": 82, "recommendation": "SELL_CANDIDATE", "trend": "Bearish", "pl_percent": 24.0},
            {"ticker": "SELL2.NS", "sell_urgency_score": 67, "recommendation": "SELL_CANDIDATE", "trend": "Bearish", "pl_percent": 18.0},
        ],
    )

    with TestClient(app) as client:
        response = client.post("/api/v1/discovery/scan", json={"strategy": "core"})

    assert response.status_code == 200
    payload = response.json()
    assert [item["buy"] for item in payload["swap_opportunities"]] == ["BUY1.NS", "BUY2.NS"]

    app.dependency_overrides = {}
