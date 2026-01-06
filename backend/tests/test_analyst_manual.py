import sys
import os
import json

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from dotenv import load_dotenv
# Load env from backend/.env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '../.env'))

from backend.app.engines.analyst_engine import AnalystEngine

def test_tatasteel_analysis():
    print("Testing Analyst Engine for TATASTEEL.NS...")
    
    engine = AnalystEngine()
    
    # Check if API key is present
    if not engine.api_key:
        print("CRITICAL: GOOGLE_API_KEY is missing. Please add it to backend/.env")
        return

    result = engine.generate_thesis("TATASTEEL.NS")
    
    print("\n--- Analysis Result ---")
    print(json.dumps(result, indent=2))
    
    if "recommendation" in result:
        print("\nTest PASSED: Generated valid thesis.")
    else:
        print("\nTest FAILED: Could not generate thesis.")

if __name__ == "__main__":
    test_tatasteel_analysis()
