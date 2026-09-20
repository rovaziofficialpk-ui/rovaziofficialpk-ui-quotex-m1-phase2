# Quotex M1 Chart Signal AI — Phase 3.3

A React + TypeScript + Vite educational chart-analysis prototype using Groq's Qwen vision model.

## Phase 3.3 highlights
- Continuous real-time live preview from the selected shared browser tab
- Removed manual Refresh Preview requirement; the shared video feed updates automatically
- Analyze and Auto Test still capture separate fresh still frames for preflight/AI, independent of the visual preview
- Live browser-tab sharing through the browser permission picker
- Smart Auto Test button for adaptive live monitoring
- 5-second recommended local frame sampling with configurable 3/5/10/15/30 second interval
- Hybrid luminance + changed-pixel + edge-difference detector to skip near-duplicate chart frames
- 15-second AI cooldown to reduce duplicate Groq requests
- Automatic local preflight before each qualifying AI test
- Signal-stability streak tracking for repeated non-neutral gated results
- Circuit breaker after 3 consecutive capture/API failures
- Fresh live-tab screenshot captured automatically on every Analyze click
- Live preview refresh, change-tab, and stop-sharing controls
- Browser-side screenshot preflight before the API call
- Strict structured AI output
- Hard confidence, timeframe, chart-quality, confirmation, and context-conflict gates
- Four independent evidence checks: trend, momentum, structure, candle signal
- Optional M5 and H1 context screenshots
- Persistent settings and up to 100 local history entries
- JSON/CSV history export with evidence fields
- Railway/Vercel-ready static build

## Run locally
```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## Privacy / API key
This version is BYOK. The Groq API key is stored in the current browser's localStorage and is not embedded in the build. Phase 5 is reserved for a server-side proxy/authentication design.

## Live tab and Auto Test privacy
A normal website cannot silently enumerate or capture arbitrary browser tabs. You must explicitly select a tab/window in the browser share picker. The selected stream remains in memory only for the current page session. In Auto Test mode, still frames are sampled locally at your chosen interval; near-duplicates are skipped and only qualifying frames proceed to AI analysis.

## Important
The displayed confidence is AI setup confidence based on visible chart evidence. The Phase 3 confirmation score measures internal agreement among four AI-described evidence categories. Neither is a measured probability of profit. This tool is for educational analysis only and does not execute trades.
