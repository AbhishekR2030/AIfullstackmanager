import os

import pytest

from dotenv import load_dotenv
# Load env from backend/.env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '../.env'))

from app.engines.analyst_engine import AnalystEngine


RUN_LIVE_LLM_TESTS = os.getenv("RUN_LIVE_LLM_TESTS", "0") == "1"


def test_tatasteel_analysis():
    if not RUN_LIVE_LLM_TESTS:
        pytest.skip("Set RUN_LIVE_LLM_TESTS=1 to run live Gemini integration test.")

    engine = AnalystEngine()

    if not engine.api_key:
        pytest.skip("GOOGLE_API_KEY missing in backend/.env")

    result = engine.generate_thesis("TATASTEEL.NS")
    assert isinstance(result, dict)
    assert "recommendation" in result or "error" in result
