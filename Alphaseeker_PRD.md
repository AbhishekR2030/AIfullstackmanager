# ALPHASEEKER INDIA — Product Requirements Document (PRD)
**Version 1.0 | February 2026 | Confidential**

> *"Your personal Goldman Sachs analyst — in your pocket."*

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Mission](#2-product-vision--mission)
3. [Target Users & Personas](#3-target-users--personas)
4. [Market Opportunity](#4-market-opportunity)
5. [Core Value Proposition](#5-core-value-proposition)
6. [Feature Requirements](#6-feature-requirements)
7. [Freemium Tier Structure](#7-freemium-tier-structure)
8. [Key User Stories](#8-key-user-stories)
9. [Success Metrics & KPIs](#9-success-metrics--kpis)
10. [Product Roadmap](#10-product-roadmap)
11. [Constraints & Assumptions](#11-constraints--assumptions)
12. [Legal & Compliance](#12-legal--compliance)

---

## 1. Executive Summary

Alphaseeker is an AI-powered investment intelligence platform for the Indian equity market. It is designed for **active retail traders and intermediate-to-advanced investors** who want institutional-grade stock screening, AI-driven investment theses, and intelligent portfolio rebalancing — all in a native iOS mobile experience.

The platform's core differentiator is its **AI Analyst Engine**, powered by Google Gemini, which generates plain-English investment theses for every stock recommendation — modeled after the depth of analysis produced by tier-1 investment banking research desks. Every Buy/Sell/Hold recommendation is backed by a structured bull case, bear case, and confidence score.

The backend features **academically rigorous quantitative screening strategies** inspired by documented factor models used at leading global hedge funds (Citadel, Jane Street, Millennium, DE Shaw). The platform follows a **hybrid architecture**: shared platform layers (data, risk, execution, portfolio accounting, monitoring) with strategy-specific alpha pipelines for signal generation and stock ranking.

The product launches on iOS with a **Freemium model**: a free tier for casual exploration and a Pro subscription tier unlocking unlimited scans, advanced hedge fund strategies, full AI thesis depth, and multi-broker portfolio sync.

---

## 2. Product Vision & Mission

### 2.1 Vision
To democratise institutional investment intelligence for Indian retail traders — making the analytical depth of top-tier hedge funds and investment banks accessible to anyone with a smartphone.

### 2.2 Mission
Alphaseeker's mission is to help active investors in India make higher-conviction, data-backed investment decisions by combining quantitative screening, AI-powered analysis, and portfolio intelligence in a single, intuitive mobile application.

### 2.3 Core Philosophy
- **Alpha is earned, not guessed.** Every recommendation must be backed by data and rigorous logic.
- **Transparency builds trust.** Users must understand *why* a stock is recommended, not just that it is.
- **Intelligence should be actionable.** Insights must drive clear actions: Buy, Hold, or Sell.
- **Quality over quantity.** A shortlist of high-conviction picks beats a list of 500 mediocre ones.

---

## 3. Target Users & Personas

### 3.1 Primary Persona: The Active Trader

| Field | Detail |
|-------|--------|
| **Name** | Rohan, 34, Mumbai |
| **Profession** | Software Engineer / IT Manager |
| **Portfolio Size** | Rs. 10–50 Lakhs across 15–25 stocks |
| **Brokers** | Zerodha Kite, HDFC Sky |
| **Behaviour** | Checks market daily. Reads Moneycontrol, Economic Times. Understands RSI, MACD. Trades 3–5 times per month. |
| **Pain Points** | Too many stocks to track. No structured framework for selling. FOMO-driven decisions. Relies on tips from Twitter/WhatsApp groups. |
| **Job To Be Done** | *"I want a trusted system that tells me what to buy and what to sell this week, with clear reasoning I can act on."* |

### 3.2 Secondary Persona: The Informed Investor

| Field | Detail |
|-------|--------|
| **Name** | Priya, 42, Bengaluru |
| **Profession** | Senior Product Manager |
| **Portfolio Size** | Rs. 50 Lakhs–1 Cr, diversified across large & mid caps |
| **Behaviour** | Reviews portfolio monthly. Risk-aware. Does not day-trade. Wants quality over momentum. Uses Groww. |
| **Pain Points** | Stale positions she holds too long. No system for identifying when fundamentals deteriorate. Wants AI opinion without jargon. |
| **Job To Be Done** | *"Help me audit my portfolio monthly and flag what I should exit before it becomes a loss."* |

---

## 4. Market Opportunity

### 4.1 Indian Retail Investor Market
- 140M+ Demat accounts as of 2025, growing 20%+ year-on-year (SEBI data)
- Active trader segment: ~25–30 million regular equity traders
- Smartphone penetration and UPI adoption driving mobile-first financial behaviour
- Existing apps (Zerodha, Smallcase, Tickertape) do screening or portfolio — **none combine quant screening + AI thesis + portfolio rebalancing in one product**

### 4.2 Competitive Landscape

| Product | Screening | AI Thesis | Portfolio Sync | Rebalancing | Mobile Native |
|---------|-----------|-----------|----------------|-------------|---------------|
| Tickertape | Yes (basic) | No | No | No | Web-only |
| Smallcase | Thematic | No | Partial | Thematic only | Yes |
| Screener.in | Advanced | No | No | No | Web-only |
| Sensibull | Options focus | No | No | No | Yes |
| **Alphaseeker** | **Hedge Fund-grade** | **Yes (Gemini AI)** | **Yes (multi-broker)** | **AI-driven** | **Yes (iOS first)** |

---

## 5. Core Value Proposition

### 5.1 Hero Feature: AI Analyst Engine
The AI Analyst Engine is Alphaseeker's primary differentiator. For every stock surfaced by the screening engine, Alphaseeker generates a structured investment thesis powered by Google Gemini — mimicking the depth of a Tier-1 sell-side analyst report, but instantly and at zero cost to the user.

The thesis includes: a clear Buy/Sell/Hold recommendation, three specific bull-case growth drivers, three specific bear-case risk factors, a confidence score (0–100), and a plain-English summary paragraph. This transforms screening results from data points into decisions.

### 5.2 Quant Strategy Engine
The screening engine implements academically rigorous multi-factor models inspired by documented strategies from top global hedge funds. Users select a strategy preset — each with distinct features, filters, scoring logic, and rebalance intent. Alphaseeker uses a **hybrid quant architecture**:
- **Shared platform layers:** market data ingestion, quality checks, risk controls, execution simulation, portfolio accounting, observability.
- **Strategy-specific alpha pipelines:** strategy-owned feature engineering, filter stacks, scoring functions, and ranking outputs.

### 5.3 Portfolio Intelligence
Alphaseeker does not just tell users what to buy. It analyses their existing portfolio — synced from their broker or entered manually — and surfaces which holdings to SELL, which to HOLD, and in what order to act. The sell prioritisation logic combines momentum deterioration, fundamental weakening, stop-loss triggers, and relative opportunity cost.

---

## 6. Feature Requirements

### 6.1 Module 1: Discovery & Stock Screening

#### 6.1.1 Strategy Presets

| Strategy | Academic Basis | Factor Focus | Tier |
|----------|---------------|--------------|------|
| Citadel Momentum | Jegadeesh & Titman (1993) Momentum Factor | 12-1 month price momentum + volume shock + RSI trend | Pro |
| Jane Street Statistical | Pairs trading & mean-reversion (Gatev et al.) | Mean-reversion blend + spread Z-score + sector-relative RSI | Pro |
| Millennium Quality | Fama-French Quality Factor (QMJ) | ROE - WACC spread, gross profitability, low debt, stable earnings | Pro |
| DE Shaw Multi-Factor | AQR Multi-Factor model (Value + Momentum + Quality) | Combined factor score: momentum + quality + low-volatility tilt | Pro |
| Alphaseeker Core | Custom composite (Momentum + Quality) | Balanced score blending technical + fundamental signals | Free |
| Custom Thresholds | User-defined | User configures all screening parameters manually | Pro |

#### 6.1.2 Hybrid Strategy Architecture

Alphaseeker does **not** enforce one identical stage pipeline across all strategies. Instead:

**A) Shared Platform Layers (common to all strategies):**
- **Data layer:** universe definition, OHLCV/fundamental ingestion, ticker normalization, cache.
- **Risk layer:** liquidity floors, hard compliance checks, concentration guardrails, fail-safe limits.
- **Execution layer:** signal-to-order simulation, slippage assumptions, tradeability validation.
- **Portfolio accounting layer:** PnL, exposure, turnover, replacement feasibility.
- **Monitoring layer:** scan latency, data quality metrics, pipeline health, drift alerts.

**B) Strategy-Specific Alpha Pipelines (custom per strategy):**
- Each strategy owns its own feature set and filtering logic (not just different thresholds).
- Each strategy defines its own scoring model and ranking math.
- Strategy outputs are normalized to a common contract for the app UI.

**Strategy examples:**
- **Citadel Momentum:** trend-continuation features (12-1 momentum, volume shock, RSI trend).
- **Jane Street Statistical:** mean-reversion and spread-dislocation features.
- **Millennium Quality:** quality/profitability stability and balance-sheet discipline.
- **DE Shaw Multi-Factor:** blended momentum + quality + valuation + low-volatility tilt.
- **Alphaseeker Core:** balanced baseline strategy for free-tier users.
- **Custom Thresholds:** user-parameterized scan profile (Pro).

**Scoring contract (platform-level):**
- Every strategy returns a normalized 0–100 conviction score, rationale summary, and metadata.
- Final ranked list is displayed in descending normalized conviction score.

#### 6.1.3 Async Scan Execution
- Scans run asynchronously via Celery workers (avoids HTTP timeout on large universes)
- Real-time progress indicator in app (percentage complete + stocks processed count)
- Scan results cached in Redis for 4 hours to avoid redundant computation
- User can cancel an in-progress scan

#### 6.1.4 Scan Results Display
- Results shown as ranked stock cards: Ticker, Company Name, Upside Score badge, Sector, Market Cap
- Each card shows preview: RSI value, Momentum indicator, AI Recommendation badge (Buy/Hold)
- Tap card to expand Full AI Thesis modal
- Sort results by: Upside Score (default), RSI, Revenue Growth, ROE
- Filter results by: Sector, Market Cap tier (Small/Mid/Large), Minimum score

---

### 6.2 Module 2: AI Analyst Engine

#### 6.2.1 Thesis Output Structure

| Field | Description | Example |
|-------|-------------|---------|
| Recommendation | Buy / Hold / Sell with confidence level | BUY (82% confidence) |
| Analyst Summary | 2–3 sentence plain-English investment case | TCS is a high-quality IT compounder... |
| Bull Case (3 drivers) | Specific growth catalysts with supporting data | 1. AI services pipeline up 45% YoY... |
| Bear Case (3 risks) | Specific risk factors with magnitude estimate | 1. USD/INR headwind: 3–4% earnings impact... |
| Confidence Score | 0–100 score based on data conviction | 82 |
| Key Metrics Snapshot | P/E, ROE, ROCE, Revenue Growth, D/E | P/E: 28x | ROE: 24% | Rev Growth: 14% |
| Model Attribution | Which Gemini model generated the thesis | gemini-2.5-flash |

#### 6.2.2 Model Fallback Strategy
- Primary: `gemini-2.5-flash` (highest quality)
- Fallback 1: `gemini-2.5-flash-lite` (higher rate limit)
- Fallback 2: `gemini-2.0-flash` (legacy)
- Rate limit tracking: 429 errors trigger temporary model blacklisting (15-minute cooldown)
- All models fail: display cached thesis if available, else show "Analysis temporarily unavailable"

#### 6.2.3 Freemium Gating
- **Free Tier:** 3 AI thesis generations per day. After limit, paywall prompt shown.
- **Pro Tier:** Unlimited thesis generation. Full bull/bear breakdown. All Gemini models available.

---

### 6.3 Module 3: Portfolio Management & Intelligence

#### 6.3.1 Portfolio Entry Methods
- Manual Entry: Add trade with ticker, quantity, buy price, buy date
- HDFC Sky Sync: OAuth-based automatic import (implemented ✅)
- Zerodha Kite Sync: OAuth integration (V1.1 roadmap)
- Groww Sync: API integration (V1.2 roadmap)
- Angel One Sync: API integration (V1.2 roadmap)
- Paytm Money Sync: OAuth integration (V1.2 roadmap)

#### 6.3.2 Portfolio Analytics Dashboard
- Total portfolio value with daily P&L (absolute + percentage)
- Invested amount vs. current value with overall XIRR
- Individual holding P&L: unrealised gain/loss per stock
- Holding age tracker: colour-coded (green = long-term LTCG, yellow = medium, red = STCG)
- Portfolio value history chart: 1W, 1M, 3M, 6M, 1Y, YTD, ALL timeframes
- Sector exposure breakdown (pie chart)
- Top 5 gainers and top 5 laggards in portfolio

#### 6.3.3 Intelligent Sell/Hold Ranking

| Signal | Weight | Trigger Condition | Description |
|--------|--------|-------------------|-------------|
| Momentum Deterioration | 25% | RSI < 40 OR MACD bearish crossover | Technical breakdown in the stock trend |
| Better Opportunity Score | 30% | Holding score < Top scanner result by 25+ points | Opportunity cost: better stock exists in market |
| Fundamental Weakening | 25% | ROE dropped > 20% QoQ OR Revenue growth negative | Business quality declining quarter-on-quarter |
| Stop-Loss Trigger | 20% | Price down > 15% from buy price OR > 10% trailing stop | Capital preservation: hard stop breached |

Each holding receives a **Sell Urgency Score (0–100)**:
- Score > 60 → 🔴 **SELL** badge
- Score 30–60 → 🟡 **REVIEW** badge
- Score < 30 → 🟢 **HOLD** badge

#### 6.3.4 Rebalancing Recommendations
- Swap Suggestions: "Sell [Stock A] (Sell Urgency: 78) — Buy [Stock B] (Upside Score: 84)"
- Capital freed is matched to recommended buys of equivalent or higher size
- Rebalancing is advisory only — no order execution in V1
- One-tap to view full AI thesis on both the sell candidate and the buy recommendation

---

### 6.4 Module 4: Authentication & User Management
- Email/password registration with secure JWT sessions
- Google OAuth via native iOS Sign-In (Capacitor plugin)
- **Sign in with Apple** (required for App Store alongside Google Sign-In)
- HDFC OAuth deep-link callback via custom URI scheme
- Session persistence across app restarts (Capacitor Preferences)
- Password reset via email (V1.1)
- Account deletion (GDPR/DPDP-compliant data erasure)

---

### 6.5 Module 5: Watchlist & Alerts (V1.1)
- Add any stock to watchlist from scan results or search
- Watchlist stored locally (no backend sync required in V1)
- Price alerts: notify when stock hits a target price (iOS push notification)
- AI thesis refresh alerts: notify when recommendation changes for a watchlisted stock
- Portfolio alerts: notify when a holding's Sell Urgency score crosses 60

---

## 7. Freemium Tier Structure

| Feature | Free Tier | Pro Tier |
|---------|-----------|----------|
| Stock Universe | Nifty 500 screening | Nifty 500 + curated mid-cap extended list |
| Strategy Presets | Alphaseeker Core only | All 6 strategies (Citadel, Jane Street, Millennium, DE Shaw, Core, Custom) |
| Scans per Day | 1 scan per day | Unlimited scans |
| Scan Result Size | Top 10 results | Full results list (no cap) |
| AI Thesis | 3 per day | Unlimited |
| Thesis Depth | Summary only (no bull/bear breakdown) | Full thesis with bull case, bear case, confidence score |
| Portfolio Holdings | Up to 10 holdings | Unlimited holdings |
| Broker Sync | No | Yes (HDFC + all integrated brokers) |
| Sell/Hold Ranking | Basic (momentum signal only) | Full 4-signal composite Sell Urgency score |
| Portfolio History Chart | 1 month only | All timeframes (1W to ALL) |
| Rebalancing Suggestions | No | Yes (swap recommendations) |
| Alerts & Notifications | No | Yes (price, thesis, portfolio alerts) |
| Threshold Customisation | No | Yes (full custom scan configuration) |
| **Price** | **Free forever** | **Rs. 499/month or Rs. 3,999/year** |

---

## 8. Key User Stories

### 8.1 Discovery & Screening
1. As an active trader, I want to run a Citadel Momentum scan so I can find high-momentum Indian stocks that top quant funds would buy today.
2. As a Pro user, I want to customise the RSI and Debt/Equity thresholds so the scanner matches my personal risk tolerance.
3. As a free user, I want to see the top 10 results from the Alphaseeker Core strategy so I can evaluate if the Pro upgrade is worth it.
4. As a user, I want to see an AI analyst thesis for any scan result stock so I understand the specific reason to buy.

### 8.2 Portfolio Management
1. As a user, I want to manually add my trades so Alphaseeker can analyse my portfolio without needing broker access.
2. As an HDFC Sky user, I want to sync my portfolio with one tap so my holdings are always current.
3. As a user, I want to see which stocks in my portfolio I should sell first, ranked by urgency, so I always know what to exit before adding new positions.
4. As a user, I want to see specific swap recommendations so I know exactly which holding to sell and which new stock to buy with those proceeds.

### 8.3 AI Thesis
1. As a user, I want a plain-English bull case for a recommended stock so I can explain to myself why I'm buying it.
2. As a user, I want a bear case so I am aware of the risks before I commit capital.
3. As a Pro user, I want unlimited thesis generation so I can research all stocks in a scan result without hitting daily caps.

---

## 9. Success Metrics & KPIs

### 9.1 Growth Metrics
- Month 1 target: 500 downloads on iOS App Store India
- Month 3 target: 2,500 MAU, 5% Free-to-Pro conversion rate
- Month 6 target: 10,000 MAU, Rs. 5 Lakh Monthly Recurring Revenue
- Day-7 retention target: > 35% (benchmark for finance apps)
- Day-30 retention target: > 15%

### 9.2 Engagement Metrics
- Average scans per active user per week: target > 3
- AI thesis views per session: target > 2
- Portfolio sync rate (users who connect at least one broker): target > 40% of Pro users
- Session duration: target > 4 minutes average

### 9.3 Quality Metrics
- Scan completion rate (async scans that complete without error): target > 95%
- AI thesis generation success rate (including fallback): target > 99%
- App crash rate: < 0.5% of sessions (App Store standard)
- App Store rating: target > 4.4 stars

---

## 10. Product Roadmap

| Phase | Timeline | Key Deliverables |
|-------|----------|-----------------|
| Phase 1 — V1.0 Launch | Q1 2026 | iOS App Store submission. Full Discovery module. Portfolio CRUD + HDFC sync. AI Thesis engine. Freemium gating. Core + 4 hedge fund strategy presets. |
| Phase 2 — V1.1 | Q2 2026 | Zerodha Kite integration. Watchlist + Push notifications. Password reset. Portfolio alerts (Sell Urgency threshold breach). Performance attribution analytics. |
| Phase 3 — V1.2 | Q3 2026 | Groww + Angel One + Paytm Money broker sync. Backtesting engine (run a strategy on 1–3 year historical data). Multiple portfolio support. CSV portfolio import/export. |
| Phase 4 — V2.0 | Q4 2026 | Android launch. Paper trading simulation. Real-time live price updates. US equities (Nasdaq 100) as optional universe. Advanced multi-leg portfolio analytics. |

---

## 11. Constraints & Assumptions

### 11.1 Data Constraints
- Market data sourced from Yahoo Finance API (free). Delay: 15 minutes for Indian equities.
- Fundamental data (ROE, ROCE, Revenue) via Yahoo Finance — quarterly updates, not real-time.
- Historical price data available up to 10 years from Yahoo Finance.
- FMP (Financial Modeling Prep) integration available as optional premium data upgrade.

### 11.2 Regulatory Constraints
- Alphaseeker is an **information and screening platform**. It does NOT provide SEBI-regulated investment advice.
- All recommendations must be accompanied by a standard disclaimer: *"This is not financial advice. Past performance is not indicative of future results. Consult a SEBI-registered advisor before investing."*
- No order execution capability in V1. All trades are placed by the user in their respective broker apps.

### 11.3 Technical Constraints
- iOS only for V1.0. Android in V2.0.
- Backend hosted on Render (free/starter tier). Scale-up plan when MRR justifies cost.
- Redis limited to 25MB on free tier. Scan result caching limited to ~100 concurrent jobs.
- Gemini API rate limits managed via model fallback strategy. No SLA guarantee on AI thesis speed.

---

## 12. Legal & Compliance
- Terms of Service and Privacy Policy required before App Store submission.
- Data stored: email, hashed password, portfolio holdings (encrypted at rest in PostgreSQL).
- HDFC OAuth tokens stored securely; rotated on re-authentication.
- Google Sign-In compliant with App Store guidelines. **Sign in with Apple also required** for iOS if Google is offered.
- GDPR/DPDP (India Digital Personal Data Protection Act 2023): user data deletion on request within 30 days.
- Standard investment disclaimer on every recommendation screen (required by SEBI framework for information platforms).

---

*Alphaseeker India | Version 1.0 | February 2026 | Confidential & Proprietary*
