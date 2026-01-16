
import os
import time
import sys
# Mock env provided by dotenv loading in main, so strictly load here
from dotenv import load_dotenv
load_dotenv()

# Add parent dir to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.engines.scanner_engine import MarketScanner
from app.engines.rebalancer_engine import RebalancerEngine
from app.engines.portfolio_engine import PortfolioEngine

def test_full_flow():
    print("--- Starting Test ---")
    start_t = time.time()
    
    # 1. Scanner
    print("Initializing Scanner...")
    scanner = MarketScanner()
    
    print("Running scan_market()...")
    s_start = time.time()
    try:
        results = scanner.scan_market(region="IN")
        print(f"Scan completed in {time.time() - s_start:.2f}s. Items found: {len(results)}")
        if results:
            print(f"Top Candidate: {results[0]['ticker']} (Score: {results[0]['score']})")
    except Exception as e:
        print(f"SCANNER CRASHED: {e}")
        import traceback
        traceback.print_exc()
        return

    # 2. Rebalancer (Mocking Portfolio)
    print("\nTesting Rebalancer...")
    rebalancer = RebalancerEngine()
    mock_portfolio = [
        {"ticker": "RELIANCE.NS", "buy_date": "2024-01-01", "buy_price": 2500, "quantity": 10},
        {"ticker": "TCS.NS", "buy_date": "2024-06-01", "buy_price": 3500, "quantity": 5}
    ]
    
    r_start = time.time()
    try:
        analyzed = rebalancer.analyze_portfolio(mock_portfolio, new_candidates=results)
        print(f"Rebalancer completed in {time.time() - r_start:.2f}s")
        print("Analyzed:", analyzed)
    except Exception as e:
        print(f"REBALANCER CRASHED: {e}")
        traceback.print_exc()

    print(f"\nTotal Test Time: {time.time() - start_t:.2f}s")

if __name__ == "__main__":
    test_full_flow()
