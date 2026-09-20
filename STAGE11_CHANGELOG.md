# Stage 11 — Outcome Resolver

- Verified the Quotex fixed-time settlement rule from official Rules of Trading operations and FAQ.
- Added screen-derived current-price reader using current-price-tag OCR cross-checked against the price-axis linear fit.
- Added strict 60-second expiry reader from the trade panel.
- Records payout and breakeven at decision time.
- Captures a fresh expiry frame after 60 seconds.
- Computes CALL/PUT/TIE only when all required readings are present.
- Null readings stay null and are included in null/excluded-rate reporting.
- Added manual Quotex demo outcome labels for 30-trade agreement validation.
- Added append-only durable outcome event log.
- Added disagreement/null analysis CLI.
- Historical next-candle-close outcomes are explicitly labeled as a research proxy.
- No automated trade placement was added.
- AUDIT LOCK remains ON.
