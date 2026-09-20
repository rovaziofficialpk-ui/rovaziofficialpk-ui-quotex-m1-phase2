# Phase 4A.4 — Deterministic Single-Frame Screen Gate

- Calibrated Quotex desktop layout from 10 real frames from the saved user recording.
- Added versioned relative crop profile.
- All decision crops derive from one exact frame.
- Added primary, plot, same-frame recent zoom, price axis, time axis, asset label, trade panel and payout/expiry crops.
- Added deterministic layout, candle-count, current-price marker and letterbox checks.
- Added fail-closed reason codes.
- Independent M5/H1 uploads are disabled for decision input.
- The AI call is blocked unless all deterministic screen checks pass.
- Observed layout has no explicit timeframe label, so current production decisions fail TIMEFRAME_UNVERIFIED before Groq.
- No trade outcomes were used for calibration.
- AUDIT LOCK remains ON.
