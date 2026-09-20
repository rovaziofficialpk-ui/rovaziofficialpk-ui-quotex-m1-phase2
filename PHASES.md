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

## Phase 3.1 — Live browser tab capture ✅
- Explicit browser tab/window picker via secure display capture
- Fresh chart frame captured automatically on every Analyze click
- Live preview refresh / change tab / stop sharing controls
- Fresh live frames still pass the Phase 3 local preflight before AI usage
- Uploaded and pasted screenshots remain supported

## Phase 3.2 — Smart Auto Test ✅
- Adaptive live-tab frame sampling (3/5/10/15/30 seconds; 5s recommended)
- Hybrid frame-change detector using luminance, changed-pixel ratio, and edge differences
- Near-duplicate frames skipped before AI requests
- 15-second AI cooldown
- Existing local preflight + M1/evidence/context gates preserved
- Non-neutral signal stability streak tracking
- Circuit breaker after 3 consecutive failures
- Auto Test never executes trades

## Phase 4A — Historical forex backtesting ✅
- M1 OHLC CSV ingestion
- Common forex pair + custom pair selector
- Separate FOREX vs OTC datasets
- 60-candle historical chart replay through the same Groq vision pipeline
- One-candle expiry outcome labeling
- Win/loss/tie/NEUTRAL analytics
- Coverage, 3/4 vs 4/4 confirmation performance, and confidence buckets
- JSON/CSV backtest export

## Phase 4B — Forward validation & calibration ⏭️
- Live outcome recorder from the shared Quotex tab
- Pattern / asset / session analytics across larger datasets
- Calibration charts
- Separate empirical performance from AI setup confidence
- Compare historical replay vs live forward-test behavior

## Phase 5 — Production security
- Server-side API proxy or authenticated accounts
- Secret handling / rate limiting / abuse protection
- Observability and deployment health checks
- Optional database sync and multi-device history
