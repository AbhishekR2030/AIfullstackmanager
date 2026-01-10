
import google.generativeai as genai
import os
from dotenv import load_dotenv
from pathlib import Path

# Get the directory of the script
script_dir = Path(__file__).resolve().parent
# Go up two levels to backend/
env_path = script_dir.parent.parent / '.env'

print(f"Loading .env from: {env_path}")
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    print("Error: GOOGLE_API_KEY not found.")
else:
    genai.configure(api_key=api_key)
    print("Listing available models...")
    try:
        for m in genai.list_models():
            if 'generateContent' in m.supported_generation_methods:
                print(f"- {m.name}")
    except Exception as e:
        print(f"Error listing models: {e}")
