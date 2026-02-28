from datetime import datetime

from app.engines.analyst_engine import AnalystEngine, ThesisCache, genai
from app.engines.auth_engine import SessionLocal, UsageLog


def test_generate_thesis_uses_db_cache(monkeypatch):
    db = SessionLocal()
    user_email = "cache_test_user@alphaseeker.dev"
    ticker = "CACHE1.NS"
    call_counter = {"count": 0}

    class _FakeModel:
        def __init__(self, _name):
            pass

        def generate_content(self, _prompt):
            call_counter["count"] += 1
            class _Response:
                text = (
                    '{"recommendation":"BUY","thesis":["a","b","c"],'
                    '"risk_factors":["r1","r2","r3"],"confidence_score":85}'
                )
            return _Response()

    engine = AnalystEngine()
    engine.api_key = "test-key"
    engine.models = ["models/fake-model"]

    monkeypatch.setattr(genai, "GenerativeModel", _FakeModel)
    monkeypatch.setattr(engine, "fetch_market_data", lambda _ticker: {"symbol": _ticker})
    monkeypatch.setattr(engine, "fetch_news", lambda _ticker: [])
    monkeypatch.setattr(engine, "get_macro_data", lambda: {"repo_rate": "6.5%"})

    db.query(ThesisCache).filter(
        ThesisCache.user_email == user_email,
        ThesisCache.ticker == ticker,
    ).delete()
    db.query(UsageLog).filter(
        UsageLog.user_email == user_email,
        UsageLog.action == "thesis",
    ).delete()
    db.commit()

    first = engine.generate_thesis(ticker, user_email=user_email, db=db, force_refresh=False)
    second = engine.generate_thesis(ticker, user_email=user_email, db=db, force_refresh=False)

    assert first["cached"] is False
    assert second["cached"] is True
    assert call_counter["count"] == 1
    usage_count = db.query(UsageLog).filter(
        UsageLog.user_email == user_email,
        UsageLog.action == "thesis",
    ).count()
    assert usage_count == 1
    assert db.query(ThesisCache).filter(
        ThesisCache.user_email == user_email,
        ThesisCache.ticker == ticker,
        ThesisCache.expires_at > datetime.utcnow(),
    ).count() >= 1
    db.close()


def test_force_refresh_bypasses_cache(monkeypatch):
    db = SessionLocal()
    user_email = "force_refresh_user@alphaseeker.dev"
    ticker = "CACHE2.NS"
    call_counter = {"count": 0}

    class _FakeModel:
        def __init__(self, _name):
            pass

        def generate_content(self, _prompt):
            call_counter["count"] += 1
            payload = (
                '{"recommendation":"BUY","thesis":["a"],'
                '"risk_factors":["r"],"confidence_score":80}'
            )
            class _Response:
                text = payload
            return _Response()

    engine = AnalystEngine()
    engine.api_key = "test-key"
    engine.models = ["models/fake-model"]

    monkeypatch.setattr(genai, "GenerativeModel", _FakeModel)
    monkeypatch.setattr(engine, "fetch_market_data", lambda _ticker: {"symbol": _ticker})
    monkeypatch.setattr(engine, "fetch_news", lambda _ticker: [])
    monkeypatch.setattr(engine, "get_macro_data", lambda: {"repo_rate": "6.5%"})

    db.query(ThesisCache).filter(
        ThesisCache.user_email == user_email,
        ThesisCache.ticker == ticker,
    ).delete()
    db.query(UsageLog).filter(
        UsageLog.user_email == user_email,
        UsageLog.action == "thesis",
    ).delete()
    db.commit()

    engine.generate_thesis(ticker, user_email=user_email, db=db, force_refresh=False)
    engine.generate_thesis(ticker, user_email=user_email, db=db, force_refresh=True)

    assert call_counter["count"] == 2
    usage_count = db.query(UsageLog).filter(
        UsageLog.user_email == user_email,
        UsageLog.action == "thesis",
    ).count()
    assert usage_count == 2
    db.close()
