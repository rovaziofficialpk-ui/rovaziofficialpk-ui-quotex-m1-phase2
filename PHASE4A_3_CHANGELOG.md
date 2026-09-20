# Phase 4A.3 — Reproducible Input Records

- AUDIT LOCK remains unchanged and final output remains NEUTRAL.
- Fixed Groq generation settings for reproducibility: temperature 0, seed 424242.
- Added prompt version and Groq system_fingerprint logging.
- Preserves the unmodified Groq HTTP response body.
- Logs exact AI image bytes by SHA-256.
- Records capture timestamp, source/output frame dimensions, full-frame crop rectangle, and source-frame hash.
- Splits timing into capture, preflight, AI call, gates, and capture-to-decision.
- Adds append-only IndexedDB reproducibility store.
- Adds durable server-side content-addressed image storage + NDJSON hash-chained records.
- Adds replay CLI.
- Layout profile remains intentionally UNVERIFIED; no guessed crop coordinates are active.
