
import os
import sys
import json
from dotenv import load_dotenv

# Add 'backend' to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(current_dir, "../../"))
sys.path.append(backend_dir)

# Load .env
load_dotenv(dotenv_path=os.path.join(backend_dir, ".env"))

from app.engines.scanner_engine import scanner

def run_scanner_only():
    print("=== Phase 1: Market Scanning (India) ===")
    
    # Scan India
    try:
        candidates = scanner.scan_market(region="IN")
    except Exception as e:
        print(f"Error during scan: {e}")
        return

    if not candidates:
        print("No candidates found.")
        return

    print(f"\n=== Final Top 5 Selection ===")
    print(f"{'Ticker':<15} {'Price':<10} {'Score':<10} {'VolShock':<10} {'RSI':<10}")
    print("-" * 60)
    for c in candidates:
        print(f"{c['ticker']:<15} {c['price']:<10} {c.get('score', 0):<10.2f} {c.get('volume_shock', 0):<10.2f} {c.get('rsi', 0):<10.2f}")

    print("\n(Note: Thesis generation skipped due to API Quota limits)")

if __name__ == "__main__":
    run_scanner_only()
