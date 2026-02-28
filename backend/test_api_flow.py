import os

import pytest
import requests


API_URL = os.getenv("API_URL", "http://127.0.0.1:8000/api/v1")
RUN_LIVE_API_TESTS = os.getenv("RUN_LIVE_API_TESTS", "0") == "1"

pytestmark = pytest.mark.integration


def test_api_login_and_portfolio_flow():
    if not RUN_LIVE_API_TESTS:
        pytest.skip("Set RUN_LIVE_API_TESTS=1 to run live localhost API flow tests.")

    login_data = {"email": "test@example.com", "password": "password123"}

    # Best-effort signup to ensure user exists.
    requests.post(f"{API_URL}/auth/signup", json=login_data, timeout=10)

    response = requests.post(f"{API_URL}/auth/login", json=login_data, timeout=10)
    assert response.status_code == 200, response.text

    token = response.json().get("access_token")
    assert token, "Missing access token in login response"

    headers = {"Authorization": f"Bearer {token}"}
    p_response = requests.get(f"{API_URL}/portfolio", headers=headers, timeout=10)
    assert p_response.status_code == 200, p_response.text

    data = p_response.json()
    assert isinstance(data, list)
