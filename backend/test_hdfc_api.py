"""
Legacy HDFC connectivity checks converted into deterministic pytest tests.
"""
import os

import pytest

from app.engines.hdfc_engine import HDFCEngine


RUN_LIVE_BROKER_TESTS = os.getenv("RUN_LIVE_BROKER_TESTS", "0") == "1"

pytestmark = pytest.mark.integration


def test_hdfc_engine_lazy_credentials_interface():
    engine = HDFCEngine()
    assert callable(engine._get_api_key)
    assert callable(engine._get_api_secret)
    # access token is runtime/session managed.
    assert hasattr(engine, "access_token")


def test_hdfc_fetch_holdings_live():
    if not RUN_LIVE_BROKER_TESTS:
        pytest.skip("Set RUN_LIVE_BROKER_TESTS=1 to run live broker integration tests.")

    engine = HDFCEngine()
    if not engine._get_api_key() or not engine._get_api_secret():
        pytest.skip("HDFC credentials not configured.")

    payload = engine.fetch_holdings()
    assert isinstance(payload, (list, dict))
