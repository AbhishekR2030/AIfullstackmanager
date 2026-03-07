from types import SimpleNamespace
from urllib.parse import parse_qs, quote, urlparse

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
            id=21,
            email=email,
            plan=plan,
            plan_expires_at=plan_expires_at,
            is_active=True,
        )

    return _dependency


def test_zerodha_login_issues_signed_state(client, monkeypatch):
    app.dependency_overrides[get_current_user] = _override_user("pro@test.com", plan="pro")
    captured = {}

    def fake_get_login_url(redirect_params=None):
        captured["redirect_params"] = redirect_params or {}
        return "https://kite.zerodha.test/connect/login"

    monkeypatch.setattr(routes.zerodha_engine, "get_login_url", fake_get_login_url)

    response = client.get("/api/v1/auth/zerodha/login?app_redirect=com.alphaseeker.india://zerodha/callback")
    assert response.status_code == 200

    auth_state = captured["redirect_params"]["auth_state"]
    decoded = routes._decode_zerodha_auth_state(auth_state)
    assert decoded["user_email"] == "pro@test.com"
    assert decoded["app_redirect"] == "com.alphaseeker.india://zerodha/callback"


def test_zerodha_callback_redirects_back_to_app_and_exchanges_token(client, monkeypatch):
    auth_state = routes._create_zerodha_auth_state(
        "pro@test.com",
        "com.alphaseeker.india://zerodha/callback",
    )
    observed = {}

    def fake_exchange(request_token, user_email):
        observed["request_token"] = request_token
        observed["user_email"] = user_email
        return {"access_token": "kite-access", "expires_at": "2026-03-08T00:30:00"}

    monkeypatch.setattr(routes.zerodha_engine, "exchange_request_token", fake_exchange)

    response = client.get(
        f"/api/v1/auth/zerodha/callback?request_token=req-token-1&status=success&auth_state={quote(auth_state, safe='')}",
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert observed == {
        "request_token": "req-token-1",
        "user_email": "pro@test.com",
    }

    location = response.headers["location"]
    parsed = urlparse(location)
    params = parse_qs(parsed.query)
    assert parsed.scheme == "com.alphaseeker.india"
    assert params["broker"] == ["zerodha"]
    assert params["status"] == ["success"]
    assert params["expires_at"] == ["2026-03-08T00:30:00"]


def test_zerodha_callback_redirects_error_when_login_not_successful(client):
    auth_state = routes._create_zerodha_auth_state(
        "pro@test.com",
        "com.alphaseeker.india://zerodha/callback",
    )

    response = client.get(
        f"/api/v1/auth/zerodha/callback?status=cancelled&auth_state={quote(auth_state, safe='')}",
        follow_redirects=False,
    )

    assert response.status_code == 302
    params = parse_qs(urlparse(response.headers["location"]).query)
    assert params["broker"] == ["zerodha"]
    assert params["status"] == ["error"]
    assert "cancelled" in params["error"][0]
