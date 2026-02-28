from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException as FastAPIHTTPException
from fastapi.exception_handlers import http_exception_handler
from dotenv import load_dotenv
import os

load_dotenv()

from app.api.routes import router as api_router

app = FastAPI(title="AlphaSeeker India API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, set this to Vercel domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.exception_handler(FastAPIHTTPException)
async def standard_http_exception_handler(request: Request, exc: FastAPIHTTPException):
    # Allow routes/dependencies to raise HTTPException(detail=standard_error_payload(...))
    # while preserving the exact response contract from the spec.
    if isinstance(exc.detail, dict) and "error" in exc.detail and "status" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return await http_exception_handler(request, exc)

@app.get("/")
def read_root():
    return {"message": "AlphaSeeker India Backend is running"}

# Force Reload System Check - Clear Cache
