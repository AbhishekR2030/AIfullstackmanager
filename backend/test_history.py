import os

import pytest
import requests


API_URL = os.getenv("API_URL", "http://127.0.0.1:8000/api/v1")
RUN_LIVE_API_TESTS = os.getenv("RUN_LIVE_API_TESTS", "0") == "1"

pytestmark = pytest.mark.integration


def test_portfolio_history_live_endpoint():
    if not RUN_LIVE_API_TESTS:
        pytest.skip("Set RUN_LIVE_API_TESTS=1 to run live localhost API flow tests.")

    login_data = {"email": "test@example.com", "password": "password123"}
    response = requests.post(f"{API_URL}/auth/login", json=login_data, timeout=10)
    assert response.status_code == 200, response.text
    token = response.json().get("access_token")
    assert token

    headers = {"Authorization": f"Bearer {token}"}
    h_response = requests.get(f"{API_URL}/portfolio/history?period=1y", headers=headers, timeout=10)
    assert h_response.status_code in {200, 403}, h_response.text
