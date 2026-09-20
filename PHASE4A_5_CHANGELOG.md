# Phase 4A.5 — Stage 3B verifier

- Found and calibrated the explicit Quotex 1m chart badge from real saved UI evidence.
- Added 1m template matching plus independent time-axis/candle-pitch cross-check.
- Added strict server-side Tesseract OCR for asset, time axis and price axis.
- Added configured-asset exact-match gate.
- Added price-axis min/max and time-axis span parsing.
- Added authenticated API routes using AUDIT_AUTH_TOKEN.
- Moved Groq transport behind the server; browser Authorization to Groq is removed.
- Legacy browser Groq key is cleared on startup.
- Added hash-chained settings-change logging.
- Raw source bytes are no longer persisted; a masked source image plus original SHA-256 is stored.
- Exact AI crop remains persistable for replay when the gate is eventually allowed through.
- Production coverage lock remains closed because required unseen multi-session, multi-asset, multi-window and real non-M1 evidence is incomplete.
- AUDIT LOCK remains ON; user-visible CALL/PUT is impossible.
