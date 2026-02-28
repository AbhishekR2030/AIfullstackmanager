# Alphaseeker Parallel Agent Session Prompts

Use these prompts to run 5 parallel coding sessions.  
Order: run **Agent 4 first** (already implemented in this workspace), then run Agents 1, 2, 3, and 5 in parallel.

## Agent 1 Session Prompt
When you start each session, explicitly tell the agent: "the existing code in this file is working — do not rewrite it, only add the specified functionality."

TASK: Enhance `scanner_engine.py` in the Alphaseeker backend.

CONTEXT:
- FastAPI backend at `backend/app/engines/scanner_engine.py`
- Uses yfinance for market data, pandas-ta for indicators
- Current implementation has a basic 4-stage pipeline that is WORKING — do not rewrite it
- Enhance only: add the specified new functionality to the existing code

IMPLEMENT:
1. Add `ScanConfig` dataclass with all threshold parameters (see TDD Section 6).
2. Add 5 strategy preset `ScanConfig` instances:
   `ALPHASEEKER_CORE`, `CITADEL_MOMENTUM`, `JANE_STREET_STAT`, `MILLENNIUM_QUALITY`, `DE_SHAW_MULTIFACTOR`.
3. Implement Economic Moat Check (Stage 4) per TDD Section 5.4.
4. Implement Composite Upside Scoring (Stage 5) per TDD Section 5.5.
5. Add freemium result cap: if `user.plan == 'free'`, return `results[:10]`.
6. Add `progress_callback` parameter to main scan function for Celery task reporting.

CONSTRAINTS:
- All stages must be independent functions for testability.
- No global state; all config passed as parameters.
- Add docstrings and type hints throughout.
- Write pytest unit tests in `tests/test_scanner_engine.py`.

## Agent 2 Session Prompt
When you start each session, explicitly tell the agent: "the existing code in this file is working — do not rewrite it, only add the specified functionality."

TASK: Enhance `analyst_engine.py` to add caching and freemium controls.

CONTEXT:
- The Gemini integration and model fallback chain are ALREADY WORKING — do not touch them.
- Add the following new capabilities on top of the existing code.

IMPLEMENT:
1. Add `thesis_cache` SQLAlchemy model (see TDD Section 3.1 schema).
2. Add `usage_log` SQLAlchemy model (see TDD Section 3.1 schema) if missing.
3. Modify `generate_thesis()` to:
   - Check `thesis_cache` before calling Gemini.
   - Store result in `thesis_cache` with 6-hour TTL after successful generation.
   - Increment `usage_log` on every new (non-cached) generation.
4. Add `check_daily_limit(user_email, action, limit, db)` utility function.
5. Modify `POST /api/v1/analyze` route in `routes.py` to:
   - Call `check_daily_limit` (free: 3, pro: unlimited).
   - Return partial thesis for free users (redact `bull_case` and `bear_case`).
   - Support `?force_refresh=true` for pro users (bypass cache).

CONSTRAINTS:
- Caching must use DB `thesis_cache` table (not Redis).
- Partial thesis must retain fields and use redaction strings.
- All 403/429 errors must use the standard error format.
- Write tests mocking Gemini API calls.

## Agent 3 Session Prompt
When you start each session, explicitly tell the agent: "the existing code in this file is working — do not rewrite it, only add the specified functionality."

TASK: Implement `rebalancer_engine.py` with full sell urgency scoring and rebalancing API.

CONTEXT:
- `rebalancer_engine.py` exists with basic structure — WORKING but incomplete.
- Enhance the existing file, do not rewrite from scratch.

IMPLEMENT:
1. `compute_sell_urgency(holding, market_data, top_scan_score)`:
   - Implement all 4 signals per SPEC Section 4.1.
   - Skip Signal 2 (do not penalize) if `top_scan_score is None`.
   - Return `{ score, primary_signal, badge }`.
2. `get_rebalancing_suggestions(user_email, db, redis)`:
   - Load portfolio, load Redis scan results, create swap pairs.
3. Add `GET /api/v1/portfolio/rebalance` endpoint (Pro-gated) in `routes.py`.
4. Add `sell_urgency_score` and `sell_urgency_badge` fields to `GET /portfolio` response.

CONSTRAINTS:
- Handle missing market data gracefully.
- Score always in `[0, 100]`.
- Write hypothesis property-based tests.
- Pro gate must use `require_pro()` dependency.

## Agent 4 Session Prompt (Completed First)
When you start each session, explicitly tell the agent: "the existing code in this file is working — do not rewrite it, only add the specified functionality."

TASK: Implement complete freemium enforcement across all Alphaseeker endpoints.

STATUS:
- Completed in current workspace.
- Includes user plan columns, JWT plan claims, `require_pro`, `check_daily_limit`, `usage_log`, route-level freemium gates, internal activate-pro webhook, and integration tests scaffold.

## Agent 5 Session Prompt
When you start each session, explicitly tell the agent: "the existing code in this file is working — do not rewrite it, only add the specified functionality."

TASK: Implement Zerodha Kite OAuth and portfolio sync as a new broker integration.

CONTEXT:
- Pattern to follow: `hdfc_engine.py` (existing, working).
- Create `backend/app/engines/zerodha_engine.py`.
- Add new routes to `routes.py`.

IMPLEMENT:
1. Create `zerodha_engine.py` following `hdfc_engine.py` pattern.
2. `GET /api/v1/auth/zerodha/login` -> return Kite Connect redirect URL.
3. `GET /api/v1/auth/zerodha/callback?request_token=<token>`:
   - Compute checksum with SHA256.
   - Exchange token at Kite API.
   - Store broker token with broker=`ZERODHA`, expiry at 06:00 IST.
4. `POST /api/v1/portfolio/sync/zerodha`:
   - Fetch holdings, map symbols to `.NS`, upsert with weighted average.
5. Handle expired token -> `401 BROKER_TOKEN_EXPIRED`.
6. Add iOS deep link callback `com.alphaseeker.india://zerodha/callback`.

CONSTRAINTS:
- All sync endpoints are Pro-gated (`require_pro`).
- Keep credentials server-side only.
- Add `ZERODHA_API_KEY`, `ZERODHA_API_SECRET` to `.env.example`.
- Write tests with mocked Zerodha API responses.
