from fastapi import FastAPI
from dotenv import load_dotenv
import os

load_dotenv()

from app.api.routes import router as api_router

app = FastAPI(title="AlphaSeeker India API")

app.include_router(api_router, prefix="/api/v1")

@app.get("/")
def read_root():
    return {"message": "AlphaSeeker India Backend is running"}
