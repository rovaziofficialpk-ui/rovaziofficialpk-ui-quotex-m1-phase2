# Phase 4A.6 — Stage 3C

- AUDIT LOCK remains ON; final output remains NEUTRAL.
- Added deterministic candlestick chart-type verification from a real frozen template.
- Added CHARTTYPE_UNVERIFIED / CHARTTYPE_MISMATCH fail-closed reasons.
- Kept timeframe as badge AND time-axis/candle-pitch; disagreement is logged.
- Added strict price-axis monotonicity, linear R² and spacing checks.
- Current-price-tag-overlapped OCR labels are rejected, never reconstructed.
- Added platform UTC clock parsing, server-UTC stale check, frozen-clock check and seconds-into-candle logging.
- Added payout OCR from the asset card plus breakeven calculation.
- Added per-field OCR-confidence logging.
- Added session-split validation manifest; acceptance set remains empty.
- Production coverage lock remains closed pending independent sessions/assets/layouts and real non-M1 frames.
- Protected server routes and server-side Groq proxy remain in place.
