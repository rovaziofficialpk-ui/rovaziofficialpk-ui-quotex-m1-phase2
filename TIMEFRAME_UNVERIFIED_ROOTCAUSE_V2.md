# TIMEFRAME_UNVERIFIED Root-Cause Report — Stage 3D Spec v2

Date: 2026-09-20

## Safety state

- AUDIT LOCK: ON.
- LAYOUT_VALIDATION_INCOMPLETE: ON.
- Automatic unlock: disabled.
- Timeframe rule remains strict AND: explicit 1m badge AND time-axis/candle-pitch.
- The Quotex 00:01:00 expiry timer is not accepted as timeframe evidence.
- No threshold was lowered or tolerance widened.

## Step 1 — diagnosis from the failing production audit

Latest inspected failing record:
- record hash: `56e96b50491e747cacbbdac38b50fc836f6b06754ce71bfc209cc13372cd2e75`
- captured at: `2026-09-20T12:32:11.746Z`
- source frame: 2390 × 1084
- preflight: PASS, score 86
- calibrated layout: located

The old record did not contain devicePixelRatio or browser zoom metadata. Browser zoom therefore cannot be reconstructed for this frame. Standard browser APIs also do not expose a reliable browser-zoom percentage, so v2 records DPR, visualViewport.scale, and capture-pixels/CSS-pixel ratios while explicitly leaving browserZoomPercent null.

### Crop rectangles used

| Role | x | y | width | height |
|---|---:|---:|---:|---:|
| primary | 114 | 140 | 2006 | 944 |
| plotArea | 114 | 140 | 1834 | 834 |
| priceAxis | 1948 | 140 | 172 | 834 |
| timeAxis | 114 | 974 | 2006 | 110 |
| assetLabel | 143 | 58 | 390 | 104 |
| timeframeBadge | 179 | 964 | 87 | 94 |
| chartTypeToolbar | 108 | 759 | 239 | 320 |
| platformClock | 143 | 152 | 478 | 70 |
| tradePanel | 2120 | 58 | 270 | 1026 |
| payoutExpiryPanel | 2120 | 58 | 270 | 471 |

The timeframe badge audit crop was stored as:
`images/523e6910ea4117adbc01c1385f048461aa4f31913e99ebaed5897310a80ae2c0.png`

### Badge check

- template version: `quotex-1m-template-v1`
- template canonical size: 27 × 29
- frozen threshold: 0.985
- failing score: -0.0762
- margin to threshold: -1.0612

Historical calibration used 736 × 334 frames. At that size the relative badge rectangle is approximately 27 × 29 source pixels and passed 10/10 same-session calibration frames, with minimum observed correlation 0.9995.

At 2390 × 1084 the same relative rectangle becomes 87 × 94 source pixels. The pre-v2 matcher resized that entire 87 × 94 region directly to 27 × 29 before correlation. This made the matcher dependent on the capture scale and on all neighboring content inside the relative rectangle.

The frozen template itself is a lower-left chart snippet rather than an isolated text-only 1m glyph. It includes surrounding toolbar/axis pixels. This makes whole-region resizing especially scale-sensitive.

### Time-axis / candle-pitch check

The same failing frame produced high-confidence time-axis evidence:

- accepted labels: 27
- usable adjacent intervals: 26
- required intervals: 3
- median tick interval: 120 seconds
- median candle pitch: 35.5 px
- derived minutes/candle: 1.000
- accepted range: 1 ± 0.08
- axis M1 result: PASS

Representative OCR tokens run from `11:56` through `12:48`. The first accepted label center is source x=209.5, which is inside the old badge rectangle x=179..266. That confirms the relative badge region contains neighboring time-axis content at this native capture size instead of being a scale-stable isolated target.

### Sub-check that failed

- Badge: FAIL, -0.0762 < 0.985.
- Time-axis/candle-pitch: PASS, 26 usable intervals and 1.000 minutes/candle.
- Strict combined result: FAIL.
- Disagreement: TRUE.

### Root-cause decision

Supported by production evidence:
- (a) badge template / candidate scale mismatch: YES — primary cause.
- (b) layout offset at new resolution: the overall layout was located; however the badge relative region is semantically over-broad at native resolution because it includes a time-axis label. This contributes to the badge matcher failure but does not establish a global layout failure.
- (c) time-axis OCR failure: NO; OCR produced 27 usable labels and 26 intervals.
- (d) genuinely not 1m: NOT supported; independent axis/candle-pitch evidence derived exactly 1.000 min/candle.
- (e) wrong tab/asset/window state: no evidence for wrong tab. Asset OCR read EUR/CAD (OTC), but the user had not configured an expected asset, so the separate asset gate also failed closed.
- (f) popup/overlay covering badge: no evidence in the stored diagnostics.

The previous audit retained the badge crop PNG and a privacy-masked source JPEG, but not the original full native PNG. Therefore the exact old native full-frame PNG cannot be recovered after the fact. v2 now saves it for every future timeframe rejection.

## Step 2 — explainable TIMEFRAME_UNVERIFIED

Stage 3D spec v2 adds these deterministic sub-reasons:
- BADGE_NO_MATCH
- BADGE_TEMPLATE_UNAVAILABLE
- AXIS_INSUFFICIENT_INTERVALS
- AXIS_CANDLE_PITCH_UNAVAILABLE
- AXIS_PITCH_MISMATCH
- BADGE_AXIS_DISAGREE

The UI diagnostics panel shows score vs frozen threshold, fixed-scale match result, usable axis intervals, candle pitch, derived minutes/candle, capture metadata, the exact failed crop rectangle, and the failed crop thumbnail. The same sub-reasons are stored in reproducibility audit data.

## Step 3 — root-cause fix

Matcher version: `quotex-1m-matcher-v2`.

The old matcher collapsed the entire scale-dependent badge crop to 27 × 29. v2 instead:
1. removes the audit-only 3× nearest-neighbor enlargement and works in source-pixel geometry;
2. keeps the existing 27 × 29 frozen template;
3. performs normalized correlation as a sliding template search inside the located badge region;
4. uses only the pre-frozen scale factors `[0.75, 0.9, 1.0, 1.1, 1.25, 1.5]`;
5. keeps the 0.985 correlation threshold unchanged;
6. still requires the independent time-axis/candle-pitch check to pass.

This is a matching-geometry spec change, not a relaxation. Spec ID was bumped from `stage3d-spec-v1` to `stage3d-spec-v2`, and config version to `input-pipeline-v1.6.0`.

Acceptance sessions affected: 0. There were zero untouched acceptance sessions before this change.

## Step 4 — verification status

Already established from the failing production frame:
- M1 time-axis/candle-pitch sub-check: 1/1 PASS.
- old badge matcher on the same frame: 0/1 PASS.
- combined old timeframe gate: 0/1 PASS.

Fresh v2 native captures have not yet been produced after deployment, so the new badge matcher pass count must remain unverified until a browser session captures them.

Real negative-control frames for 5s, 15s, 30s, 5m, and 15m have not been supplied. Their rejection is therefore UNPROVEN. Synthetic frames are not counted as acceptance evidence.

## Other independent failures in the inspected frame

Even if timeframe verification passes under v2, the inspected production frame also had:
- ASSET_UNVERIFIED: EUR/CAD (OTC) was read, but no expected asset was configured.
- CHARTTYPE_UNVERIFIED: candlestick correlation 0.8378 < frozen 0.92.
- PRICE_AXIS_NONLINEAR: R² 0.999999, pixel-spacing CV 0.2862 > 0.25 and price-step CV 0.2828 > 0.10.
- CLOCK_STALE: parsed 12:32:10 UTC vs server UTC delta 6 seconds, frozen max staleness 5 seconds.

Those checks remain unchanged and continue to fail closed.

## Assumptions / unverified items

- The old full native PNG was not retained, so v2 cannot be replayed exactly against that full frame.
- DPR and browser zoom were not present in the old record.
- Browser zoom percentage is not reliably available from standard browser APIs; v2 does not guess it.
- No real non-M1 negative frames are available.
- No untouched v2 acceptance sessions exist yet.
