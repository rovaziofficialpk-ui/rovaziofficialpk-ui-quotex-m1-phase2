# Phase 3.5 — Compact Dashboard UI

## UI redesign
- Rebuilt the main analysis screen into an aligned desktop dashboard.
- Compact signal strip sits above the chart with CALL / PUT / NEUTRAL, confidence, confirmations, quality, and gate state visible at once.
- Signal evidence and secondary analysis details are collapsed by default.
- Live chart gets the majority of the viewport and uses a fixed responsive dashboard height.
- Right control rail contains live-tab status, Smart Auto Test, preflight status, confidence gate, and Analyze button.
- Smart Auto Test was condensed from a large card into a compact status + metrics panel.
- Live-tab controls were reduced to one aligned row.
- Screenshot preflight is now a compact summary with optional expanded metrics.
- M5 / H1 context and history are collapsed by default.
- Removed instructional cards from the active dashboard.
- Header and API status bar use less vertical space.

## Behavior
- Analysis logic, Phase 3 gates, live capture, Smart Auto Test, history persistence, and API behavior are unchanged.
