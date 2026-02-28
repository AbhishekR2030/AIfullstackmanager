import hashlib

from app.engines.zerodha_engine import ZerodhaEngine


def test_exchange_request_token_uses_sha256_checksum(monkeypatch):
    engine = ZerodhaEngine()
    engine.api_key = "kite-key"
    engine.api_secret = "kite-secret"
    captured = {}

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"data": {"access_token": "token-123"}}

    def _fake_post(url, data=None, timeout=15):
        captured["url"] = url
        captured["data"] = data
        return _Resp()

    monkeypatch.setattr("app.engines.zerodha_engine.requests.post", _fake_post)
    result = engine.exchange_request_token("request-xyz", "zerodha-user@demo.com")

    expected = hashlib.sha256("kite-keyrequest-xyzkite-secret".encode("utf-8")).hexdigest()
    assert "error" not in result
    assert captured["data"]["checksum"] == expected
    token_row = engine._get_broker_token("zerodha-user@demo.com")
    assert token_row is not None
    assert token_row.access_token == "token-123"


def test_fetch_holdings_returns_expired_error_on_401(monkeypatch):
    engine = ZerodhaEngine()
    engine.api_key = "kite-key"

    class _Resp:
        status_code = 401

        @staticmethod
        def json():
            return {}

    monkeypatch.setattr(engine, "_resolve_valid_token", lambda _email: {"token": "abc"})
    monkeypatch.setattr("app.engines.zerodha_engine.requests.get", lambda *_args, **_kwargs: _Resp())

    result = engine.fetch_holdings("u@demo.com")
    assert result["error"] == "BROKER_TOKEN_EXPIRED"


def test_to_portfolio_items_maps_symbols_to_yahoo_format():
    engine = ZerodhaEngine()
    rows = engine.to_portfolio_items(
        [
            {"tradingsymbol": "INFY", "quantity": 2, "average_price": 1510.5},
            {"tradingsymbol": "SBIN", "quantity": 0, "average_price": 801.0},
        ]
    )
    assert len(rows) == 1
    assert rows[0]["ticker"] == "INFY.NS"
    assert rows[0]["source"] == "ZERODHA"
