import requests

API_URL = "http://127.0.0.1:8000/api/v1"
login_data = {"email": "test@example.com", "password": "password123"}
response = requests.post(f"{API_URL}/auth/login", json=login_data)
token = response.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

print("Fetching History...")
h_response = requests.get(f"{API_URL}/portfolio/history?period=1y", headers=headers)
print(f"History Status: {h_response.status_code}")
if h_response.status_code == 200:
    data = h_response.json()
    print(f"Dates: {len(data.get('dates', []))}")
else:
    print(h_response.text)
