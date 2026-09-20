# Phase 4A.7 — Stage 3D

- Re-examined top-left clock candidates under the asset card.
- Moved production clock crop back to the top-left under-asset candidate region.
- Saved low-resolution evidence remains CLOCK_UNREADABLE because strict OCR did not recover HH:MM:SS UTC.
- Added spec-id acceptance hygiene: old-spec acceptance sessions become contaminated/calibration-only.
- Added separate real negative-control requirements for line, bars, Heikin Ashi and 5s/15s/30s/5m/15m.
- Added per-condition acceptance table generation and full failed-frame listing.
- No real negative-control templates were fabricated because matching user frames are not present.
- AUDIT LOCK and LAYOUT_VALIDATION_INCOMPLETE remain ON.
