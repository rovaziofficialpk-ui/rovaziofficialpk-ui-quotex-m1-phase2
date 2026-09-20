# Phase 4A.2 — Quant Audit Lock

## Why
The previous Phase 4A.1 holdout framework was useful for research but did not satisfy payout-aware proof requirements. It had no real per-trade payout, no purge/embargo, no latency-aware entry, and no sealed one-time final holdout.

## Runtime changes
- Final emitted CALL/PUT is forced to NEUTRAL until a clean payout-aware Quotex holdout proves a Wilson 95% lower win-rate bound above breakeven.
- Proposed directional bias is preserved internally for research and logging.
- New append-only IndexedDB audit signal store.
- Audit records include factor readings, AI confidence, opposing evidence, chart quality, proposed/final bias, neutral reason, source, and capture-to-decision latency when live-tab capture is used.
- Unknown numeric entry price, expiry, payout, and outcome remain null/UNKNOWN instead of being guessed.
- Old Phase 4A.1 precision profiles are not loadable as live-validated profiles because they lack payout validation.
- Phase 4A.1 optimizer remains a development/research tool only.

## Validation rule
No live precision profile is considered proven until real payout, exact feed data, realistic entry/latency, a sealed holdout, and Wilson-lower-bound-above-breakeven criteria are satisfied.
