
import google.generativeai as genai
import os
from dotenv import load_dotenv
from pathlib import Path

# Load env
script_dir = Path(__file__).resolve().parent
env_path = script_dir.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

models_to_test = [
    "models/gemini-1.5-flash",
    "gemini-1.5-flash",
    "models/gemini-1.5-pro",
    "models/gemini-1.0-pro"
]

for m in models_to_test:
    print(f"Testing: {m}")
    try:
        model = genai.GenerativeModel(m)
        response = model.generate_content("Say Hello")
        print(f"SUCCESS with {m}: {response.text}")
        break  # clear success
    except Exception as e:
        print(f"FAIL with {m}: {e}")
