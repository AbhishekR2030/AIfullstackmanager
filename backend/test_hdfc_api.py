"""
Test script to see what fields HDFC API returns
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.engines.hdfc_engine import HDFCEngine

# Initialize the engine
engine = HDFCEngine()

print("="*60)
print("HDFC API Test - Checking Available Fields")
print("="*60)

# Check if credentials are set
print(f"\nAPI Key: {'SET' if engine.api_key else 'NOT SET'}")
print(f"API Secret: {'SET' if engine.api_secret else 'NOT SET'}")
print(f"Access Token: {'SET' if engine.access_token else 'NOT SET'}")
print(f"MOCK_MODE: {engine.__class__.__module__}")

# Try to fetch holdings
print("\n" + "="*60)
print("Fetching Holdings...")
print("="*60)

holdings = engine.fetch_holdings()

if isinstance(holdings, dict) and "error" in holdings:
    print(f"\nError: {holdings['error']}")
    print("\nNote: If MOCK_MODE is False and no valid credentials, you'll see an error.")
    print("Toggle MOCK_MODE = True in hdfc_engine.py to see sample data structure.")
else:
    print(f"\nTotal Holdings Found: {len(holdings)}")
    print("\n" + "-"*60)
    
    if len(holdings) > 0:
        print("\nFirst Holding - ALL FIELDS:")
        print("-"*40)
        for key, value in holdings[0].items():
            print(f"  {key}: {value}")
        
        print("\n" + "="*60)
        print("ALL HOLDINGS SUMMARY:")
        print("="*60)
        for i, holding in enumerate(holdings):
            print(f"\n[{i+1}] {holding.get('ticker', 'UNKNOWN')}")
            print(f"    Company: {holding.get('company_name', 'N/A')}")
            print(f"    Quantity: {holding.get('quantity', 0)}")
            print(f"    Buy Price: {holding.get('buy_price', 0)}")
            print(f"    Buy Date: {holding.get('buy_date', 'NOT SET')}")
            print(f"    Source: {holding.get('source', 'N/A')}")
