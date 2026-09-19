# Upgrade Roadmap

## Phase 1 — Signal correctness & validation ✅
- Strict JSON Schema model output
- Hard confidence threshold gate
- M1 timeframe verification
- Poor-chart blocking
- Conservative NEUTRAL fallback

## Phase 2 — Architecture & persistence ✅
- Componentized React UI
- Groq service + normalized API errors + timeout
- Persistent threshold/settings
- Persistent local signal history (100 records)
- Per-record delete / clear all
- JSON + CSV export
- Connection-state feedback
- Vercel configuration

## Phase 3 — Input intelligence
- Local screenshot preflight
- Crop/readability heuristics
- Stronger chart evidence scoring
- Optional multi-timeframe context
- Multiple independent confirmation fields

## Phase 4 — Validation & analytics
- Outcome labeling
- Backtest/forward-test dataset format
- Win/loss analytics by confidence bucket, asset, pattern, and session
- Calibration charts
- Separate pattern confidence from directional confidence

## Phase 5 — Production security
- Server-side API proxy or authenticated accounts
- Secret handling / rate limiting / abuse protection
- Observability and deployment health checks
- Optional database sync and multi-device history
