
import os
import sys
import json
from dotenv import load_dotenv

# Path Setup
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(current_dir, "../../"))
sys.path.append(backend_dir)

load_dotenv(dotenv_path=os.path.join(backend_dir, ".env"))

from app.engines.scanner_engine import scanner
from app.engines.analyst_engine import AnalystEngine

def run_pipeline():
    print("=== AlphaSeeker Discovery Engine: 4-Stage Launch ===")
    
    # 1. Scan India
    print("\n[Scan] Processing INDIA Region...")
    in_candidates = scanner.scan_market(region="IN")
    print(f"-> Found {len(in_candidates)} candidates in India.")

    # 2. Scan US
    print("\n[Scan] Processing US Region...")
    us_candidates = scanner.scan_market(region="US")
    print(f"-> Found {len(us_candidates)} candidates in US.")

    # 3. Global Ranking & Diversity
    all_candidates = in_candidates + us_candidates
    all_candidates.sort(key=lambda x: x['score'], reverse=True)
    
    final_5 = []
    # Simple logic: Take top 5 but ensure 1 IN and 1 US if available (Scanner already does some filtering but only per list return)
    # The Scanner implementation I wrote returns top 5 PER region call usually? 
    # Actually my scanner.scan_market returns a list of diverse candidates (up to 5).
    # So I have up to 10 candidates now.
    
    # Apply global diversity again
    has_in = False
    has_us = False
    
    for c in all_candidates:
        if len(final_5) >= 5: break
        
        # Check Geo Diversification
        is_in = ".NS" in c['ticker']
        is_us = not is_in
        
        # If we have 4 slots filled and missing a region, skip unless this fills it
        if len(final_5) == 4:
            if not has_in and not is_in: continue
            if not has_us and not is_us: continue
            
        final_5.append(c)
        if is_in: has_in = True
        if is_us: has_us = True
        
    print("\n=== FINAL TOP 5 SELECTION ===")
    for c in final_5:
        print(f"Ticker: {c['ticker']:<15} Score: {c['score']:.1f}  Price: {c['price']}")

    # 4. Generate Thesis
    print("\n=== Generating Investment Thesis (Gemini AI) ===")
    analyst = AnalystEngine()
    
    for item in final_5:
        ticker = item['ticker']
        print(f"\nAnalyzing {ticker}...")
        try:
            auth_check = analyst.generate_thesis(ticker)
            if "error" in auth_check:
                print(f"AI Error: {auth_check['error']}")
            else:
                print(f"RECOMMENDATION: {auth_check.get('recommendation', 'N/A').upper()}")
                print(f"CONFIDENCE: {auth_check.get('confidence_score', '0')}/100")
                print("DRIVERS (Thesis):")
                for t in auth_check.get('thesis', []):
                    print(f" - {t}")
                print("RISKS (Why it could fail):")
                for r in auth_check.get('risk_factors', []):
                    print(f" - {r}")
        except Exception as e:
            print(f"Pipeline Error for {ticker}: {e}")

if __name__ == "__main__":
    run_pipeline()
