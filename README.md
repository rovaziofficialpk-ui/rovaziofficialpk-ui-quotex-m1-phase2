# Quotex M1 Chart Signal AI — Phase 2

A React + TypeScript + Vite educational chart-analysis prototype using Groq's Qwen vision model.

## Phase 2 highlights
- Strict structured AI output
- Hard confidence, timeframe, and image-quality gates
- Componentized frontend architecture
- Persistent settings and up to 100 local history entries
- JSON/CSV history export
- Better network/API error handling and request timeout
- Vercel-ready configuration

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
The displayed confidence is AI setup confidence based on visible chart evidence. It is not a measured probability of profit. This tool is for educational analysis only and does not execute trades.
