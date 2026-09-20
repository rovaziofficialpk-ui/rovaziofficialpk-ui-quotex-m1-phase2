# Phase 4A.6.1 — Stage 3C Audit Correction

- Corrected the `platformClock` crop metadata to the observed lower-left UTC/time area.
- Explicitly records that saved calibration evidence does not contain a verified `HH:MM:SS UTC` live platform clock.
- Keeps `CLOCK_UNREADABLE` fail-closed until a real live clock is present.
- Keeps the expiry timer excluded from both timeframe and platform-clock verification.
- Added a versioned session-manifest schema and validation-summary CLI.
- Validator refuses calibration/acceptance session overlap and never auto-unlocks production.
- `LAYOUT_VALIDATION_INCOMPLETE` and AUDIT LOCK remain ON.
