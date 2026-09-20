# Phase 4A — Forex Backtest Lab

## Added
- Compact-dashboard button that opens a full-screen historical backtest lab.
- M1 OHLC CSV parser supporting common timestamp/date/time + OHLC headers.
- M1 interval verification when timestamps are available.
- Common currency-pair selector plus custom pair entry.
- Separate FOREX and OTC modes; results are never mixed.
- 60-candle historical replay renderer with pair and M1 labels.
- Sample selection spread across the entire dataset.
- Exact existing Groq vision analysis and Phase 3 signal gates reused for every replay.
- Next-candle outcome labeling for 1-minute expiry.
- Observed win rate, coverage, NEUTRAL rate, wins/losses/ties.
- 3/4 and 4/4 confirmation performance.
- Confidence-bucket performance.
- Stop control and JSON/CSV exports.
- API pacing between replay requests.
- Railway build now performs TypeScript typecheck before Vite production build.

## Scope
The backtester does not claim that third-party normal FX data exactly matches Quotex pricing. OTC mode is intended only for actual OTC OHLC data. Historical observed win rate remains separate from AI setup confidence.
