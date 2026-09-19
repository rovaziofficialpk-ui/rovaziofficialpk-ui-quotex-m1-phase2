# Phase 3.1 — Live Browser Tab Capture

## Added
- Browser-native live tab/window sharing using `getDisplayMedia`.
- Explicit **Add Live Tab** flow; the browser remains responsible for the permission/surface picker.
- Initial frame preview immediately after a tab is shared.
- **Fresh frame on every Analyze click** when a live tab is connected.
- Fresh live frames pass through the existing local Phase 3 image preflight before any Groq request.
- Refresh Preview, Change Tab, and Stop Sharing controls.
- Live-share status in the header and primary chart panel.
- Graceful handling when the user stops browser sharing, cancels the picker, or the shared surface becomes unavailable.
- Uploaded/pasted screenshots remain supported as a fallback.

## Privacy / browser constraint
A normal website cannot silently enumerate or capture arbitrary browser tabs. The user must explicitly choose a tab/window in the browser-provided share picker. The application only retains the in-memory MediaStream for the current page session and captures a still frame when requested.
