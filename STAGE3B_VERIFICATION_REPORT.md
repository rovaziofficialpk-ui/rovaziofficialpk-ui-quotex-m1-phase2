# Phase 4A.5 — Stage 3B Verification Report

## Result
Stage 3B implementation progressed, but the production verification coverage requirement is not satisfied. The AI call therefore remains fail-closed behind LAYOUT_VALIDATION_INCOMPLETE and the final AUDIT LOCK remains NEUTRAL-only.

## 3B(a) UI exploration
A real saved Quotex screenshot exposes an explicit **1m** chart-timeframe badge in the lower-left chart toolbar. The trade panel separately shows **00:01:00**; that value is treated only as expiry/timer and is never accepted as chart-timeframe evidence.

The same real frame visibly contains the primary asset label **CAD/CHF (OTC)**, price-axis labels, and bottom time-axis labels.

## 3B(b) Time-axis method
On the available high-resolution real frame:
- OCR accepted 14 clean time labels from 16:14 through 16:44 (with one merged OCR region omitted rather than guessed).
- Accepted OCR token confidence was approximately 93.6–96.1%.
- Median candle pitch from deterministic red/green candle columns was 45.5 px.
- 13 adjacent valid tick intervals were usable.
- Derived median minutes/candle = 1.000.
- Observed per-interval range = 0.9891–1.000.
- Frozen production tolerance = 1.00 ± 0.08 minutes/candle.
- HH:MM and HH:MM:SS are supported.
- Midnight rollover is handled explicitly.

A real non-M1 Quotex frame is not available, so real-frame TIMEFRAME_MISMATCH acceptance is **not run**. Synthetic geometry tests prove the algorithm rejects an M5-style geometry, but that is not substituted for the requested real-frame test.

## Explicit 1m template
A fixed template was extracted from a real saved frame before outcome analysis. On the 10 available same-session calibration frames:
- pass: 10/10
- minimum normalized correlation: 0.9995
- frozen threshold: 0.985

This does not establish cross-session/window robustness. The production coverage lock remains closed.

## 3B(c) Asset verification
Server-side OCR with strict parsing is implemented. On the available high-resolution real primary asset:
- raw accepted tokens: CAD/CHF and (OTC)
- token confidences: 91.10 and 96.51
- normalized result: CAD/CHF (OTC)

The app now requires a configured asset and exact normalized equality. Unreadable -> ASSET_UNVERIFIED. Different -> ASSET_MISMATCH.

Requested real-frame testing on at least 3 assets is **not complete** because only one real primary-asset frame is available. Parser unit tests cover CAD/CHF, EUR/CAD and AUD/CHF strings, but these are not claimed as real-frame validation.

## 3B(d) Axis parsing
Price-axis OCR on the available high-resolution real frame accepted labels including 0.60400, 0.60350, 0.60300, 0.60250, 0.60200, 0.60150, 0.60100, 0.60050, 0.60000 and 0.59950. One bad OCR token was excluded rather than corrected. Price-axis parsing requires at least four strict decimal labels.

Time-axis parsing uses token positions, confidence and strict clock formats. Malformed tokens are excluded rather than repaired.

## 3B(e) fallback
Manual timeframe attestation was **not activated**, because an explicit 1m indicator was found and the numeric time-axis method works on the available high-resolution evidence. No expiry/timer is used as timeframe evidence.

## 3B(f) unseen layout validation
Required: >=3 sessions, >=2 assets, >=2 window/zoom states plus held-out calibration frames.
Available: one session, one primary asset, one observed viewport family.
Result: **NOT COMPLETE**. Production remains blocked with LAYOUT_VALIDATION_INCOMPLETE.

## 3B(g) security/durability
Implemented in code:
- protected audit/replay/OCR/Groq/settings endpoints using X-Audit-Token
- client Groq Authorization header removed
- Groq calls proxy through /api/groq/*
- server key comes only from GROQ_API_KEY environment variable
- legacy browser Groq key is cleared on app startup
- setting changes are appended to a hash-chained server log
- raw source screenshot bytes are no longer persisted; original SHA-256 is retained
- a privacy-masked source frame is persisted
- exact derived decision crops are retained for reproducibility

The deployment must have AUDIT_AUTH_TOKEN configured. GROQ_API_KEY must be supplied server-side before any future model call can run.

### Auto Test timing clarification
The selector controls **how often the watcher checks/captures for a changed frame** (3/5/10/15/30 seconds). The old default was 5 seconds. Separately, AUTO_AI_COOLDOWN_MS=15,000 prevented model calls more often than every 15 seconds. It was not candle-boundary timing. Stage 5 candle-boundary scheduling has not been activated because Stage 3B coverage acceptance is still incomplete.

## 3B(h) replay acceptance
Five real post-deployment decisions cannot be run from this environment without the user's live shared Quotex tab. The replay endpoint is authenticated and implemented, but 5/5 real acceptance remains pending.

## Stages 4–9
Not continued because the Stage 3B production coverage gate has not passed. This is intentional under the work-order stop conditions.
