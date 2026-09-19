# Phase 3 — Input Intelligence & Evidence Confirmation

## Completed
- Added local browser-side screenshot preflight before any Groq request.
- Preflight scores resolution, contrast, visual detail/edge density, exposure, and crop/aspect ratio.
- Obviously unusable screenshots are blocked before an API call; borderline screenshots are flagged for review.
- Added optional M5 and H1 context screenshots (up to two additional images).
- Expanded strict structured output with independent trend, momentum, structure, and candle evidence.
- Added app-side confirmation scoring: directional CALL/PUT requires at least 3 of 4 evidence checks aligned.
- Added opposing-evidence gate: more than one opposing confirmation forces NEUTRAL.
- Added higher-timeframe conflict gate when optional M5/H1 context conflicts with the M1 proposal.
- Added visible evidence list, support/resistance summary, context alignment, input quality score, and confirmation score to the result UI.
- Extended JSON/CSV history exports with Phase 3 evidence fields.
- Kept Phase 1/2 gates: M1 verification, chart-quality block, confidence threshold, strict structured output, persistence, and export.

## Notes
- Local preflight is a heuristic quality filter; it does not identify market direction.
- All directional interpretation still comes from visible chart evidence and remains educational analysis, not a measured probability of profit.
