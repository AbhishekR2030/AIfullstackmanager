import requests

API_URL = "http://127.0.0.1:8000/api/v1"

# 1. Login
login_data = {"email": "test@example.com", "password": "password123"}
print(f"Logging in as {login_data['email']}...")

try:
    # Try creating user first just in case
    requests.post(f"{API_URL}/auth/signup", json=login_data)
except:
    pass

response = requests.post(f"{API_URL}/auth/login", json=login_data)

if response.status_code != 200:
    print(f"Login Failed: {response.text}")
    exit()

token = response.json()["access_token"]
print("Login Successful. Token acquired.")

# 2. Fetch Portfolio
headers = {"Authorization": f"Bearer {token}"}
print("Fetching Portfolio...")
p_response = requests.get(f"{API_URL}/portfolio", headers=headers)

if p_response.status_code == 200:
    data = p_response.json()
    print(f"Portfolio Count: {len(data)}")
    if len(data) > 0:
        print("First Item:", data[0]['ticker'])
    else:
        print("Portfolio is empty []")
else:
    print(f"Fetch Failed: {p_response.status_code} {p_response.text}")
