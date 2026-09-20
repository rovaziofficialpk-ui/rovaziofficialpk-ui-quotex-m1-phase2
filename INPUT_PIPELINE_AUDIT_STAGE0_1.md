# Phase 4A.3 Input Pipeline Audit — Stage 0/1

## Pipeline map
getDisplayMedia -> captureLiveTabFrame -> full captured frame scaled to max 2048px -> imagePreflight -> Groq vision -> signal gates -> precision research filter -> AUDIT LOCK -> IndexedDB + durable audit log.

## Suspected-problem status
- P1 REFUTED for current live code: tabCapture.ts draws the entire captured video frame; no left-side primary crop exists.
- P2 PARTLY CONFIRMED: there is no automatic zoom crop. Optional M5/H1 context images are separate uploads and therefore not guaranteed to share the primary timestamp.
- P3 CONFIRMED: imagePreflight.ts scores pixel properties (resolution, contrast, edge density, brightness, aspect ratio), not chart completeness.
- P4 CONFIRMED: timeframe verification is delegated to the model response.
- P5 CONFIRMED: entry price, expiry and payout are explicitly logged null in Phase 4A.2; no structured screen reader exists yet.
- P6 CONFIRMED in substance / 30-second detail REFUTED: Auto Test is free-running (default 5s, 15s AI cooldown; selectable 3/5/10/15/30), not candle-boundary scheduled.
- P7 CONFIRMED: full shared frame is sent to the model, so platform sidebars/banners/overlays are not deterministically excluded.
- P8 UNVERIFIED: no repeated identical-frame experiment exists. Phase 4A.3 fixes temperature=0 and seed=424242 and records system_fingerprint when returned.
- P9 CONFIRMED: Groq is currently called from the browser and the key is stored in localStorage; old audit data is browser-only IndexedDB. Stage 1 fixes durable audit storage, but Groq proxy migration belongs to Stage 8 and has not been activated because this audit stops at Stage 2 until layout is verified.
- P10 UNVERIFIED as the specific claim "EUR/CAD OTC quotes are broker-generated." Quotex's Service Agreement says Asset Rate is unilaterally determined by the Company based on information from central banks, trading floors, liquidity providers, etc. Quotex's OTC material describes OTC as off-exchange/decentralized, but does not establish the narrower broker-generated claim.

## Stage 1 changes
- config/input-pipeline-v1.json: frozen input/AI settings; layout deliberately UNVERIFIED.
- src/services/groq.ts: prompt version, temperature=0, fixed seed, raw API response body, system fingerprint, AI/gate timing.
- src/services/tabCapture.ts: detailed capture timestamp, capture duration, source/output frame dimensions.
- src/services/auditArtifacts.ts: exact data-URL byte hashing with SHA-256 and image metadata.
- src/services/reproAudit.ts: append-only local decision records plus durable server ingestion.
- server.mjs: static app server + append-only /data/audit storage; content-addressed image files and chained record hashes.
- scripts/replay-audit.mjs: replay command for stored decisions.
- tests/input-pipeline.test.mjs: hash stability, audit-lock replay, and explicit unverified-layout tests.

## Stage 1 acceptance
- Exact AI images stored: implemented for new decisions.
- SHA-256 stored: implemented.
- Raw model response: implemented.
- Prompt/config/model/settings: implemented.
- Timing breakdown: implemented where measured; unknown values remain null.
- Durable storage: implemented; requires Railway volume at /data.
- Replay 5 real stored decisions: NOT RUN — no Phase 4A.3 decisions exist yet. The command is implemented and build tests cover replay mechanics.
