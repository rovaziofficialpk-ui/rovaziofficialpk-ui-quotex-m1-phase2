# Phase 4A.4 Input Pipeline Audit — Stages 0–3

## Stop condition
STOPPED at Stage 3.

The recovered Quotex layout can be located consistently, but the captured platform UI does not show an explicit chart-timeframe label. The visible 00:01:00 control is the trade expiry/timer and is not accepted as evidence that the chart timeframe is M1. A deterministic asset reader is also not calibrated, and no configured asset has been frozen.

Production therefore fails closed before the Groq vision call:
- TIMEFRAME_UNVERIFIED
- ASSET_UNVERIFIED
- PRICE_AXIS_UNREADABLE
- TIME_AXIS_UNREADABLE

No rule was loosened and no trade outcomes were used.

## Stage 0 — pipeline map
getDisplayMedia -> exact source frame capture -> calibrated single-frame layout/crops -> deterministic screen gate -> pixel preflight on verified primary crop -> Groq (only if deterministic checks pass) -> Phase 3 gates -> research precision filter -> AUDIT LOCK -> append-only local + durable audit log.

Current deterministic failures prevent the Groq decision call on the observed live layout.

## P1–P10
- P1 REFUTED in old code: live capture drew the full captured frame; no left-only primary crop existed. Phase 4A.4 now adds an explicit calibrated primary crop that includes the right price axis, current-price marker area, time axis, and chart history.
- P2 PARTLY CONFIRMED in old code: independently uploaded M5/H1 images did not share the source timestamp. They are disabled for decisions in single-frame audit mode. Primary, zoomedNewest, priceAxis, timeAxis, assetLabel and payoutExpiryPanel are derived from the same source bytes.
- P3 CONFIRMED: old preflight measured pixel quality, not completeness. Phase 4A.4 adds deterministic completeness/layout metrics before pixel preflight.
- P4 CONFIRMED: old timeframe gate trusted the model. Phase 4A.4 refuses to call the model because deterministic M1 verification is unavailable on the observed layout.
- P5 CONFIRMED: entry, payout and expiry were logged null. Stage 4 was not reached because of the Stage 3 stop.
- P6 CONFIRMED in substance, 30s specifically REFUTED: Auto Test was free-running (default 5s; 15s model cooldown). Stage 5 was not reached.
- P7 CONFIRMED: old full-frame model input included platform panels/overlays. Phase 4A.4 defines an isolated primary chart crop; model use remains blocked until deterministic verification is complete.
- P8 UNVERIFIED: repeatability experiment was not reached. Stage 1 froze temperature=0, seed=424242 and records system_fingerprint.
- P9 CONFIRMED: browser localStorage still holds the user-provided Groq key and the decision call is client-side. Durable audit storage is now server-side, but the key migration is Stage 8 and was not reached.
- P10 UNVERIFIED for the exact statement that EUR/CAD OTC quotes are broker-generated. Official Quotex material confirms company-determined Asset Rate using external information sources and describes OTC as off-exchange, but not the narrower wording.

## Stage 1 — reproducible records
Implemented:
- exact source frame and every derived crop persisted as bytes
- SHA-256 per artifact
- source-frame SHA link on every crop
- capture timestamp
- source/crop dimensions and pixel crop rectangles
- prompt/config/model/temperature/seed/system fingerprint
- raw Groq HTTP response text when a model call occurs
- capture/preflight/deterministic-screen/model/gate timing
- append-only IndexedDB copy
- durable content-addressed /data/audit/images storage
- hash-chained /data/audit/records.ndjson
- replay CLI

Replay acceptance on five real Phase 4A.3/4A.4 decisions: NOT RUN because five post-deployment decisions have not yet been collected.

## Stage 2 — single-frame layout
Calibration source: 10 different frames from the user's saved screen recording, stable non-zoomed segment.
Observed viewport: 736x334, aspect 2.2036.

Calibrated relative regions:
- primary: x .04755, y .12874, w .83967, h .87126
- plotArea: x .04755, y .12874, w .76766, h .76946
- zoomedNewest: x .38, y .12874, w .43522, h .76946
- priceAxis: x .81522, y .12874, w .07201, h .76946
- timeAxis: x .04755, y .89820, w .83967, h .10180
- assetLabel: x .05978, y .05389, w .16304, h .09581
- tradePanel: x .88723, y .05389, w .11277, h .94611
- payoutExpiryPanel: x .88723, y .05389, w .11277, h .43413
- timeframeLabel: NOT FOUND in the observed layout

The primary crop deliberately excludes the left platform toolbar, top promotion/header region and right trade panel while retaining the plot, right-side price axis/current-price marker area and bottom time axis.

Small field crops use fixed 3x nearest-neighbor upscaling. Primary/zoom crops use fixed JPEG quality .95 and high-quality bilinear rendering.

Ten annotated debug frames were generated separately.

## Stage 3 — deterministic checks
Calibration measurements across 10 real frames:
- aspect ratio: 2.2036 on all 10
- detected colored candle groups: 16–18 by connected-component calibration; the production column-group rule is bounded to 12–80
- plot red+green candle-color fraction: approximately .055
- right trade-panel green fraction: approximately .049
- right trade-panel red fraction: approximately .047
- current-price blue-label fraction in price-axis crop: approximately .012
- horizontal marker row fraction: approximately .26–.47
- outer near-black edge fraction: approximately .015

Implemented fail-closed reason codes:
LAYOUT_NOT_FOUND, LETTERBOX_DETECTED, PLOT_AREA_TOO_SMALL, CANDLE_COUNT_OUT_OF_RANGE, NEWEST_CANDLE_NOT_VISIBLE, CURRENT_PRICE_MARKER_MISSING, PRICE_AXIS_UNREADABLE, TIME_AXIS_UNREADABLE, TIMEFRAME_UNVERIFIED, TIMEFRAME_MISMATCH, ASSET_UNVERIFIED, ASSET_MISMATCH.

Synthetic broken-input tests cover missing newest/right edge, wrong/unreadable timeframe, wrong/unconfigured asset, cut-off price/time axes, letterboxing and unrecognized layout.

### Real-frame result
Layout/candle/current-price structural checks are compatible with all ten calibration frames.
Timeframe verification: FAIL — no explicit timeframe label is visible.
Asset verification: FAIL — deterministic reader not calibrated and configured asset is not frozen.
Price/time numeric parsing: FAIL — deterministic OCR/template parser is not calibrated.

Therefore safeForAi=false and no Groq decision image is sent.

## Acceptance/status
- annotated 10 real frames: PASS
- one-frame crop provenance: IMPLEMENTED
- complete primary/right-edge crop: IMPLEMENTED
- deterministic layout/candle/current-marker checks: IMPLEMENTED
- deterministic timeframe verification: FAILED / STOP CONDITION
- deterministic asset verification: FAILED / STOP CONDITION
- 5 real-record replay: NOT RUN, insufficient post-deployment records
- preflight-vs-AI disagreement rate: UNKNOWN; model calls are blocked and historical paired logs do not exist
- Stage 4 read-vs-manual table: NOT RUN
- Stage 5 seconds-into-candle distribution: NOT RUN
- Stage 6 overlay experiment: NOT RUN
- Stage 7 10x10 repeatability: NOT RUN
- Stage 8 Groq proxy migration/settings audit: NOT RUN due Stage 3 stop; client-side-key exposure remains
- Stage 9 live traffic numeric feed feasibility: NOT RUN due Stage 3 stop

## Audit lock
AUDIT LOCK remains ON. Phase 4A.4 adds an earlier deterministic block; it does not unlock or weaken the final NEUTRAL gate.
