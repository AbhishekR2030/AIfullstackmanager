import requests
import json

BASE_URL = "http://127.0.0.1:8000"

def test_root():
    print("Testing Root URL...")
    try:
        r = requests.get(f"{BASE_URL}/")
        print(r.status_code, r.json())
    except Exception as e:
        print(e)

def test_screen():
    print("\nTesting Screener Endpoint...")
    try:
        r = requests.get(f"{BASE_URL}/api/v1/screen")
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(f"Found {data['count']} matches.")
            print("First match:", data['matches'][0] if data['matches'] else "None")
        else:
            print(r.text)
    except Exception as e:
        print(e)

def test_analyze():
    print("\nTesting Analyst Endpoint (TATASTEEL.NS)...")
    try:
        payload = {"ticker": "TATASTEEL.NS"}
        r = requests.post(f"{BASE_URL}/api/v1/analyze", json=payload)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            print("Thesis Generated Successfully.")
        else:
            print(r.text)
    except Exception as e:
        print(e)

if __name__ == "__main__":
    test_root()
    test_screen()
    test_analyze()