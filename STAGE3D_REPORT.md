# Phase 4A.7 — Stage 3D Validation Hygiene and Negative Controls

## Safety
AUDIT LOCK remains ON.
LAYOUT_VALIDATION_INCOMPLETE remains ON.
Nothing in Stage 3D automatically unlocks production or emits CALL/PUT.

## 1. Clock re-examination
The top-left chart area directly under the asset card was re-examined, including the area above/near the blue risk-information pill.

A time-like line is visibly present and changes across the saved frame sequence. However, deterministic OCR on the saved low-resolution evidence did not recover a valid HH:MM:SS UTC string.

Representative source: saved CAD/CHF (OTC) Quotex frame.

Regions tried on the larger embedded frame:
| Region | Pixel box | OCR PSM 7 | OCR PSM 11 | Deterministic result |
|---|---|---|---|---|
| A_under_asset_wide | 80,80,330,130 | empty | TT | CLOCK_UNREADABLE |
| B_clock_line_tight | 95,92,260,120 | empty | empty | CLOCK_UNREADABLE |
| C_clock_plus_risk | 80,85,360,165 | empty | empty | CLOCK_UNREADABLE |
| D_previous_bottom_left | 55,565,250,645 | empty | empty | CLOCK_UNREADABLE |

The Stage 3C bottom-left candidate was therefore discarded. The production clock crop now returns to the top-left under-asset candidate region, but it still fails closed unless a live high-resolution capture produces a strict clock parse.

The expiry timer is not used as the clock. Time-axis labels are not used as the live platform clock.

## 2. Acceptance hygiene
Frozen spec id: stage3d-spec-v1.

Manifest rule:
- every acceptance session records the spec id it was evaluated against;
- any threshold/template/layout change creates a new spec id;
- acceptance sessions evaluated against an older spec are automatically classified as contaminated;
- a recorded spec-change event may explicitly invalidate acceptance session ids;
- contaminated sessions are not counted toward acceptance and must be replaced by new untouched sessions.

No acceptance sessions existed before this Stage 3D change, so the current contaminated-acceptance count is zero.

## 3. Negative controls
Repository/conversation evidence was searched for real Quotex:
- line chart
- bar chart
- Heikin Ashi
- 5s
- 15s
- 30s
- 5m
- 15m

No suitable real labeled frames were found for those controls.

Therefore:
- line template: NOT BUILT / NOT SUPPLIED
- bar template: NOT BUILT / NOT SUPPLIED
- Heikin Ashi template: NOT BUILT / NOT SUPPLIED
- 5s badge rejection: NOT RUN
- 5s time-axis rejection: NOT RUN
- 15s badge rejection: NOT RUN
- 15s time-axis rejection: NOT RUN
- 30s badge rejection: NOT RUN
- 30s time-axis rejection: NOT RUN
- 5m badge rejection: NOT RUN
- 5m time-axis rejection: NOT RUN
- 15m badge rejection: NOT RUN
- 15m time-axis rejection: NOT RUN

Synthetic tests do not satisfy these real-negative-control requirements.

## 4. Per-condition reporting
The Stage 3D validator now groups untouched acceptance results by:
asset × timeframe × chart type × window/zoom state.

Each row reports:
- frame count
- passed
- failed
- timeframe badge status counts
- time-axis status counts
- chart-type status counts
- asset status counts
- price-axis status counts
- clock status counts
- payout status counts

Every failed frame is emitted with session id, frame id, condition, expected gate, actual gate, and failure reasons.

Current untouched acceptance set: EMPTY.
Current calibration condition: CAD/CHF (OTC) | M1 | candlestick | observed-desktop-calibration.

## 5. Lock state
The validation CLI can only recommend ELIGIBLE_FOR_MANUAL_REVIEW_ONLY_DO_NOT_AUTO_UNLOCK.
It cannot modify the production coverage constant.

Current result: KEEP_LAYOUT_VALIDATION_INCOMPLETE.
