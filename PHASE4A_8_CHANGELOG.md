# Phase 4A.8 — Sharp Native Capture

## Input-quality fix
- Removed the 2048px live-capture downscale.
- Live capture canvas now preserves the stream's native videoWidth/videoHeight.
- Changed live decision-frame encoding from JPEG quality 0.94 to lossless PNG.
- Requests an ideal 2560x1440 shared stream from Chromium where available.
- No upscaling is performed when the browser/source itself is lower resolution; missing detail is never invented.

## UI
- Expanded the dashboard maximum width from 6xl to 1480px.
- Reduced the desktop side rail from 320px to 300px.
- Increased chart/live preview from 56vh (340–620px) to 64vh (440–760px).

## Safety
- No signal threshold, payout rule, chart-type gate, timeframe rule, acceptance rule, or AUDIT LOCK behavior was loosened.
- LAYOUT_VALIDATION_INCOMPLETE remains enforced.
