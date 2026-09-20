# Phase 4A.6 — Stage 3C Additional Checks

## Safety state
AUDIT LOCK remains ON. LAYOUT_VALIDATION_INCOMPLETE remains ON. No change in this stage can emit CALL/PUT to the user.

## 1. Chart type
A candlestick chart-type control is visibly present in the saved real Quotex session below the timeframe control.

A real candlestick-icon template was frozen before outcome analysis. Matching against ten same-session frames:
- 10/10 pass
- minimum score: 0.9537576
- mean score: 0.9538471
- frozen threshold: 0.92

Production behavior:
- candlestick template >= threshold -> chart type verified
- a future real line/bar/Heikin-Ashi template match -> CHARTTYPE_MISMATCH
- no reliable template match -> CHARTTYPE_UNVERIFIED

No real line, bar, or Heikin-Ashi frames are available, so those real mismatch tests are NOT RUN.

## 2. Timeframe AND logic
The explicit 1m badge and time-axis/candle-pitch method remain independent and are ANDed.
A disagreement boolean is persisted on every decision.

Requested real non-M1 frames (5s, 15s, 30s, 5m, 15m): NOT SUPPLIED / NOT RUN.
Synthetic mismatch tests remain tests only and are not reported as real validation.

## 3. Price axis linearity
The production parser:
- requires >=5 accepted strict decimal labels
- rejects low-confidence OCR
- detects the blue current-price tag band and rejects overlapping OCR tokens as OCCLUDED_BY_CURRENT_PRICE_TAG
- does not reconstruct missing labels
- requires values to decrease monotonically with increasing screen Y
- requires linear R2 >= 0.995
- pixel-spacing CV <= 0.25
- price-step CV <= 0.10

Real high-resolution calibration frame:
- accepted labels: 10
- range: 0.60400 to 0.59950
- R2: 0.999997897
- pixel-spacing CV: 0.0054543
- price-step CV: effectively 0

## 4. Platform UTC clock
A dedicated platform-clock crop and OCR mode were added.
Accepted forms:
- HH:MM:SS with UTC token
- HHMMSS only when the same dedicated crop also contains a high-confidence UTC token

The live checker compares platform UTC to authenticated server UTC.
Frozen settings:
- stale if absolute circular UTC difference > 5 seconds
- frozen if the exact same parsed clock persists across observations >1500 ms apart

secondsIntoCandle = parsed UTC second modulo 60.

Saved historical frames cannot be used for a live staleness acceptance check against today's server time. That check remains for post-deployment live decisions.

## 5. Payout
The payout is read from the same asset-label card rather than from freeform AI output.
Real calibration frame:
- asset: CAD/CHF (OTC)
- payout: 93%
- payout OCR confidence: 96.84
- payout decimal: 0.93
- breakeven: 1/(1+0.93) = 0.5181347

Unreadable or ambiguous payout -> null + PAYOUT_UNREADABLE. No plausible payout is filled in.

## 6. Legibility
Same-session real evidence shows a clear capture-size effect:
- larger asset crop: 3 valid tokens, mean confidence 95.41; low-resolution crop: 0 valid tokens
- larger time-axis crop: 14 valid labels, mean confidence 94.74; low-resolution crop: 0 valid labels
- larger price-axis crop: 10 valid labels, mean confidence about 96.6; low-resolution crop: 0 valid labels

Per-field OCR confidence is now stored in the decision record.
Browser zoom improvement: NOT RUN because no paired real zoom recordings were supplied.

## 7. Session-split validation set
Split unit is SESSION, not frame.
Calibration currently contains one saved session only.
Untouched acceptance set: EMPTY.

Required acceptance evidence is still missing:
- >=3 sessions total
- >=2 assets
- requested 3-real-asset OCR test
- >=2 window sizes/zoom states
- real 5s/15s/30s/5m/15m frames

No calibration-session frame will be reclassified as untouched acceptance data.

## 8. Acceptance lock
LAYOUT_VALIDATION_INCOMPLETE stays true.
Five real post-deployment live decisions and 5/5 replay acceptance are NOT RUN because the acceptance set has not passed.

## Security
Protected audit/replay/OCR/time/Groq/settings routes remain authenticated.
Groq remains server-proxied in code.
AUDIT_AUTH_TOKEN is configured in production.
GROQ_API_KEY is still absent from the Railway environment, so model calls cannot run even after deterministic acceptance until the server key is explicitly configured.

## Stages 4–9
Not continued. Stage 3C acceptance is incomplete.
