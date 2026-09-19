# Quotex M1 Chart Signal AI — Phase 3

A React + TypeScript + Vite educational chart-analysis prototype using Groq's Qwen vision model.

## Phase 3 highlights
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

## Important
The displayed confidence is AI setup confidence based on visible chart evidence. The Phase 3 confirmation score measures internal agreement among four AI-described evidence categories. Neither is a measured probability of profit. This tool is for educational analysis only and does not execute trades.
