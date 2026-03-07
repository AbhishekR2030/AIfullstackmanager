# ALPHASEEKER INDIA — Feature Specification Document
**Version 1.0 | February 2026 | For Coding Agents & Engineering Teams**

> Detailed per-feature specs: inputs, outputs, business logic, API contracts, UI behaviour, and acceptance criteria.

---

## How to Use This Document

This document is structured as a **module-by-module engineering specification**. Each module section contains:
- **Feature ID** and name for traceability
- **Tier** (Free / Pro / Both)
- **Owner engine** (the Python backend module responsible)
- **Inputs:** what data the module receives
- **Outputs:** what data the module returns
- **Business logic:** step-by-step algorithm with actual formulas
- **API contract:** endpoint, method, request schema, response schema
- **UI specification:** screen behaviour, component states, error handling
- **Acceptance criteria:** testable conditions that define "done"

> **For Coding Agents:** Each module section is self-contained. A coding agent can be given a single module section and all context needed to implement it. Cross-references are noted where inter-module dependencies exist.

---

## Table of Contents
1. [Discovery & Stock Screening Module](#1-discovery--stock-screening-module)
2. [AI Analyst Engine Module](#2-ai-analyst-engine-module)
3. [Portfolio Management Module](#3-portfolio-management-module)
4. [Portfolio Intelligence & Rebalancing Module](#4-portfolio-intelligence--rebalancing-module)
5. [Authentication & User Management Module](#5-authentication--user-management-module)
6. [Broker Integration Module](#6-broker-integration-module)
7. [Freemium & Subscription Module](#7-freemium--subscription-module)
8. [iOS App Configuration & Deployment Spec](#8-ios-app-configuration--deployment-spec)
9. [Error Handling & Edge Cases](#9-error-handling--edge-cases)
10. [Testing Strategy](#10-testing-strategy)
11. [Coding Agent Session Templates](#11-coding-agent-session-templates)

---

## 1. Discovery & Stock Screening Module

**`MOD-01`** | **Tier:** Free (Core strategy, 1 scan/day, top 10) | Pro (all strategies, unlimited) | **Owner:** `scanner_engine.py`

### 1.1 Inputs

```
POST /api/v1/discovery/scan
POST /api/v1/discovery/scan/async

Request Body (ScanRequest):
{
  "strategy": "core" | "citadel_momentum" | "jane_street_stat" |
              "millennium_quality" | "de_shaw_multifactor" | "custom",
  "thresholds": {    // Optional tuning; required only for custom strategy
    "technical": {
      "rsi_min": int,
      "rsi_max": int,
      "volatility_min": float,
      "volatility_max": float,
      "volume_shock_min": float,
      "volume_shock_max": float
    },
    "fundamental": {
      "revenue_growth_min": float,
      "revenue_growth_max": float,
      "profit_growth_min": float,
      "profit_growth_max": float,
      "roe_min": float,
      "roe_max": float,
      "roce_min": float,
      "roce_max": float,
      "debt_equity_min": float,
      "debt_equity_max": float
    }
  }
}
```

### 1.2 Outputs

```json
{
  "status": "complete",
  "strategy": "citadel_momentum",
  "scan_time_seconds": 45.2,
  "total_screened": 500,
  "total_passed": 18,
  "results": [
    {
      "ticker": "TCS.NS",
      "company_name": "Tata Consultancy Services",
      "sector": "Information Technology",
      "market_cap_cr": 1450000,
      "current_price": 3842.50,
      "upside_score": 84.2,
      "rsi": 63.4,
      "macd_hist": 12.8,
      "roe": 44.2,
      "roce": 52.1,
      "rev_growth": 13.8,
      "debt_equity": 0.0,
      "recommendation": "BUY",
      "confidence": 88
    }
  ]
}

// Async scan: immediate response
{ "job_id": "uuid-string", "status": "queued" }
```

### 1.3 Business Logic: Hybrid Architecture

**Shared Platform Layers (always executed):**
1. **Data Platform:** load universe, fetch OHLCV and fundamentals, normalize ticker metadata, cache results.
2. **Risk Guardrails:** enforce hard liquidity/tradability and safety constraints.
3. **Execution Simulation:** apply slippage/tradeability model to avoid non-executable picks.
4. **Portfolio Accounting:** attach portfolio context for switch/replacement analysis.
5. **Monitoring:** emit latency, rejection, and data-quality telemetry.

**Strategy-Specific Alpha Pipelines (selected by `strategy`):**
1. Run strategy-owned feature engineering.
2. Run strategy-owned filters (not required to follow identical stages across strategies).
3. Run strategy-owned scoring and ranking logic.
4. Normalize to a common contract for UI: score/rationale/flags.

**Expected behavior:**
- `core` provides baseline balanced output and is available on Free tier.
- Pro strategies run independent alpha logic (`citadel_momentum`, `jane_street_stat`, `millennium_quality`, `de_shaw_multifactor`).
- `custom` applies user-tuned thresholds and emits the same normalized response contract.
- Free tier response remains capped (top 10).

### 1.4 UI Specification: Discovery Screen

**Strategy Selector**
- Display 6 strategy cards in a 2-column grid
- Each card: strategy name, 2-line description, Pro badge if applicable
- Free users: Core card is active; Pro cards show lock icon and open upgrade modal on tap
- Selected card gets a highlighted border (accent blue)

**Scan Initiation**
- Tap "Run Scan" → `POST /discovery/scan/async` (Pro) or `/discovery/scan` (Free)
- Button state: `"Scanning..."` with spinner
- Progress bar: fill based on `progress_pct` from polling `GET /discovery/status/{job_id}`
- Poll interval: 2 seconds
- Cancel button: calls `DELETE /discovery/cancel/{job_id}`

**Results Display**
- Scrollable list of `StockCard` components
- Each card: rank, ticker, company name, upside score badge (colour-coded), sector, RSI chip, recommendation badge
- Tap card → opens `ThesisModal`
- Sort toggle: Score (default) | RSI | Revenue Growth
- Filter pills: All Sectors / IT / Finance / Pharma / Auto / FMCG / Energy
- Free users: after 10th result, blurred cards with "Upgrade to Pro" overlay

### 1.5 Acceptance Criteria

| ID | Criterion | Test Method |
|----|-----------|-------------|
| AC-01-01 | Scan completes within 90 seconds for full Nifty 500 on async worker | Timed integration test |
| AC-01-02 | Free user receives max 10 results for allowed free-tier strategy output | API response check |
| AC-01-03 | Pro strategy accessed by free user returns `403 PRO_REQUIRED` | Auth test |
| AC-01-04 | Shared platform layers execute for every strategy run before final ranking | Integration trace test |
| AC-01-05 | Upside score is always between 0 and 100 | Property-based test |
| AC-01-06 | Progress polling returns `progress_pct` between 0 and 100 | Polling integration test |
| AC-01-07 | Cancelled scan stops worker and returns `status: cancelled` | Cancel API test |
| AC-01-08 | Strategy-specific pipeline failure does not crash API; returns structured error with strategy id | Fault injection test |
| AC-01-09 | Different strategies produce differentiable feature/filter behavior on same universe snapshot | Backtest parity test |

---

## 2. AI Analyst Engine Module

**`MOD-02`** | **Tier:** Free (3/day, summary only) | Pro (unlimited, full thesis) | **Owner:** `analyst_engine.py`

### 2.1 Inputs

```
POST /api/v1/analyze

Request Body: { "ticker": "TCS.NS" }
Query Params (optional): ?force_refresh=true  // Skip cache, force new Gemini call (Pro only)
```

### 2.2 Outputs

```json
{
  "ticker": "TCS.NS",
  "company_name": "Tata Consultancy Services",
  "recommendation": "BUY",
  "confidence": 88,
  "summary": "TCS is a high-quality IT compounder with dominant market position...",
  "bull_case": [
    "AI services revenue growing 45% YoY, now 8% of total revenue",
    "Margin expansion of 120bps driven by automation and offshore leverage",
    "Rs. 85,000 Cr deal pipeline at record high, providing 12-month revenue visibility"
  ],
  "bear_case": [
    "USD/INR depreciation of 3-4% creates 2-3% earnings headwind",
    "US financial sector client slowdown could impact 18% of revenues",
    "Wage inflation of 8-10% may compress margins by 50-80bps in FY26"
  ],
  "target_horizon": "9-12 months",
  "key_metrics": { "pe_ratio": 28.4, "roe": 44.2, "rev_growth": 13.8, "debt_equity": 0.0 },
  "model_used": "gemini-2.5-flash",
  "cached": false,
  "generated_at": "2026-02-28T10:30:00Z"
}
```

### 2.3 Business Logic

1. Check daily usage: count rows in `usage_log` where `user_email = X AND action = 'thesis' AND date = today`
2. If `user.plan == 'free'` AND `count >= 3`: raise HTTP 429 `DAILY_LIMIT`
3. Check `thesis_cache`: `SELECT WHERE ticker = X AND expires_at > NOW()`
4. If cached AND NOT `force_refresh`: return cached thesis (no Gemini call, no usage increment)
5. Fetch stock data: `yfinance.Ticker(ticker).info` for price, RSI, fundamentals
6. Build prompt (see TDD Section 7.1) with stock data injected
7. Call `generate_thesis(prompt, current_blacklist)` with model fallback chain
8. Parse Gemini JSON response: validate all required fields present
9. If JSON parse failure: retry once, then return `ANALYSIS_UNAVAILABLE`
10. Store result in `thesis_cache` with `expires_at = NOW() + 6 hours`
11. Increment `usage_log` counter for user
12. Return thesis object with `cached: false` and `model_used`

### 2.4 Freemium Logic Detail

| Scenario | Behaviour |
|----------|-----------|
| Free user, 0–2 thesis today | Full thesis generated BUT `bull_case` and `bear_case` are redacted: `["Upgrade to Pro to view full analysis"]` |
| Free user, limit reached (3rd+) | HTTP 429 with `code: DAILY_LIMIT`. Frontend shows upgrade modal. |
| Pro user, any request | Full thesis, no limit. `force_refresh=true` supported. |
| Any user, cached thesis | Return cached immediately. Does NOT count against daily limit. |
| All Gemini models failing | Return `{ "error": "ANALYSIS_UNAVAILABLE", "retry_after": 300 }` |

### 2.5 UI Specification: ThesisModal

**Modal Layout**
- Full-screen bottom sheet modal (iOS native style)
- Header: Company name + ticker + recommendation badge (BUY=green, HOLD=orange, SELL=red)
- Confidence score: circular progress indicator (0–100)
- Summary paragraph: plain text, displayed in full
- Bull Case section: 3 bullet points with upward arrow icon (green)
- Bear Case section: 3 bullet points with downward arrow icon (red)
- Key Metrics row: P/E | ROE | Revenue Growth | D/E displayed as chips
- Footer: "Analysis by Gemini AI" + model name + generated timestamp
- Free user: Bull/Bear case sections show lock icon overlay with "Upgrade to Pro" CTA

**Loading State**
- Skeleton loader while Gemini call in progress
- Estimated wait time shown: `"Generating analysis... (~8 seconds)"`
- If thesis already cached: instant render (no loading state)

### 2.6 Acceptance Criteria

| ID | Criterion | Test Method |
|----|-----------|-------------|
| AC-02-01 | Free user receives 403 on 4th thesis request in same UTC day | API test with usage seeding |
| AC-02-02 | Cached thesis returned within 200ms (no Gemini call) | Response time assertion |
| AC-02-03 | JSON parse failure retries once, then returns `ANALYSIS_UNAVAILABLE` | Mock Gemini with invalid JSON |
| AC-02-04 | Free user receives redacted bull/bear case (not empty, not null) | Response field inspection |
| AC-02-05 | Model fallback triggers on 429 from primary model | Mock primary model 429 |
| AC-02-06 | `force_refresh` bypasses cache for Pro user only | Auth + cache test |
| AC-02-07 | Thesis stored in cache with correct 6-hour TTL | DB `expires_at` check |

---

## 3. Portfolio Management Module

**`MOD-03`** | **Tier:** Free (manual, up to 10 holdings, 1M history) | Pro (unlimited, broker sync, all history) | **Owner:** `portfolio_engine.py`

### 3.1 Portfolio Data Model

```python
PortfolioItem:
  id: int
  user_email: str
  ticker: str           # Always with exchange suffix: 'TCS.NS', 'RELIANCE.NS'
  company_name: str
  quantity: float       # Allow fractional for future ETF support
  buy_price: float      # Average buy price (rupees)
  buy_date: str         # 'YYYY-MM-DD'
  source: str           # 'MANUAL' | 'HDFC' | 'ZERODHA' | 'GROWW' | 'ANGEL'
  created_at: datetime

PortfolioAnalytics (computed, not stored):
  # All fields from PortfolioItem, plus:
  current_price: float          # Live from yfinance
  current_value: float          # quantity * current_price
  invested_value: float         # quantity * buy_price
  unrealised_pnl: float         # current_value - invested_value
  unrealised_pnl_pct: float     # (unrealised_pnl / invested_value) * 100
  holding_days: int             # (today - buy_date).days
  tax_category: str             # 'LTCG' (>365d) | 'STCG' (<=365d)
  sell_urgency_score: int       # 0-100 from rebalancer engine
  sell_urgency_badge: str       # 'SELL' | 'REVIEW' | 'WATCH' | 'HOLD'
```

### 3.2 Add Trade Logic

```
POST /api/v1/portfolio/add
Body: { ticker, quantity, buy_price, buy_date }

Validation:
- ticker: must resolve via search_engine (valid NSE/BSE ticker)
- quantity: > 0
- buy_price: > 0
- buy_date: valid date, not in future

Freemium check:
- Count current portfolio_items for user
- If count >= 10 AND user.plan == 'free': return 403 HOLDING_LIMIT

Ticker normalisation:
- If user enters 'TCS' (without exchange), append '.NS' (NSE default)
- Validate ticker against yfinance: fetch .info['shortName']
- If invalid: return 400 INVALID_TICKER

Duplicate handling:
- If ticker already exists for user: weighted average down/up
  new_avg_price = (existing.quantity * existing.buy_price + quantity * buy_price)
                  / (existing.quantity + quantity)
  Update: quantity += new_quantity, buy_price = new_avg_price
- If ticker is new: INSERT new portfolio_item
```

### 3.3 Get Portfolio with Live Data

```
GET /api/v1/portfolio

Process:
1. Load all portfolio_items for user from DB
2. Batch fetch live prices: yf.download(tickers_list, period='1d')['Close']
3. For each holding: compute all PortfolioAnalytics fields
4. Call rebalancer_engine.compute_sell_urgency() for each holding
5. Compute portfolio totals:
   total_invested = sum(quantity * buy_price for all holdings)
   total_current  = sum(quantity * current_price for all holdings)
   total_pnl      = total_current - total_invested
   total_pnl_pct  = (total_pnl / total_invested) * 100
6. Sort holdings: SELL badge first, then by unrealised_pnl_pct ascending
   (worst performers + urgent sells surface to top)

Response:
{
  "summary": { total_invested, total_current, total_pnl, total_pnl_pct },
  "holdings": [ PortfolioAnalytics[] ],
  "as_of": "<ISO timestamp>"
}
```

### 3.4 Portfolio Value History

```
GET /api/v1/portfolio/history?period=1y

Periods: 1w | 1m | 3m | 6m | 1y | ytd | all
Freemium: Free users restricted to period=1m only

Algorithm:
1. For each date in period range (business days only):
   a. Get holdings held on that date (buy_date <= date)
   b. Fetch historical prices for those tickers on that date
   c. portfolio_value(date) = sum(quantity * price(date) for active holdings)
2. Return time series: [{ date, value }]

Optimisation: Use yf.download(tickers, start, end) for batch price fetch
Cache result in Redis for 30 minutes (expensive to compute)

Response:
{
  "period": "1y",
  "data": [{ "date": "2025-03-01", "value": 485000.0 }, ...],
  "start_value": 485000.0,
  "end_value": 612500.0,
  "change_pct": 26.3
}
```

### 3.5 UI Specification: Portfolio Screen

**Dashboard Summary Card**
- Total portfolio value (large, bold)
- Today's P&L: +/- rupee amount and percentage (green/red)
- Total invested vs current value bar
- Overall XIRR (if buy dates available)

**Holdings List**
- Each row: company name, ticker, quantity, buy price, current price, P&L chip
- Sell Urgency badge on right: SELL (red), REVIEW (orange), WATCH (yellow), HOLD (green)
- Tap row: expands to detail view with full analytics + AI thesis shortcut
- Swipe left: shows Delete button

**Portfolio History Chart**
- Line chart (Chart.js) with time series data
- Period selector tabs: 1W | 1M | 3M | 6M | 1Y | YTD | ALL
- Free users: 1M tab active, other tabs show lock icon
- Chart tooltip on tap: shows date and portfolio value

**Add Trade Modal**
- Ticker search input with autocomplete (calls `GET /search`)
- Quantity input (numeric keypad)
- Buy Price input (numeric keypad)
- Buy Date picker (date wheel, default today)
- Validation inline: red border + error message if invalid
- Submit button: "Add to Portfolio"

### 3.6 Acceptance Criteria

| ID | Criterion | Test |
|----|-----------|------|
| AC-03-01 | Free user blocked on 11th holding add with `403 HOLDING_LIMIT` | API test |
| AC-03-02 | Duplicate ticker averages price correctly (weighted average) | Unit test with known inputs |
| AC-03-03 | Invalid ticker returns `400 INVALID_TICKER` without DB insert | Mock yfinance failure |
| AC-03-04 | History for 1-year period returns ~250 data points (business days) | Count assertion |
| AC-03-05 | LTCG/STCG classification correct: > 365 days = LTCG | Unit test with fixed dates |
| AC-03-06 | Delete removes holding; not returned in subsequent `GET /portfolio` | CRUD integration test |
| AC-03-07 | Free user requesting `period=1y` returns `403 HISTORY_LIMIT` | Auth test |

---

## 4. Portfolio Intelligence & Rebalancing Module

**`MOD-04`** | **Tier:** Pro only | **Owner:** `rebalancer_engine.py`

### 4.1 Sell Urgency Score: Full Specification

The Sell Urgency Score (0–100) is a composite signal computed for each portfolio holding.

| Signal | Max Points | Sub-signals & Scoring |
|--------|-----------|----------------------|
| 1. Momentum Deterioration | 25 pts | RSI < 35: +25 \| RSI 35–45: +15 \| RSI 45–50: +5 \| MACD hist < 0: +10 bonus (capped at 25 total) |
| 2. Better Opportunity Available | 30 pts | Gap ≥ 25pts vs top scan: +30 \| Gap 15–24pts: +18 \| Gap 8–14pts: +8 \| No recent scan: signal skipped |
| 3. Fundamental Weakening | 25 pts | ROE dropped > 20% from purchase: +20 \| Revenue growth < 0%: +15 \| Rev growth 0–5%: +5 (capped at 25 total) |
| 4. Stop-Loss / Trailing Stop | 20 pts | Drawdown from buy price ≥ 15%: +20 \| 8–14%: +12 \| 5–7%: +6 \| No drawdown: 0 |

> **Important:** Signal 2 (Better Opportunity) requires a recent scan result in Redis. If the user has not run a scan in the last 24 hours, this signal is **skipped** and the remaining signals are re-weighted proportionally. Never penalise a holding just because no scan has been run.

**Badge thresholds:**
- Score 70–100 → 🔴 **SELL**
- Score 45–69 → 🟠 **REVIEW**
- Score 20–44 → 🟡 **WATCH**
- Score 0–19 → 🟢 **HOLD**

### 4.2 Rebalancing Swap Logic

```
GET /api/v1/portfolio/rebalance

Algorithm:
1. Load portfolio with sell_urgency_scores (computed above)
2. Load most recent scan results from Redis (if available)
3. SELL_CANDIDATES: holdings with sell_urgency_score >= 60
4. BUY_RECOMMENDATIONS: top scan results NOT already in portfolio
5. Create SWAP_PAIRS:
   - Sort sell candidates by urgency descending
   - Sort buy recommendations by upside_score descending
   - Pair greedily: sell_candidate[0] -> buy_recommendation[0], etc.
   - Match by capital equivalence: sell_value ≈ buy_allocation

Response:
{
  "sell_candidates": [
    { "ticker", "company_name", "sell_urgency_score", "sell_urgency_badge",
      "current_value", "unrealised_pnl_pct", "primary_sell_signal" }
  ],
  "buy_recommendations": [
    { "ticker", "company_name", "upside_score", "recommendation", "sector", "current_price" }
  ],
  "swap_pairs": [
    {
      "sell": { "ticker", "current_value", "sell_urgency_score" },
      "buy": { "ticker", "upside_score", "approximate_shares" },
      "rationale": "Replace low-momentum HDFC Bank (urgency: 68) with high-conviction Bajaj Finance (score: 87)"
    }
  ],
  "last_scan_age_hours": 4.2
}
```

### 4.3 UI Specification: Rebalance Tab

- Accessible from Portfolio screen as a tab: **Holdings | Rebalance**
- Three sections: Sell Candidates, Buy Recommendations, Swap Pairs
- Each sell candidate card: ticker, urgency score, primary signal, current value, P&L chip
- Each buy recommendation card: identical to Discovery StockCard
- Swap Pairs section: side-by-side cards (Sell → Buy) with rationale text below
- "View Full Thesis" button on every buy recommendation card
- Empty state if no scan results: *"Run a scan first to get rebalancing recommendations"*

---

## 5. Authentication & User Management Module

**`MOD-05`** | **Tier:** All tiers | **Owner:** `auth_engine.py`

### 5.1 Email/Password Auth

```
POST /api/v1/auth/signup
Body: { email, password }

Validation:
- email: valid format, unique in users table
- password: min 8 chars, at least 1 number, at least 1 special char

Process:
1. Check email not already registered
2. Hash password: passlib.hash.bcrypt.hash(password, rounds=12)
3. INSERT user: email, hashed_password, plan='free', is_active=True
4. Generate JWT: { sub: email, plan: 'free', exp: now + 7 days }
5. Return: { token, user: { email, plan } }

POST /api/v1/auth/login
Body: { email, password }

Process:
1. Fetch user by email
2. Verify: passlib.verify(password, user.hashed_password)
3. If invalid: return 401 INVALID_CREDENTIALS (same message for both wrong email and wrong password)
4. Generate JWT with current plan and expiry
5. Return: { token, user: { email, plan, plan_expires_at } }
```

### 5.2 Google OAuth

```
POST /api/v1/auth/google
Body: { google_token }

Process:
1. Verify google_token:
   GET https://oauth2.googleapis.com/tokeninfo?id_token={token}
2. Extract: sub (google_id), email, name from verified payload
3. Check if user exists by google_id OR email:
   - Exists: update last_login, return existing plan
   - Not exists: INSERT new user with google_id, no hashed_password, plan='free'
4. Generate JWT and return

iOS Implementation:
- Uses @codetrix-studio/capacitor-google-auth plugin
- GoogleAuth.signIn() returns idToken
- Send idToken to POST /auth/google

Apple Sign In (REQUIRED for App Store):
- Use @capacitor-community/apple-sign-in plugin
- Get identityToken, send to POST /auth/apple
- Same upsert logic as Google OAuth
```

### 5.3 JWT Specification

```
JWT Payload:
{
  "sub": "user@email.com",
  "plan": "free" | "pro",
  "plan_expires_at": "2026-03-28T00:00:00Z" | null,
  "iat": <issued_at_unix>,
  "exp": <issued_at + 7 days unix>
}

Signing: HS256, SECRET_KEY from environment
Refresh: No refresh token in V1.0. JWT valid for 7 days. Re-login required after expiry.
Validation: FastAPI dependency get_current_user() decodes and validates on every request.
Plan check: Read plan from JWT payload (avoid DB lookup on every request).
Plan expiry: If plan_expires_at < now: treat as free tier in that request.
```

### 5.4 Acceptance Criteria

| ID | Criterion | Test |
|----|-----------|------|
| AC-05-01 | Duplicate email signup returns `409 EMAIL_EXISTS` | API test |
| AC-05-02 | Wrong password returns `401` (no leaking which field was wrong) | API test |
| AC-05-03 | Invalid `google_token` returns `401 INVALID_GOOGLE_TOKEN` | Mock Google API |
| AC-05-04 | Expired JWT returns `401 TOKEN_EXPIRED` | Time-manipulated token test |
| AC-05-05 | `plan` field in JWT matches DB at time of login | DB state + JWT decode test |
| AC-05-06 | Account deletion removes all user data: portfolio_items, broker_tokens, usage_log | Cascade delete test |

---

## 6. Broker Integration Module

**`MOD-06`** | **Tier:** Pro only | **Owner:** `hdfc_engine.py` + `zerodha_engine.py` (new)

### 6.1 HDFC Sky Integration (Live ✅)

```
GET /api/v1/auth/hdfc/login
Returns: { redirect_url: 'https://sky.hdfc.com/oauth/authorize?...' }

GET /api/v1/auth/callback?code=<auth_code>
1. Exchange code for access_token via HDFC token endpoint
2. Store in broker_tokens: (user_email, broker='HDFC', access_token, expires_at)
3. Redirect to: com.alphaseeker.india://auth/callback?status=success

POST /api/v1/portfolio/sync/hdfc
1. Fetch access_token from broker_tokens for user
2. Call HDFC holdings API with token
3. For each holding:
   a. Normalise ticker to Yahoo Finance format (add .NS suffix)
   b. Check if holding exists in portfolio_items
   c. If exists: update quantity and buy_price (weighted average)
   d. If new: INSERT with source='HDFC'
4. Mark holdings no longer in HDFC response with 'removed_from_broker' flag
   (do NOT auto-delete: user confirmation required)
5. Return: { added, updated, flagged_removed, errors }
```

### 6.2 Zerodha Kite Integration (V1.1)

```
Env vars: ZERODHA_API_KEY, ZERODHA_API_SECRET
Deep link: com.alphaseeker.india://zerodha/callback

GET /api/v1/auth/zerodha/login
Returns: { redirect_url: 'https://kite.zerodha.com/connect/login?api_key=...' }

GET /api/v1/auth/zerodha/callback?request_token=<token>
1. POST https://api.kite.trade/session/token with:
   - api_key, request_token
   - checksum = SHA256(api_key + request_token + api_secret)
2. Receive: { access_token, user_id }
3. Store access_token in broker_tokens
   expires_at = today at 06:00 IST (Zerodha resets daily)
4. Redirect to app deep link

POST /api/v1/portfolio/sync/zerodha
1. GET https://api.kite.trade/portfolio/holdings
   Headers: { Authorization: "token {api_key}:{access_token}" }
2. Response: [{ tradingsymbol, quantity, average_price, last_price }]
3. Map tradingsymbol -> Yahoo Finance ticker (append .NS)
4. Same upsert logic as HDFC sync

Token Expiry:
- If current time > expires_at: return 401 BROKER_TOKEN_EXPIRED
  with message: "Zerodha session expired. Please re-connect."
```

### 6.3 Groww Integration (V1.2)
- Monitor Groww Developer API availability (beta as of Q1 2026)
- Fallback if API not available: CSV import
- `POST /api/v1/portfolio/import/csv` accepts multipart file upload
- CSV format: Symbol, Quantity, Average Price, Buy Date

### 6.4 Acceptance Criteria

| ID | Criterion | Test |
|----|-----------|------|
| AC-06-01 | HDFC sync with 15 holdings inserts all 15 to `portfolio_items` | Integration test with mock HDFC API |
| AC-06-02 | Duplicate ticker from sync averages price correctly | Unit test |
| AC-06-03 | Expired HDFC token triggers re-auth prompt in UI (not silent failure) | Error handling test |
| AC-06-04 | Zerodha checksum computed correctly (SHA256) | Cryptographic unit test |
| AC-06-05 | Holdings removed from broker are flagged but not auto-deleted | State test |
| AC-06-06 | Sync endpoint returns `403` for free tier user | Auth test |

---

## 7. Freemium & Subscription Module

**`MOD-07`** | **Tier:** All tiers | **Owner:** `auth_engine.py` + `routes.py`

### 7.1 Plan Enforcement Points

| Endpoint / Feature | Free Limit | Pro | Error Code on Breach |
|--------------------|-----------|-----|----------------------|
| `POST /discovery/scan` — strategy | `core` only | All strategies | `STRATEGY_LOCKED` |
| `POST /discovery/scan` — results | Top 10 | Unlimited | `RESULTS_CAPPED` (partial response) |
| `POST /analyze` — daily count | 3 per day | Unlimited | `DAILY_LIMIT` |
| `POST /analyze` — thesis depth | Summary only | Full thesis | `THESIS_PARTIAL` (partial response) |
| `POST /portfolio/add` — count | 10 holdings max | Unlimited | `HOLDING_LIMIT` |
| `GET /portfolio/history` — period | 1m only | All periods | `HISTORY_LIMIT` |
| `GET /portfolio/rebalance` | Blocked | Full access | `PRO_REQUIRED` |
| `GET /portfolio/sell-ranking` | Momentum signal only | 4-signal composite | `SELL_RANKING_LIMITED` |
| `POST /portfolio/sync/*` | Blocked | Full access | `PRO_REQUIRED` |
| Custom thresholds in scan | Blocked | Full access | `PRO_REQUIRED` |

### 7.2 Upgrade Flow (V1.0)

```
V1.0: External Payment (Razorpay or Stripe)

1. User hits paywall in app -> UpgradeModal shown
2. User taps 'Upgrade to Pro' -> open external URL:
   https://alphaseeker.in/upgrade?email={user_email}&plan=monthly|yearly
3. Payment processed externally on web
4. Payment webhook received: POST /api/v1/internal/activate-pro
   Body: { email, plan: 'monthly'|'yearly', payment_id }
5. Backend: UPDATE users SET plan='pro', plan_expires_at=<now + 30/365 days>
6. User must re-login OR implement GET /auth/refresh to avoid re-login friction

V1.1: Native In-App Purchase
- Use RevenueCat SDK for iOS StoreKit integration
- Product IDs: 'alphaseeker.pro.monthly' and 'alphaseeker.pro.annual'
- RevenueCat webhook updates backend on purchase/cancellation
```

### 7.3 UI: UpgradeModal Specification

Triggered by: any `PRO_REQUIRED`, `DAILY_LIMIT`, `STRATEGY_LOCKED`, `HOLDING_LIMIT` error response.

**Contents:**
- Header: "Unlock Alphaseeker Pro"
- Feature list (5 key benefits with checkmark icons):
  - Unlimited AI investment thesis (your personal Goldman Sachs analyst)
  - All 5 hedge fund strategy presets (Citadel, Jane Street, Millennium, DE Shaw)
  - Unlimited portfolio holdings + multi-broker sync
  - Full portfolio rebalancing with sell/buy swap pairs
  - Complete portfolio history with all timeframes
- Pricing: Rs. 499/month or Rs. 3,999/year (save 33%)
- Primary CTA: "Start Pro — Rs. 499/month"
- Secondary CTA: "Rs. 3,999/year"
- Footer: "Cancel anytime. No questions asked."

---

## 8. iOS App Configuration & Deployment Spec

**`MOD-08`** | **Owner:** `frontend/ios/` + `capacitor.config.json`

### 8.1 Capacitor Configuration

```json
{
  "appId": "com.alphaseeker.india",
  "appName": "Alphaseeker",
  "webDir": "dist",
  "plugins": {
    "GoogleAuth": {
      "scopes": ["profile", "email"],
      "serverClientId": "<GOOGLE_SERVER_CLIENT_ID>",
      "forceCodeForRefreshToken": true
    },
    "StatusBar": {
      "style": "DARK",
      "backgroundColor": "#1E3A5F"
    }
  },
  "ios": {
    "scheme": "com.alphaseeker.india",
    "contentInset": "always"
  }
}
```

### 8.2 Info.plist Required Keys

| Key | Value / Purpose |
|-----|----------------|
| `CFBundleURLSchemes` | `['com.alphaseeker.india']` — deep linking |
| `LSApplicationQueriesSchemes` | `['googlegmail', 'inbox-gmail']` — Google auth browser |
| `ITSAppUsesNonExemptEncryption` | `false` — no custom crypto |
| `NSFaceIDUsageDescription` | Optional (V1.1): "Use Face ID to unlock Alphaseeker quickly" |

### 8.3 App Store Submission Checklist

1. App icons: 1024x1024 PNG (no alpha), all required sizes generated by Xcode
2. Launch screen: configured in `LaunchScreen.storyboard`
3. Privacy policy URL: must be live before submission
4. Investment disclaimer: visible on discovery/analysis screens
5. **Sign in with Apple: implemented** (required alongside Google Sign In per App Store guidelines)
6. In-app purchase products: registered in App Store Connect before V1.1 IAP submission
7. Minimum iOS version: iOS 16.0 (Capacitor 8 requirement)
8. Category: **Finance**
9. Rating: 4+ (no user-generated content, no gambling)
10. Export compliance: No encryption, select "No" for ECCN

---

## 9. Error Handling & Edge Cases

### 9.1 Standard Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message.",
    "details": {}
  },
  "status": 400 | 401 | 403 | 404 | 429 | 500
}
```

**Error Code Reference:**
```
AUTH:      INVALID_CREDENTIALS, EMAIL_EXISTS, TOKEN_EXPIRED, INVALID_GOOGLE_TOKEN
PORTFOLIO: INVALID_TICKER, HOLDING_LIMIT, HISTORY_LIMIT
DISCOVERY: SCAN_IN_PROGRESS, JOB_NOT_FOUND, SCAN_CANCELLED
ANALYSIS:  DAILY_LIMIT, ANALYSIS_UNAVAILABLE, THESIS_PARSE_ERROR
PLAN:      PRO_REQUIRED, STRATEGY_LOCKED, RESULTS_CAPPED
BROKER:    BROKER_TOKEN_EXPIRED, BROKER_SYNC_FAILED
SYSTEM:    INTERNAL_ERROR, RATE_LIMITED, SERVICE_UNAVAILABLE
```

### 9.2 Critical Edge Cases

| Scenario | Expected Behaviour |
|----------|--------------------|
| yfinance returns no data for a ticker during scan | Log warning, skip ticker, continue scan. Never crash scan job. |
| Gemini returns invalid JSON (not parseable) | Retry once. If second attempt also fails, return `ANALYSIS_UNAVAILABLE`. |
| All Gemini models rate-limited simultaneously | Return `ANALYSIS_UNAVAILABLE` with `retry_after: 300` (5 minutes). |
| Portfolio sync adds duplicate tickers from broker | Weighted average price, combined quantity. One row per ticker per user. |
| User deletes account mid-scan | Scan completes in worker but results discarded. No orphaned data. |
| HDFC OAuth token expires during sync | Return `401 BROKER_TOKEN_EXPIRED`. Do not attempt sync. |
| Redis unavailable (scan queue down) | Return `503 SERVICE_UNAVAILABLE` for async scan. Offer sync scan as fallback. |
| Database unavailable | Return `503 SERVICE_UNAVAILABLE`. Log for alerting. |
| Nifty 500 ticker list stale (Yahoo Finance changes tickers) | `market_loader.py` refreshes ticker list weekly. Log mismatches for manual review. |
| User's `plan_expires_at` is in the past but plan field still `'pro'` | Middleware check on every request: if expired, downgrade to free in-request. Update DB async. |

---

## 10. Testing Strategy

### 10.1 Test Coverage Requirements

| Layer | Test Type | Coverage Target | Tools |
|-------|-----------|----------------|-------|
| Strategy Pipelines + Shared Platform Layers | Unit + Integration | >= 90% | pytest, pytest-cov |
| Sell Urgency Score | Property-based tests | >= 95% | hypothesis |
| Auth Engine | Unit + Integration | >= 90% | pytest + TestClient |
| Portfolio Engine | Unit + Integration | >= 85% | pytest |
| API Endpoints | Integration tests | >= 80% | FastAPI TestClient |
| Gemini Fallback Chain | Mock tests | >= 95% | pytest + unittest.mock |
| iOS UI | Manual + E2E | Critical flows | Xcode UI Tests |
| Freemium Gating | Integration | 100% of gate points | pytest |

### 10.2 Critical Test Scenarios

- Run `POST /discovery/scan` with each of the 6 strategy configs. Verify strategy-specific outputs are non-empty and sorted by normalized score descending.
- Run `compute_sell_urgency()` with a holding at -16% loss. Verify score >= 20 (stop-loss signal triggered).
- Run `compute_sell_urgency()` with RSI=33 and `MACD_hist < 0`. Verify score >= 25.
- Call `POST /analyze` as free user 4 times. Verify 4th returns `429 DAILY_LIMIT`.
- Call `POST /portfolio/add` 11 times as free user. Verify 11th returns `403 HOLDING_LIMIT`.
- Mock `gemini-2.5-flash` with 429. Verify fallback to `gemini-2.5-flash-lite`.
- Verify `thesis_cache` entry expires correctly after 6 hours.

---

## 11. Coding Agent Session Templates

> These are pre-formatted session briefs designed to be pasted directly into a coding agent session (Claude Code, Codex, etc.) to implement each module independently. **Each brief is self-contained.**

---

### AGENT-01 — Scanner Engine Enhancement

```
TASK: Enhance scanner_engine.py in the Alphaseeker backend.

CONTEXT:
- FastAPI backend at backend/app/engines/scanner_engine.py
- Uses yfinance for market data, pandas-ta for indicators
- Current implementation is working — do not rewrite existing stable logic
- Migrate toward hybrid architecture by adding strategy pipeline modules and shared platform services incrementally

IMPLEMENT:
1. Introduce `StrategyPipeline` interface and strategy registry (see TDD Section 5.2 and 6.1)
2. Implement/attach strategy-specific pipeline modules for:
   `core`, `citadel_momentum`, `jane_street_stat`, `millennium_quality`, `de_shaw_multifactor`, `custom`
3. Introduce shared platform services:
   data platform, risk guardrails, execution simulation, portfolio accounting, monitoring
4. Normalize strategy outputs to a common response contract (score/rationale/risk flags)
5. Keep freemium result cap: if user.plan == 'free', return results[:10]
6. Preserve progress_callback support for async scan status reporting

CONSTRAINTS:
- Strategy pipeline modules must be independently testable
- No global mutable state; config/context passed explicitly
- Add docstrings and type hints throughout
- Write pytest unit tests in tests/test_scanner_engine.py
- DO NOT rewrite existing working logic wholesale; migrate incrementally with compatibility shims
```

---

### AGENT-02 — Analyst Engine & Caching

```
TASK: Enhance analyst_engine.py to add caching and freemium controls.

CONTEXT:
- The Gemini integration and model fallback chain are ALREADY WORKING — do not touch them
- Add the following new capabilities on top of the existing code

IMPLEMENT:
1. Add thesis_cache SQLAlchemy model (see TDD Section 3.1 schema)
2. Add usage_log SQLAlchemy model (see TDD Section 3.1 schema)
3. Modify generate_thesis() to:
   a. Check thesis_cache before calling Gemini
   b. Store result in thesis_cache with 6-hour TTL after successful generation
   c. Increment usage_log on every new (non-cached) generation
4. Add check_daily_limit(user_email, action, limit, db) utility function
5. Modify POST /api/v1/analyze route in routes.py to:
   a. Call check_daily_limit (free: 3, pro: unlimited)
   b. Return partial thesis for free users (redact bull_case and bear_case fields,
      replace with ["Upgrade to Pro to view full analysis"])
   c. Support ?force_refresh=true for pro users (bypass cache)

CONSTRAINTS:
- Caching must use DB thesis_cache table (not Redis), for persistence across restarts
- Partial thesis: do NOT omit fields, use redaction strings
- All 403/429 errors must use standard error format from SPEC Section 9.1
- Write tests mocking Gemini API calls (do not make real API calls in tests)
```

---

### AGENT-03 — Portfolio Intelligence

```
TASK: Implement rebalancer_engine.py with full sell urgency scoring and rebalancing API.

CONTEXT:
- rebalancer_engine.py exists with basic structure — WORKING but incomplete
- Enhance the existing file, do not rewrite from scratch

IMPLEMENT:
1. compute_sell_urgency(holding, market_data, top_scan_score) function
   - Implement all 4 signals per SPEC Section 4.1
   - Signal 2 is skipped (not penalised) if top_scan_score is None (no recent scan)
   - Return { score: int (0-100), primary_signal: str, badge: str }
2. get_rebalancing_suggestions(user_email, db, redis) function
   - Load portfolio, load Redis scan results, create swap pairs per SPEC Section 4.2
3. Add GET /api/v1/portfolio/rebalance endpoint (Pro-gated) in routes.py
4. Add sell_urgency_score and sell_urgency_badge fields to GET /portfolio response

CONSTRAINTS:
- compute_sell_urgency must handle missing market_data fields gracefully (use defaults, never crash)
- Score always in [0, 100]
- Write property-based tests using hypothesis for the scoring function
- Pro gate must use the require_pro() dependency
```

---

### AGENT-04 — Freemium & Plan Management

```
TASK: Implement complete freemium enforcement across all Alphaseeker endpoints.

CONTEXT:
- This is largely new work. The users table does not yet have plan columns.
- The existing working features must remain intact.

IMPLEMENT:
1. Add 'plan' (VARCHAR 20, default 'free') and 'plan_expires_at' (TIMESTAMP, nullable)
   columns to users table via SQLAlchemy migration
2. Include plan and plan_expires_at in JWT payload (modify auth_engine.py)
3. Create require_pro() FastAPI dependency in routes.py
4. Create check_daily_limit(user_email, action, limit, db) utility
5. Create usage_log table (see SPEC Section 3.1 DB schema) and SQLAlchemy model
6. Apply gating to ALL endpoints per SPEC Section 7.1 (10 gate points)
7. Implement POST /api/v1/internal/activate-pro webhook endpoint:
   - Validates incoming payload: { email, plan, payment_id }
   - Updates user: plan='pro', plan_expires_at=now + 30 or 365 days
   - Webhook should validate a shared secret header for security
8. Add plan expiry check: if plan_expires_at < now, treat as free (downgrade async in background)

CONSTRAINTS:
- Plan state must be read from JWT payload on every request (avoid DB hit)
- All 403 errors must use standard error format from SPEC Section 9.1
- Write integration tests covering all 10 gate points from SPEC Section 7.1
- DO NOT break any existing auth, portfolio, or discovery functionality
```

---

### AGENT-05 — Zerodha Kite Integration

```
TASK: Implement Zerodha Kite OAuth and portfolio sync as a new broker integration.

CONTEXT:
- Pattern to follow: hdfc_engine.py (existing, working)
- Create a new file: backend/app/engines/zerodha_engine.py
- Add new routes to routes.py

IMPLEMENT:
1. Create zerodha_engine.py following hdfc_engine.py as the pattern
2. GET /api/v1/auth/zerodha/login -> return Kite Connect redirect URL
   URL format: https://kite.zerodha.com/connect/login?api_key={ZERODHA_API_KEY}&v=3
3. GET /api/v1/auth/zerodha/callback?request_token=<token>
   - Implement SHA256 checksum: SHA256(api_key + request_token + api_secret)
   - POST to https://api.kite.trade/session/token to get access_token
   - Store in broker_tokens table with broker='ZERODHA'
   - expires_at = today at 06:00 IST (Zerodha resets daily)
4. POST /api/v1/portfolio/sync/zerodha
   - Fetch holdings from GET https://api.kite.trade/portfolio/holdings
   - Map tradingsymbol to Yahoo Finance format (.NS suffix)
   - Use same upsert logic as HDFC sync (weighted average for duplicates)
5. Handle token expiry: if expires_at < now, return 401 BROKER_TOKEN_EXPIRED
6. Add iOS deep link for callback: com.alphaseeker.india://zerodha/callback
   (add to capacitor.config.json CFBundleURLSchemes)

CONSTRAINTS:
- All sync endpoints are Pro-gated (use require_pro() dependency)
- No Zerodha credentials stored in app or frontend — server-side only
- Environment variables: ZERODHA_API_KEY, ZERODHA_API_SECRET (add to .env.example)
- Write tests using mock Zerodha API responses (no real API calls in tests)
```

---

*Alphaseeker India | Version 1.0 | February 2026 | For Engineering & Coding Agents*
