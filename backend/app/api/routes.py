from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from app.engines.analyst_engine import AnalystEngine
from app.engines.screener_engine import ScreenerEngine

router = APIRouter()

# Instantiate engines
analyst = AnalystEngine()
screener = ScreenerEngine()

class AnalyzeRequest(BaseModel):
    ticker: str

class AnalyzeResponse(BaseModel):
    recommendation: str
    thesis: List[str]
    risk_factors: List[str]
    confidence_score: int
    data: Optional[dict] = None

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_stock(request: AnalyzeRequest):
    """
    Generates an investment thesis for a given ticker symbol.
    """
    try:
        # Pass the ticker to the engine 
        # Note: The engine returns a dict, we pass it back directly
        result = analyst.generate_thesis(request.ticker)
        
        if "error" in result:
             raise HTTPException(status_code=500, detail=result["error"])
             
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/screen")
async def screen_market():
    """
    Returns a list of stocks matching the momentum strategy.
    """
    try:
        matches = screener.screen_market()
        return {"matches": matches, "count": len(matches)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
