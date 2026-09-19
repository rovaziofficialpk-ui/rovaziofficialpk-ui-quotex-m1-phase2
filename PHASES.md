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
- Vercel/Railway-ready static deployment

## Phase 3 — Input intelligence ✅
- Local screenshot preflight before API requests
- Resolution / contrast / detail / exposure / crop heuristics
- Optional M5/H1 context screenshots
- Independent trend / momentum / structure / candle confirmations
- Directional signal requires ≥3/4 aligned evidence checks
- Opposing-evidence and higher-timeframe conflict gates
- Evidence score, context alignment, and quality metrics in UI/history

## Phase 4 — Validation & analytics ⏭️
- Outcome labeling
- Backtest/forward-test dataset format
- Win/loss analytics by confidence bucket, asset, pattern, and session
- Calibration charts
- Separate empirical performance from AI setup confidence

## Phase 5 — Production security
- Server-side API proxy or authenticated accounts
- Secret handling / rate limiting / abuse protection
- Observability and deployment health checks
- Optional database sync and multi-device history
