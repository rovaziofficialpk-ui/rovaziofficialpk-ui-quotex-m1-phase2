# Phase 3.2 — Smart Auto Test

## Added
- Prominent **START AUTO TEST / STOP AUTO TEST** control for an already-shared live browser tab.
- Adaptive local frame sampling with 5 seconds recommended and selectable 3/5/10/15/30 second intervals.
- A lightweight hybrid change detector that combines:
  - mean luminance difference,
  - changed-pixel ratio, and
  - edge-map difference.
- A fixed 2.5 change gate so small countdown/text changes are usually skipped while meaningful chart movement can accumulate.
- 15-second AI cooldown to limit repeated Groq calls.
- Every qualifying auto frame still passes Phase 3 local screenshot preflight before any AI request.
- Existing timeframe, confidence, confirmation, opposing-evidence, and higher-timeframe conflict gates remain unchanged.
- Signal-stability tracking for repeated gated CALL/PUT results.
- Auto Test metrics: frame checks, AI tests, skipped frames, last change score, signal stability, and errors.
- Circuit breaker: Auto Test stops after 3 consecutive capture/API failures.
- Auto interval is persisted in local settings.

## Safety / scope
- Auto Test is monitoring and educational analysis only.
- It does not click Quotex, place trades, set stake size, or automate execution.
- AI setup confidence and signal stability are not measured probabilities of profit.
