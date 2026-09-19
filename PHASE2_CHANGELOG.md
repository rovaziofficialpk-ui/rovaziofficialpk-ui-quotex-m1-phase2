# Phase 2 — Architecture & Persistence

## Completed
- Split the Phase 1 monolithic App into focused UI components.
- Moved Groq networking, timeout, response parsing, and user-facing error normalization into `src/services/groq.ts`.
- Moved browser persistence into `src/services/storage.ts`.
- Persisted minimum confidence threshold automatically.
- Persisted up to 100 signal-analysis records in localStorage.
- Added timestamp, response time, threshold, final bias, and proposed bias to saved history.
- Added per-record delete and clear-all controls.
- Added JSON and CSV export of analysis history.
- Migrated the old `groq_api_key` localStorage key automatically.
- Added connection-state feedback without alert popups.
- Added 45-second analysis timeout and clearer API/network/rate-limit errors.
- Kept the Phase 1 hard signal gate and strict structured output.
- Removed the direct "Open Quotex" action from result cards; this remains an educational analysis interface.

## Deliberately deferred
- Server-side API-key proxy / account authentication (Phase 5).
- Screenshot quality preflight before sending to the model (Phase 3).
- Multi-factor / multi-timeframe confirmations (Phase 3).
- Outcome labeling, backtesting, calibration, performance analytics (Phase 4).
