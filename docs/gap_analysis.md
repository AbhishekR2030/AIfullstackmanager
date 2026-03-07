# Alphaseeker India — Gap Analysis & Implementation Plan
**Version 1.0 | March 2026 | Codebase vs. Alphaseeker_SPEC.md**

> This document is the output of a full cross-reference of the existing codebase against `Alphaseeker_SPEC.md`. It lists every missing element by module and provides a prioritised implementation plan. Use this as the master backlog for coding agent sessions and sprint planning.

---

## Table of Contents
1. [MOD-01 — Discovery & Stock Screening](#mod-01--discovery--stock-screening)
2. [MOD-02 — AI Analyst Engine](#mod-02--ai-analyst-engine)
3. [MOD-03 — Portfolio Management](#mod-03--portfolio-management)
4. [MOD-04 — Portfolio Intelligence & Rebalancing](#mod-04--portfolio-intelligence--rebalancing)
5. [MOD-05 — Authentication & User Management](#mod-05--authentication--user-management)
6. [MOD-06 — Broker Integration](#mod-06--broker-integration)
7. [MOD-07 — Freemium & Subscription](#mod-07--freemium--subscription)
8. [MOD-08 — iOS App Configuration & Deployment](#mod-08--ios-app-configuration--deployment)
9. [MOD-09 — Error Handling & Edge Cases](#mod-09--error-handling--edge-cases)
10. [MOD-10 — Testing Strategy](#mod-10--testing-strategy)
11. [Prioritised Implementation Plan](#prioritised-implementation-plan)

---

## MOD-01 — Discovery & Stock Screening

**Owner:** `scanner_engine.py` | **SPEC Section:** 1

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-01-01 | `DELETE /discovery/cancel/{job_id}` endpoint not implemented | §1.4 UI, §1.5 AC-01-07 | High | ❌ Missing |
| G-01-02 | Cancel button in `Discovery.jsx` not wired to the cancel endpoint | §1.4 UI | Medium | ❌ Missing |
| G-01-03 | Sector filter pills not present in Discovery results UI (All Sectors / IT / Finance / Pharma / Auto / FMCG / Energy) | §1.4 UI | Medium | ❌ Missing |
| G-01-04 | Sort toggle on results not implemented (Score / RSI / Revenue Growth) | §1.4 UI | Medium | ❌ Missing |
| G-01-05 | Free user UI: after 10th result, cards are not blurred with "Upgrade to Pro" overlay | §1.4 UI | Medium | ❌ Missing |
| G-01-06 | Free user UI: Pro strategy cards do not show a lock icon and do not trigger an UpgradeModal on tap | §1.4 UI | Medium | ❌ Missing |
| G-01-07 | Scanner architecture not yet migrated to hybrid model: `StrategyPipeline` interface, shared platform layers, and strategy registry are absent | §1.3, AGENT-01 | High | ❌ Missing |

**Notes:**
- The five strategy presets (`core`, `citadel_momentum`, `jane_street_stat`, `millennium_quality`, `de_shaw_multifactor`) exist in `scanner_engine.py` but are not yet structured as independently testable pipeline modules per the updated SPEC.
- The updated SPEC (§1.3) requires shared platform layers (Data Platform, Risk Guardrails, Execution Simulation, Portfolio Accounting, Monitoring) to execute before every strategy pipeline. These are not present.
- `thresholds` request body schema has been updated in the SPEC to use nested `technical` and `fundamental` objects; confirm the current request parsing matches this.

---

## MOD-02 — AI Analyst Engine

**Owner:** `analyst_engine.py` | **SPEC Section:** 2

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-02-01 | `ThesisModal` has no skeleton loading state with estimated wait text `"Generating analysis... (~8 seconds)"` | §2.5 UI | Medium | ❌ Missing |
| G-02-02 | `ThesisModal` Bull/Bear sections show no lock icon overlay for free users with "Upgrade to Pro" CTA | §2.5 UI | Medium | ❌ Missing |
| G-02-03 | `model_used` and `cached` response fields are not surfaced in the ThesisModal footer | §2.5 UI | Low | ❌ Missing |

**Notes:**
- Backend caching (6-hour TTL via `ThesisCache`), daily limit checking, partial thesis redaction, and `force_refresh` for Pro users are believed to be implemented. Verify against AC-02-01 through AC-02-07.

---

## MOD-03 — Portfolio Management

**Owner:** `portfolio_engine.py` | **SPEC Section:** 3

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-03-01 | `tax_category` field (`'LTCG'` if > 365 days, `'STCG'` if ≤ 365 days) not computed in `portfolio_engine.py` | §3.1 Data Model, AC-03-05 | High | ❌ Missing |
| G-03-02 | XIRR not calculated in portfolio summary card | §3.5 UI | Medium | ❌ Missing |
| G-03-03 | Portfolio holdings sort order not enforced: SELL badge first, then ascending by `unrealised_pnl_pct` | §3.3 | Medium | ❌ Missing |
| G-03-04 | History period restriction for free users not confirmed: `403 HISTORY_LIMIT` must be returned for any period other than `1m` | §3.4, AC-03-07 | High | ❌ Unverified |
| G-03-05 | `GET /portfolio/history` periods `ytd` and `all` may not be implemented beyond `1w / 1m / 3m / 6m / 1y` | §3.4 | Medium | ❌ Unverified |
| G-03-06 | Portfolio screen period tabs (1W / 3M / 6M / 1Y / YTD / ALL) do not show a lock icon for free users | §3.5 UI | Medium | ❌ Missing |
| G-03-07 | Add Trade modal inline validation (red border + error message) not confirmed in UI | §3.5 UI | Low | ❌ Unverified |

---

## MOD-04 — Portfolio Intelligence & Rebalancing

**Owner:** `rebalancer_engine.py` | **SPEC Section:** 4

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-04-01 | `sell_urgency_score` and `sell_urgency_badge` not included in `GET /portfolio` response body | §3.3, §4.1 | High | ❌ Missing |
| G-04-02 | Rebalance response missing `last_scan_age_hours` field | §4.2 | Medium | ❌ Missing |
| G-04-03 | Signal 2 re-weighting: when no recent scan exists in Redis, the remaining 3 signals must be proportionally re-weighted — not penalising the holding | §4.1 | High | ❌ Unverified |
| G-04-04 | Portfolio screen "Rebalance" tab (`Holdings \| Rebalance` switcher) is absent from `Portfolio.jsx` | §4.3 UI | High | ❌ Missing |
| G-04-05 | Swap Pairs section (side-by-side sell→buy cards with rationale text) not implemented in UI | §4.3 UI | High | ❌ Missing |
| G-04-06 | Free tier `GET /portfolio/sell-ranking` should return momentum signal only; `SELL_RANKING_LIMITED` error code not confirmed | §7.1 | High | ❌ Unverified |

---

## MOD-05 — Authentication & User Management

**Owner:** `auth_engine.py` | **SPEC Section:** 5

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-05-01 | **Apple Sign In backend endpoint** (`POST /api/v1/auth/apple`) not implemented | §5.2, MOD-08 | **Critical** | ❌ Missing |
| G-05-02 | **Apple Sign In frontend button** not present on `Login.jsx` | §5.2, MOD-08 | **Critical** | ❌ Missing |
| G-05-03 | Account deletion endpoint not implemented; spec requires cascade delete of `portfolio_items`, `broker_tokens`, and `usage_log` | §5.4 AC-05-06 | High | ❌ Missing |
| G-05-04 | Password validation rules (min 8 chars, ≥1 number, ≥1 special char) at signup not confirmed in `auth_engine.py` | §5.1 | Medium | ❌ Unverified |
| G-05-05 | Plan expiry middleware: if `plan_expires_at < now`, request must be treated as free tier and DB updated asynchronously | §5.3, §9.2 | High | ❌ Unverified |

---

## MOD-06 — Broker Integration

**Owner:** `hdfc_engine.py`, `zerodha_engine.py` | **SPEC Section:** 6

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-06-01 | HDFC sync: holdings removed from broker must be **flagged** with `removed_from_broker` flag, not auto-deleted | §6.1 AC-06-05 | Medium | ❌ Unverified |
| G-06-02 | Groww CSV import (`POST /api/v1/portfolio/import/csv`) not implemented | §6.3 | Low | ❌ Missing (V1.2) |

---

## MOD-07 — Freemium & Subscription

**Owner:** `auth_engine.py`, `routes.py` | **SPEC Section:** 7

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-07-01 | **`UpgradeModal` React component does not exist** — no modal is shown when `PRO_REQUIRED`, `DAILY_LIMIT`, `STRATEGY_LOCKED`, or `HOLDING_LIMIT` errors are returned | §7.3 | **Critical** | ❌ Missing |
| G-07-02 | `SELL_RANKING_LIMITED` error code and partial-response gating on `GET /portfolio/sell-ranking` for free users not confirmed | §7.1 | High | ❌ Unverified |
| G-07-03 | `RESULTS_CAPPED` partial response code not confirmed for free scan truncation (results may be silently truncated without returning the code) | §7.1 | Medium | ❌ Unverified |
| G-07-04 | `THESIS_PARTIAL` response code not confirmed for free user thesis depth restriction | §7.1 | Medium | ❌ Unverified |
| G-07-05 | Plan expiry async DB downgrade not confirmed (see also G-05-05) | §7.1, §9.2 | High | ❌ Unverified |

**Full freemium gate checklist (all 10 points from §7.1):**

| Gate Point | Endpoint | Error Code | Confirmed |
|-----------|----------|------------|-----------|
| Strategy locked | `POST /discovery/scan` | `STRATEGY_LOCKED` | ❓ |
| Results capped | `POST /discovery/scan` | `RESULTS_CAPPED` | ❓ |
| Daily thesis limit | `POST /analyze` | `DAILY_LIMIT` | ✅ |
| Thesis depth | `POST /analyze` | `THESIS_PARTIAL` | ❓ |
| Holdings limit | `POST /portfolio/add` | `HOLDING_LIMIT` | ✅ |
| History period limit | `GET /portfolio/history` | `HISTORY_LIMIT` | ❓ |
| Rebalance blocked | `GET /portfolio/rebalance` | `PRO_REQUIRED` | ✅ |
| Sell ranking limited | `GET /portfolio/sell-ranking` | `SELL_RANKING_LIMITED` | ❓ |
| Broker sync blocked | `POST /portfolio/sync/*` | `PRO_REQUIRED` | ✅ |
| Custom thresholds blocked | `POST /discovery/scan` (custom strategy) | `PRO_REQUIRED` | ❓ |

---

## MOD-08 — iOS App Configuration & Deployment

**Owner:** `frontend/ios/`, `capacitor.config.json` | **SPEC Section:** 8

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-08-01 | **Apple Sign In Capacitor plugin** (`@capacitor-community/apple-sign-in`) not installed or configured | §8.1, §5.2 | **Critical** | ❌ Missing |
| G-08-02 | `Info.plist` missing `NSFaceIDUsageDescription` key (optional, V1.1) | §8.2 | Low | ❌ Missing |
| G-08-03 | **Investment disclaimer** text not present on Discovery or Analysis screens | §8.3 item 4 | High | ❌ Missing |
| G-08-04 | App icon set is incomplete — only a single 512@2x PNG exists; all required Xcode sizes not generated | §8.3 item 1 | High | ❌ Incomplete |
| G-08-05 | **Privacy policy URL** not linked from within the app | §8.3 item 3 | High | ❌ Missing |
| G-08-06 | Deep link scheme for Zerodha callback (`com.alphaseeker.india://zerodha/callback`) may not be registered in `CFBundleURLSchemes` | §6.2, AGENT-05 | Medium | ❌ Unverified |

---

## MOD-09 — Error Handling & Edge Cases

**Owner:** `routes.py` | **SPEC Section:** 9

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-09-01 | Standard error response format `{ "error": { "code", "message", "details" }, "status": ... }` not consistently applied — some endpoints return plain strings or bare `HTTPException` | §9.1 | High | ❌ Incomplete |
| G-09-02 | `SCAN_CANCELLED` status not returned anywhere (cancel endpoint is also missing — see G-01-01) | §9.1 | Medium | ❌ Missing |
| G-09-03 | Redis unavailable fallback: async scan should return `503 SERVICE_UNAVAILABLE` and offer sync scan as fallback | §9.2 | Medium | ❌ Missing |
| G-09-04 | `BROKER_SYNC_FAILED` error code not confirmed in HDFC / Zerodha sync error paths | §9.1 | Low | ❌ Unverified |

---

## MOD-10 — Testing Strategy

**Owner:** `backend/tests/` | **SPEC Section:** 10

| # | Gap | Spec Ref | Severity | Status |
|---|-----|----------|----------|--------|
| G-10-01 | No `tests/test_scanner_engine.py` covering all strategy pipelines and shared platform layers (target: ≥90% coverage) | §10.1 | High | ❌ Missing |
| G-10-02 | No property-based tests using `hypothesis` for sell urgency scoring (target: ≥95% coverage) | §10.1, §10.2 | High | ❌ Missing |
| G-10-03 | No integration tests covering all 10 freemium gate points (target: 100%) | §10.1 | High | ❌ Missing |
| G-10-04 | No mock-based tests for Gemini model fallback chain (target: ≥95% coverage) | §10.1 | High | ❌ Missing |
| G-10-05 | `hypothesis` library not present in `requirements.txt` | §10.1 | Medium | ❌ Missing |

---

## Prioritised Implementation Plan

### P0 — App Store Blockers
> Must be completed before any App Store submission. App will be rejected without these.

| Item | Gap IDs | Owner | Est. Effort |
|------|---------|-------|-------------|
| Apple Sign In — backend (`POST /auth/apple`) + frontend button + Capacitor plugin | G-05-01, G-05-02, G-08-01 | AGENT-05 / Full-stack | Large |
| `UpgradeModal` React component (all 5 paywall trigger points) | G-07-01 | Frontend | Medium |
| Investment disclaimer on Discovery and Analysis screens | G-08-03 | Frontend | Small |
| App icon all-sizes generation in Xcode | G-08-04 | iOS | Small |
| Privacy policy in-app link | G-08-05 | Frontend | Small |

---

### P1 — Core Product Completeness
> Required for a complete, correctly functioning V1.0 product.

| Item | Gap IDs | Owner | Est. Effort |
|------|---------|-------|-------------|
| `sell_urgency_score` + `sell_urgency_badge` in `GET /portfolio` response | G-04-01 | Backend | Small |
| Rebalance tab UI in `Portfolio.jsx` (Holdings \| Rebalance switcher + Swap Pairs section) | G-04-04, G-04-05 | Frontend | Large |
| `tax_category` (LTCG / STCG) in portfolio analytics | G-03-01 | Backend | Small |
| Plan expiry middleware check on every request | G-05-05, G-07-05 | Backend | Medium |
| `DELETE /discovery/cancel/{job_id}` endpoint + Cancel button in UI | G-01-01, G-01-02 | Full-stack | Medium |
| Standard error response format applied consistently across all endpoints | G-09-01 | Backend | Medium |
| Scanner hybrid architecture: `StrategyPipeline` interface + shared platform layers | G-01-07 | Backend (AGENT-01) | Large |

---

### P2 — Freemium Gating Completeness
> Ensures all 10 gate points from SPEC §7.1 are enforced and visible to the user.

| Item | Gap IDs | Owner | Est. Effort |
|------|---------|-------|-------------|
| History period gating — `403 HISTORY_LIMIT` for free users on non-`1m` periods | G-03-04 | Backend | Small |
| Lock icons on non-`1m` period tabs in Portfolio screen | G-03-06 | Frontend | Small |
| Sector filter pills + sort toggle in Discovery results | G-01-03, G-01-04 | Frontend | Medium |
| Free user blur overlay on results #11+ in Discovery | G-01-05 | Frontend | Small |
| Lock icon on Pro strategy cards → open UpgradeModal | G-01-06 | Frontend | Small |
| Lock icon overlay on ThesisModal Bull/Bear sections for free users | G-02-02 | Frontend | Small |
| Verify + enforce `SELL_RANKING_LIMITED` gate | G-04-06, G-07-02 | Backend | Small |
| Verify `RESULTS_CAPPED` and `THESIS_PARTIAL` error codes are returned (not silent) | G-07-03, G-07-04 | Backend | Small |
| Verify `STRATEGY_LOCKED` and custom threshold gate | — | Backend | Small |
| `last_scan_age_hours` in rebalance response | G-04-02 | Backend | Small |

---

### P3 — Quality, Compliance & UX Polish

| Item | Gap IDs | Owner | Est. Effort |
|------|---------|-------|-------------|
| Test suite: scanner pipeline unit tests (≥90% coverage) | G-10-01 | Backend | Large |
| Test suite: hypothesis property-based tests for sell urgency scoring | G-10-02 | Backend | Medium |
| Test suite: freemium gate integration tests (100% of 10 gates) | G-10-03 | Backend | Medium |
| Test suite: Gemini fallback chain mock tests (≥95% coverage) | G-10-04 | Backend | Medium |
| Add `hypothesis` to `requirements.txt` | G-10-05 | Backend | Small |
| XIRR calculation in portfolio summary | G-03-02 | Backend | Medium |
| Account deletion endpoint with cascade delete | G-05-03 | Backend | Medium |
| Portfolio holdings sort order (SELL first, then ascending P&L %) | G-03-03 | Backend | Small |
| Skeleton loader + estimated wait text in ThesisModal | G-02-01 | Frontend | Small |
| `model_used` + `cached` displayed in ThesisModal footer | G-02-03 | Frontend | Small |
| Signal 2 re-weighting when no recent scan available | G-04-03 | Backend | Medium |
| Redis unavailable → fallback to sync scan + 503 response | G-09-03 | Backend | Medium |
| Password validation at signup (8 chars, 1 number, 1 special) | G-05-04 | Backend | Small |
| HDFC sync: flag removed holdings, do not auto-delete | G-06-01 | Backend | Small |
| Zerodha deep link in `CFBundleURLSchemes` | G-08-06 | iOS | Small |
| Add Trade modal inline field validation | G-03-07 | Frontend | Small |

---

### P4 — Future / V1.1+

| Item | Gap IDs | Notes |
|------|---------|-------|
| Groww CSV import (`POST /portfolio/import/csv`) | G-06-02 | Dependent on Groww API availability |
| Face ID (`NSFaceIDUsageDescription`) | G-08-02 | SPEC marks as optional V1.1 |
| RevenueCat native IAP (StoreKit) | — | Replace external Razorpay/Stripe flow |
| `GET /auth/refresh` to avoid re-login after subscription activation | §7.2 | SPEC notes as reducing friction |

---

## Gap Count Summary

| Module | Critical | High | Medium | Low | Total |
|--------|----------|------|--------|-----|-------|
| MOD-01 Discovery | 0 | 2 | 5 | 0 | 7 |
| MOD-02 AI Analyst | 0 | 0 | 2 | 1 | 3 |
| MOD-03 Portfolio | 0 | 2 | 4 | 1 | 7 |
| MOD-04 Rebalancing | 0 | 4 | 2 | 0 | 6 |
| MOD-05 Auth | 2 | 2 | 1 | 0 | 5 |
| MOD-06 Brokers | 0 | 0 | 1 | 1 | 2 |
| MOD-07 Freemium | 1 | 2 | 2 | 0 | 5 |
| MOD-08 iOS | 1 | 3 | 1 | 1 | 6 |
| MOD-09 Errors | 0 | 1 | 2 | 1 | 4 |
| MOD-10 Testing | 0 | 4 | 1 | 0 | 5 |
| **Total** | **4** | **20** | **21** | **5** | **50** |

---

*Alphaseeker India | Gap Analysis v1.0 | Generated March 2026*
*Cross-referenced against: `Alphaseeker_SPEC.md` v1.0 (February 2026, updated March 2026)*
