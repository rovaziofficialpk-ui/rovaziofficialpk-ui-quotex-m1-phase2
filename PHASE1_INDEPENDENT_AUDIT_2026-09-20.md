# QUOTEX 1M BOT — Independent Phase 1 Audit

Date: 2026-09-20

Scope: capture -> preflight -> deterministic verification -> AI proxy -> signal gates -> audit lock -> reproducibility/audit storage -> outcome resolver.

Production baseline audited:
- main commit: `eb2ba5b2b66bf85b2fe1183ac6a78f0c99d2421b`
- package: `0.5.1-timeframe-diagnostics-v2`
- input config: `input-pipeline-v1.6.0`
- spec: `stage3d-spec-v2`
- layout: `quotex-desktop-observed-v1.3.0`
- screen pipeline: `screen-input-v1.5.0`
- structured fields: `screen-fields-v1.1.0`
- Stage 3C: `stage3c-v1.1.0`
- timeframe matcher: `quotex-1m-matcher-v2`

No production file was changed during this audit. All additions are isolated on branch `audit/phase1-e2e-20260920` / PR #1 and consist of audit tests, probes, mutation checks and CI only.

## Executive result

The normal live-analysis UI path is fail-closed and the final live signal is forced to NEUTRAL by the audit lock. However, the whole application does **not** yet satisfy the requested R1-R9 end state.

Critical blockers:
1. **R2 fails:** authenticated callers can POST arbitrary payloads directly to `/api/groq/analyze`; the server proxy does not independently verify deterministic gates or source-frame provenance before forwarding to Groq. Backtest also sends generated chart images to the model outside the deterministic live-screen gate.
2. **R1 fails globally:** Backtest Lab displays directional CALL/PUT values from `result.signal` without applying `applyAuditEdgeGate`.
3. **R4 fails:** `/api/audit/replay` is not a replay. It hard-codes `replayedFinalBias = 'NEUTRAL'` and compares that constant with the stored final bias.
4. Real negative controls are missing for non-M1 and non-candlestick chart types, so R3 is unproven.
5. Preflight-blocked frames can be returned/skipped without a durable decision record; Auto Test can clear the detailed deterministic error.
6. Payout can be `PAYOUT_UNREADABLE` without becoming a deterministic frame failure, despite the audit target treating payout as E7.
7. Client-side model validation coerces/clamps invalid confidence values rather than strictly rejecting them.

## Target results R1-R9

| Result | Status | Evidence |
|---|---|---|
| R1 no user-visible CALL/PUT with lock on | **REFUTED** | Live SignalCard path is gate-locked and forced CALL/PUT tests become NEUTRAL, but Backtest Lab displays raw directional `result.signal.bias` without audit edge gate. |
| R2 no image to model unless all deterministic checks pass | **REFUTED** | Server `/api/groq/analyze` only checks audit authentication, reads arbitrary JSON, then invokes `proxyGroq(payload)`. It does not independently verify gate evidence. Backtest also makes image model calls outside the live deterministic gate. |
| R3 valid passes + every invalid rejects, measured per condition | **UNVERIFIED** | Calibration evidence exists, but required real 5s/15s/30s/5m/15m and line/bars/Heikin-Ashi frames are not supplied. |
| R4 reproducible replay | **REFUTED** | Replay endpoint uses constant NEUTRAL instead of rerunning deterministic checks/model/gates. |
| R5 unknowns stay null + reason | **PARTIAL / REFUTED as whole** | Outcome resolver and most structured readers fail closed, but preflight blocks can disappear without a decision record and payout is not included in deterministic failure reasons. |
| R6 no secrets in bundle/logs/repo/stored files | **PARTIAL / UNVERIFIED as whole** | Key-shaped bundle scan passed; Groq key is server env; no key value was exposed in inspected logs/repo. Full stored audit-file secret scan was not possible, so whole claim remains unproven. |
| R7 all stats/formulas correct | **CONFIRMED for the explicitly requested core formulas; broader UI statistics remain PARTIAL** | Independent production-module vectors verify breakeven, Wilson 95% lower bound, decided-only win-rate denominator, tie handling, known-return mean, full-sample expectancy null policy, agreement rate, null rate and coverage. No claim is made for statistics outside the audited set. |
| R8 every UI error says what/why | **REFUTED** | Timeframe diagnostics are detailed, but Auto Test clears deterministic error text and preflight/track-ended/frozen paths do not all emit durable specific reason codes. |
| R9 docs/UI match code | **REFUTED** | README still claims browser-local BYOK/localStorage Groq key and older phase state, while current code uses server-side Groq proxy and sessionStorage audit auth. |

## A. Current TIMEFRAME_UNVERIFIED

Historical production failure was reproduced from the durable audit evidence created before this Phase 1 audit.

Failing historical frame:
- source: 2390 x 1084
- layout located: yes
- badge rect: x=179, y=964, w=87, h=94
- badge score: -0.0762
- frozen threshold: 0.985
- badge margin: -1.0612
- time-axis accepted labels: 27
- usable intervals: 26
- minimum intervals: 3
- median time tick: 120 seconds
- candle pitch: 35.5 px
- derived minutes/candle: 1.000
- axis result: M1 PASS
- badge result: FAIL
- combined badge AND axis result: FAIL

Historical crop rectangles:
- primary 114,140,2006,944
- plotArea 114,140,1834,834
- priceAxis 1948,140,172,834
- timeAxis 114,974,2006,110
- assetLabel 143,58,390,104
- timeframeBadge 179,964,87,94
- chartTypeToolbar 108,759,239,320
- platformClock 143,152,478,70
- tradePanel 2120,58,270,1026
- payoutExpiryPanel 2120,58,270,471

Root-cause classification for the historical failure:
- template/candidate scale mismatch: **CONFIRMED primary cause**
- global layout offset: **REFUTED for that frame; layout was located**
- time-axis OCR failure: **REFUTED; 27 labels / 26 usable intervals**
- genuinely not M1: **not supported; independent axis method derived exactly 1.000 min/candle**
- wrong tab/window: **UNVERIFIED / no supporting evidence**
- overlay over badge: **UNVERIFIED / no supporting evidence**

The old full native PNG was not retained; only crop evidence plus a privacy-masked full-frame artifact were retained. Exact historical devicePixelRatio/browser zoom were also absent. Current v2 records capture metadata/native PNG on future timeframe rejects, but the newest post-v2 record could not be read through Railway because the read-only agent quota was exhausted. Therefore the **current post-v2 exact score/DPR/native frame is UNVERIFIED and needs a fresh user live action plus accessible record**.

Current production HTTP trace did show six successful OCR calls followed by a 201 audit-record write and no `/api/groq/analyze` request for that observed attempt, confirming that attempt remained pre-model.

## B. Baseline / build / tests

Fresh audit CI on Node 24:
- Node 24.20.0
- npm 11.19.0
- repository has no tracked `package-lock.json`
- `npm install`: succeeded
- baseline tests: 57/57 passed
- Phase 1 direct production-module tests: 18/18 passed
- `tsc --noEmit`: passed; tsconfig strict mode is enabled
- production Vite build: passed
- linter: **NOT CONFIGURED**
- client-bundle scan for key-shaped `gsk_...` / `sk-...`: no matches

Build reproducibility:
- **CONFIRMED** that a fresh install/build succeeded in the audit runner.
- **NOT byte/dependency reproducible** because the repository does not track a lockfile and dependencies use semver ranges.

Coverage:
- Existing suite reported 100% with no production-file rows; that number is not evidence of production coverage.
- Direct production-module audit coverage: 52.89% lines, 76.56% branches, 53.69% functions across the imported production modules.
  - edgeGate.ts: 100% lines
  - outcomeResolver.ts: 42.60% lines
  - screenFieldVerification.ts: 32.68% lines
  - screenPipeline.ts: 41.12% lines
  - signalLogic.ts: 91.03% lines
  - apiClient.ts: 37.50% lines
- This is still not whole-app coverage; DOM-heavy App/Backtest/server integration remains under-covered.

Mutation sampling:
26/26 defined sabotages were detected; 0 were undetected and 0 failed to apply. The mutations cover:
- final audit edge gate
- layout, letterbox, candle-count, newest-candle and current-price-marker gates
- price-axis/time-axis readability
- timeframe missing/mismatch and badge-AND-axis logic
- asset missing/mismatch
- both validation-coverage locks
- chart-type threshold
- price-axis R², pixel-spacing and price-step checks
- clock staleness
- payout ambiguity and breakeven formula
- model bias enum
- outcome entry-null handling
- Wilson z-value and tie-denominator behavior

This is strong sampled mutation evidence, not exhaustive mutation proof. Still not mutation-tested end-to-end: frozen-clock timing branch, expiry-duration branch, template scale list/canonical dimensions, browser preflight implementation, DOM capture abnormal states, server proof enforcement, and every documentation/UI path.

## C. Capture

CONFIRMED:
- capture uses `getDisplayMedia`
- requests ideal 2560x1440 but uses actual `video.videoWidth/video.videoHeight`
- canvas output size equals actual source size; no deliberate downscale
- capture output is PNG, not JPEG
- Auto Test uses a busy ref to prevent overlapping auto cycles
- Auto Test stops after the configured consecutive-error circuit breaker
- track-ended handler stops auto mode and clears live state
- media element detaches `srcObject` after capture

UNVERIFIED / weak:
- no long-run browser heap measurement, so leak-free memory is not proven
- permission revocation/closed/minimized tab behavior lacks a complete real-browser test matrix
- resolution changes are re-read per capture, but there is no explicit `RESOLUTION_CHANGED` event/reason
- frozen images in Auto Test are treated as similar/skip, not as a durable `FROZEN_FRAME` failure
- blank/preflight-blocked frames can be returned before a reproducibility decision record is written
- manual uploaded analysis has no re-entry guard equivalent to `autoCycleBusyRef`; repeated Analyze clicks can overlap

## D. Layout and crops

CONFIRMED by code:
- one `analysisImage` is loaded once, one canvas is used for geometry, and all crop rectangles are derived from that same source frame
- audit artifacts carry source frame hash/timestamp
- relative-coordinate layout profile is used
- letterbox gate uses near-black edge ratio
- candle count has both minimum and maximum
- timeframe matcher uses source-pixel normalization plus frozen fixed scales

Evidence scope:
- original real calibration family: 736x334
- historical production frame: 2390x1084 and the structural layout was found
- two real dimensions therefore exist, but two independent untouched acceptance window/zoom states do not. Acceptance coverage remains incomplete.
- real overlay/popup rejection controls were not supplied, so overlay rejection is **UNVERIFIED**.

## E. Deterministic checks

| Check | Valid evidence | Invalid evidence | Result |
|---|---|---|---|
| E1 timeframe | historical calibration badge 10/10 under old matcher; historical production axis derived 1.000 min/candle | real 5s/15s/30s/5m/15m absent | **rejection unproven for v2 real negatives** |
| E2 chart type | 10 same-session candlestick calibration frames; minimum corr 0.953757... > 0.92 | real line/bars/Heikin-Ashi absent | **rejection unproven** |
| E3 asset | real CAD/CHF (OTC) OCR evidence; current parser exact-normalizes against configured asset | no independent real asset-mismatch corpus | **partial** |
| E4 price axis | calibration evidence + parser/fit tests | historical production frame rejected spacing CV 0.2862 > 0.25 and step CV 0.2828 > 0.10; synthetic invalids tested | **partial real evidence** |
| E5 time axis | real M1 axis evidence + direct midnight-rollover production-function test | synthetic M5 geometry rejects; real non-M1 absent | **real invalid rejection unproven** |
| E6 clock | parser/stale/frozen source + old real stale frame rejected at 6s > 5s | unreadable calibration evidence exists | **boundary assumption unverified** |
| E7 payout | real 93% OCR evidence; breakeven 1/(1+0.93)=0.518134715... | ambiguity mutation detected; unreadable returns null | **parser partial; not an AI eligibility gate** |

Important E1 rule is intact: explicit 1m badge **AND** time-axis/candle-pitch. The 00:01:00 expiry field is not used as timeframe or platform clock.

Clock assumption: `secondsIntoCandle = platform UTC seconds % 60`. The code is deterministic, but the assumption that Quotex M1 candle boundaries are always aligned exactly to UTC minute boundaries has not been proven against real candle-open transitions.

Payout gap: `PAYOUT_UNREADABLE` is produced, but `verifyStage3CFrame` does not push payout unreadability into `reasons`; therefore a frame can be `frameVerified=true` with payout null if all other checks pass.

## F. Fail-open/adversarial findings

### CRITICAL — server model proxy does not enforce deterministic proof
`POST /api/groq/analyze`:
1. requires audit auth;
2. parses JSON;
3. calls `proxyGroq(payload)`.

A local integration probe started the real server with an outbound Groq fetch spy, authenticated normally, and sent an arbitrary payload with:
- model = `attacker-selected-model`
- one caller-supplied image
- temperature = 1
- no response_format
- no deterministic proof envelope

Observed result:
- `/api/groq/analyze` returned HTTP 200;
- the outbound spy was called;
- spy evidence reported `model=attacker-selected-model`, `hasImage=true`, `temperature=1`, `hasResponseFormat=false`.

Therefore this is a **CONFIRMED server-side bypass**, not only a code-inspection concern. The server does not independently require or verify source frame hash, layout result, timeframe evidence, chart type, asset match, axes, clock, payout, validation coverage lock, approved model ID, or approved prompt/schema version.

### HIGH — Backtest emits directional CALL/PUT
Backtest builds rows from raw model `result.signal`, then renders `row.bias`; it does not apply the final audit edge gate. It does not place trades, but it violates the whole-app user-visible R1 requirement.

### HIGH — fake replay
Server replay hard-codes NEUTRAL; it is a stored-output comparison, not a replay.

### HIGH — append-only audit hash-chain is not concurrency-safe
A local integration probe sent 120 concurrent valid outcome-event writes to the real server implementation. All 120 returned 201, but **119 adjacent hash-chain links were broken**. The implementation reads the current last hash and appends in separate asynchronous steps without serialization, allowing concurrent records to share the same predecessor. This directly undermines the claimed linear append-only chain under concurrent requests.

### HIGH — preflight frames can vanish from decision audit
Manual/Auto Test preflight blocks can stop before the normal reproducibility record is written. Auto Test also makes a blocked frame the similarity baseline.

### HIGH — Auto Test can erase the detailed reject message
After `executeAiAnalysis`, Auto Test calls `setError('')`, including when `executeAiAnalysis` just set a detailed deterministic failure.

### MEDIUM — uploaded-image analysis re-entry race
Manual Analyze is not disabled by `analyzing` and has no busy ref; repeated clicks can overlap requests/state/audit operations.

### MEDIUM — client model validator is coercive and repairs unknown text
Audit probes confirmed:
- confidence `"80"` (string) is accepted via Number conversion;
- confidence `1000` is clamped/accepted instead of rejected;
- empty pair becomes `Unknown Asset`;
- empty pattern becomes `No clear pattern`;
- empty entry becomes a generated no-trade sentence;
- empty support/resistance becomes a generated fallback sentence.

That conflicts with the requested rule that unknown values remain null with a reason code and is weaker than the declared strict JSON schema.

### MEDIUM — arbitrary outcome event body is accepted
This is runtime-confirmed. A local server integration probe submitted an `ARMED` event containing `direction:'SIDEWAYS'`, `dueAt:null`, `entry:null`; the endpoint returned **201**. It validates only identifiers/event type, then stores the rest of the supplied body. It does not server-validate direction, prices, timestamps, payout, resolved outcome or relationship to an existing trade.

### MEDIUM — precision profile localStorage trust
A locally injected object carrying the expected validation flags can affect pre-audit research filtering. Final audit lock still forces NEUTRAL, so this is integrity/reproducibility risk rather than a trade-signal escape.

Fail-closed examples that were inspected:
- OCR/template exceptions normally produce unreadable/null rather than pass
- missing timeframe/template cannot satisfy the AND
- unknown chart type fails closed
- missing asset/configuration fails closed in live deterministic path
- outcome missing prices/expiry/payout stays null

## G. AI layer

Code configuration:
- model: `qwen/qwen3.8-27b`
- prompt version: `vision-signal-v4.0.0`
- temperature: 0
- seed: 424242
- reasoning effort: none
- max tokens: 850
- strict JSON-schema response format
- browser client timeout: 45 seconds

Current Groq public documentation lists `qwen/qwen3.8-27b` as a hosted multimodal text+image model with vision and JSON Schema support, 20MB max file size and 3 max input images. Strict structured outputs are documented for this model.

Actual `GET /openai/v1/models` output using the server's configured key was **not obtained**: the connected Railway tooling exposes that the key is configured but does not reveal it, and the application has no read-only models-list diagnostic route. Therefore exact account-level model-list verification remains **UNVERIFIED**.

AI weaknesses:
- server proxy allows arbitrary authenticated client payload rather than enforcing the frozen model/schema/prompt
- server request body cap is 32MB, larger than Groq's documented 20MB image limit
- server-side upstream fetch has no explicit abort timeout; the browser's 45s abort does not prove the upstream fetch is cancelled
- no explicit retry/backoff policy
- 429/5xx are humanized client-side but not a full rate-limit strategy
- normal live request is one image; generic Groq helper supports primary + up to two context images (3 total)

Malformed output:
- invalid JSON and invalid bias enum are rejected by the production validator in direct tests;
- confidence type/range is not strict as described above;
- empty textual fields are repaired into fallback strings rather than remaining unknown/null;
- final live audit gate is applied after the model result, but Backtest does not use that final gate.

Server-side route enforcement:
- runtime outbound-spy test proves an authenticated arbitrary image payload can reach the Groq transport without deterministic proof;
- caller-selected model/temperature are forwarded unchanged;
- therefore client-side JSON schema/prompt settings are not a security boundary.

## H. Gates and audit lock

Direct production-function boundary test passed:
- coherent 4/4 CALL -> directional pre-audit signal
- coherent 3/4 CALL -> directional pre-audit signal
- 2/4 -> NEUTRAL
- 3 aligned + 1 opposing -> directional pre-audit signal
- 2 opposing -> NEUTRAL
- confidence 69 with min 70 -> NEUTRAL
- chart quality poor -> NEUTRAL
- timeframe not M1 -> NEUTRAL
- conflicting context when context is provided -> NEUTRAL

Then a separate behavioral test forces coherent CALL and PUT through `applySignalGate` and verifies `applyAuditEdgeGate` changes both to final NEUTRAL.

Important: this proves the live edge-gate function, not the whole app, because Backtest bypasses it.

No trade-placement function/path was found. The Stage 11 resolver records/compares outcomes but does not click broker controls or place trades.

## Outcome/statistical audit

CONFIRMED:
- breakeven formula `1 / (1 + payoutDecimal)`
- 93% payout -> 0.5181347150259068 before presentation rounding
- tie returns unitReturn 0
- missing entry/expiry/payout returns null with reason in resolver
- WIN unit return is +payout, LOSS -1, TIE 0

CONFIRMED by independent known-value vectors for the requested core formulas:
- Wilson 95% lower bound: a holdout vector of 24 wins, 4 losses and 2 ties yields decided-only win rate 85.7% and Wilson lower bound 68.5%.
- Backtest denominator/ties: 1 win, 1 loss, 1 tie and 2 neutral rows yields 3 directional signals, 2 neutral, 50% decided-only win rate and 60% signal coverage.
- Outcome expectancy: returns +0.9, -1 and 0 yield mean/full-sample expectancy -0.033333 when all expired outcomes are known.
- If any expired outcome is null, full-sample expectancy remains null and a selection-bias warning is emitted.
- Agreement/null vector: 4 expired, 3 known, 1 null, 4 manual labels, 3 agreement-eligible and 2 agreements yields 25% null rate and 66.67% agreement rate.
- Breakeven: 93% payout yields 0.5181347150259068 before presentation rounding.
- Tie return is 0.

These tests validate the named formulas/statistics, not every possible UI aggregation or future statistic.

## R6 secret audit

CONFIRMED for examined code/build:
- Groq API requests are proxied through same-origin server; client does not receive `GROQ_API_KEY`
- legacy browser Groq key is cleared on app mount
- audit token is stored in sessionStorage, not localStorage
- production logs inspected expose only boolean configuration state, not key contents
- key-shaped client bundle scan found no matches

UNVERIFIED:
- complete secret scan of every persistent `/data/audit` file could not be performed with current read-only tooling quota
- because secret values are intentionally not exposed, absence of their exact byte strings from every log/storage file cannot be proven from the connector

## Documentation mismatch

README is materially stale:
- claims browser-local BYOK Groq key/localStorage
- describes an older phase/server-proxy state
Current code uses server-side Groq key, protected proxy endpoints, and sessionStorage audit auth.

## Phase 1 test evidence

Audit branch: `audit/phase1-e2e-20260920`
PR: #1, deliberately not merged.

Latest complete audit workflow evidence:
- workflow conclusion: SUCCESS on audit branch head `f9d9738b61322b4474b1e3f6b3d519b4f3fff3ec`
- baseline 57/57 pass
- direct production-runtime audit tests 18/18 pass
- strict TypeScript pass
- production build pass
- mutation sample 26/26 detected, 0 sampled mutants undetected
- local server integration probe passed and confirmed the R2 outbound bypass, weak outcome schema, fake replay and concurrent hash-chain break
- key-shaped client bundle scan pass
- linter not configured
- lockfile missing from repository
- production-module coverage 52.89% lines / 76.56% branches / 53.69% functions for imported modules


## Additional Phase 1 findings confirmed after the initial report

### HIGH — durable audit endpoint accepts forged and duplicate decision records
The local server integration test posted a fabricated `/api/audit/records` record that had not come from the deterministic pipeline. The server returned 201. A second record with the **same recordId** was also accepted with 201.

Evidence:
- `fakeReplayRecordStored: true`
- `duplicateAuditRecordIdAccepted: true`
- replay then returned both records and marked both as matching because replay is constant-NEUTRAL.

The server validates `recordId` and artifact hashes but does not validate the decision-record schema, config/spec provenance, deterministic checks, gate snapshot, model/prompt settings, or uniqueness of recordId. Therefore the durable audit file is append-only storage, not an authoritative proof source.

### HIGH — Stage 11 screen resolver does not observe the documented contract target price
The documented Quotex settlement rule compares the expiration market price with the contract purchase/target price. The current screen resolver instead OCRs the **chart current-price tag** from a frame captured when the user presses the resolver button.

That chart tag may be useful validation evidence, but it is not the contract target price actually fixed for the manually placed trade. The screen method therefore remains experimentally unverified even though the settlement rule itself is documented.

### HIGH — Stage 11 expiry capture time is derived from resolver capture, not platform contract expiry
`makeArmedEvent` computes:

`dueAt = entry.capturedAt + 60 seconds`

It does not read a contract expiration timestamp from Quotex. Manual trade placement and the resolver's entry capture are not proven simultaneous. A delay between them shifts the expiry observation relative to the actual contract expiry.

### MEDIUM — ambiguous expiry crop can pass as verified 60 seconds
`readExpiryDuration` succeeds when `oneMinute.length === 1` even if additional non-60-second duration candidates are visible. Thus a crop containing one `00:01:00` token plus another conflicting duration can still return `verifiedOneMinute=true`.

This is a fail-open inside the **outcome resolver**, not the trade-signal gate.

### MEDIUM — clock staleness includes OCR/network processing delay
The platform clock text belongs to the captured image, but `verifyPlatformClock` runs OCR first and then fetches server time. It is not passed the frame's `capturedAt` timestamp. Consequently `serverDeltaSeconds` includes time spent on OCR and the subsequent server request.

Near the frozen 5-second staleness boundary this can falsely reject a valid captured clock. This is fail-closed, but it weakens R3 valid-input pass behavior. Correcting the reference-time rule would be a spec/rule change.

### MEDIUM — capture diagnostics mix target-video and analyzer-window geometry
`videoWidth/videoHeight` are measurements of the selected shared surface. However:
- `devicePixelRatio` comes from the analyzer app window;
- `cssViewportWidth/Height` come from the analyzer app window;
- `capturePixelsPerCssPixel` divides shared-target video pixels by analyzer-window CSS pixels.

When the selected Quotex tab/window differs from the analyzer tab, these values do **not** establish the target tab's DPR or browser zoom. The historical/current target DPR therefore remains unverified.

### MEDIUM — capture surface is not restricted to a browser tab
The browser picker result's `displaySurface` is recorded but not enforced. A user may share a browser tab, window, or monitor depending on browser picker options. The deterministic layout may subsequently reject the wrong view, but the capture layer does not emit a specific `WRONG_CAPTURE_SURFACE` reason.

### MEDIUM — live-but-muted capture is not specifically detected
`isLiveTabStreamActive` checks `readyState === 'live'` and `track.enabled`, but not `track.muted`. A source can therefore remain structurally "live" while no fresh frames are arriving. In Auto Test, an unchanged frozen image is treated as a low-change skip rather than a durable `FROZEN_FRAME` failure.

### MEDIUM — malformed JSON is reported as server 500
A local integration request containing malformed JSON to an authenticated API route returned HTTP 500 with the JSON parse exception. This is fail-closed, but a malformed client request is a 4xx input error, not a server fault, and does not meet the "specific reason" quality target.

### LOW / defense-in-depth — static response security headers are absent
The local production server implementation returned no:
- Content-Security-Policy
- X-Frame-Options
- Permissions-Policy
- Referrer-Policy
- X-Content-Type-Options

for the static app response. This did not produce a demonstrated signal-gate bypass, but it weakens browser hardening. The audit token lives in sessionStorage and therefore depends on page-origin script integrity.

### CONFIRMED — API authentication itself fails closed
Local server integration verified:
- unauthenticated `/api/auth/check` -> 401
- unauthenticated `/api/time` -> 401
- unauthenticated `/api/groq/analyze` -> 401
- the unauthenticated analyze attempt did **not** reach the outbound Groq spy.

The critical Groq bypass therefore requires a valid audit token; it is an authorization-boundary/design failure after authentication, not an unauthenticated endpoint exposure.


## Phase 2 priority proposal — no fixes applied yet

P0:
1. server-side deterministic proof token/envelope required by `/api/groq/analyze`, bound to source hash + config/spec + all required pass results; reject arbitrary proxy payloads
2. server-validate durable decision records, enforce unique recordId/provenance, and reject forged audit payloads
3. apply audit edge gate to Backtest user-visible signal, or clearly separate proposed/research direction without calling it final signal
4. replace fake replay (server and CLI) with actual stored-artifact deterministic replay
5. serialize/atomically queue hash-chained audit writes and test concurrent chain integrity
6. correct Stage 11 reference capture so validation is bound to the actual contract target/entry and actual platform expiry reference; do not assume resolver-button capture equals trade entry

P1:
7. write a durable NEUTRAL/skip decision record for every preflight, similarity and cooldown branch
8. stop Auto Test from clearing the actual reject/audit-storage reason
9. add manual Analyze re-entry guard
10. decide/spec whether payout is truly required before AI; if yes, add it to deterministic reasons (spec change)
11. strict client model schema: reject wrong types, extra properties and out-of-range values rather than coerce/clamp/repair
12. server-side schema for outcome/settings events and frozen model/prompt/schema
13. fix capture-surface classification, target-DPR diagnostics, muted/frozen-frame detection and specific reason codes
14. compare platform clock against capture-time-aligned server time rather than post-OCR time (spec/rule change)
15. make expiry parsing fail on conflicting duration candidates

P2:
10. lockfile + real linter
11. real negative-control corpus: 5s/15s/30s/5m/15m, line/bars/Heikin-Ashi, overlays, two+ untouched window/zoom states
12. long-run browser memory and capture-abnormal-state tests
13. independent Wilson/expectancy reference-vector suite
14. update README/UI claims

Any P1 item that changes a threshold, template, layout or decision rule must bump the spec and invalidate/count acceptance sessions according to the stated hygiene rule. At this audit baseline the untouched acceptance-session count is zero.
