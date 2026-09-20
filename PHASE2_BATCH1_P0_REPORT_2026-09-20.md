# Phase 2 — Batch 1 P0 Report

Date: 2026-09-20  
Branch: `phase2/batch1-p0-proof-audit-integrity`  
PR: #2  
Base: `main@eb2ba5b2b66bf85b2fe1183ac6a78f0c99d2421b`

## Scope and deployment state

This PR implements only approved Batch 1 items:

- server-side proof boundary for `POST /api/groq/analyze`;
- server-owned Groq model, existing prompt, temperature, seed, strict response schema, max tokens, image-count policy;
- native-frame server deterministic verification before any image-bearing Groq call;
- analyze request/image size limits and server-side upstream timeout;
- serialized hash-chain writes with an in-process queue plus an atomic filesystem write lock for cross-process writers;
- decision-record/artifact schema validation;
- duplicate `recordId` rejection;
- server-generated `serverRecordedAt`, `previousRecordHash`, and `recordHash`;
- authenticated hash-chain verification and tamper detection;
- malformed JSON -> HTTP 400;
- browser security headers.

**Production is not deployed or changed.** This PR must not be merged/deployed until explicit approval.

Safety state:

- AUDIT LOCK: **ON**
- `LAYOUT_VALIDATION_INCOMPLETE`: **ON**
- server validation-coverage eligibility lock: **ON**
- automatic unlock: **not added**
- automatic trade placement: **not added**

## Spec hygiene

**No spec ID bump in Batch 1.**

No frozen threshold, template, layout coordinate, timeframe AND-rule, min-confidence rule, price-axis occlusion rule, or outcome rule was changed. Batch 1 adds a second enforcement boundary on the server using the existing frozen values.

The AI prompt is also not intentionally changed: the existing `vision-signal-v4.0.0` prompt text was moved from client authority to the server.

Frozen values remain unchanged, including:

- timeframe badge threshold: **0.985**
- fixed badge scales: **0.75, 0.9, 1.0, 1.1, 1.25, 1.5**
- timeframe logic: **badge AND time-axis/candle-pitch**
- minutes/candle tolerance: **±0.08**
- candlestick threshold: **0.92**
- price-axis R²: **0.995**
- price-axis pixel-spacing CV: **0.25**
- price-axis price-step CV: **0.10**
- OCR minimum confidence: **70**
- clock staleness tolerance: **5 s**

Acceptance sessions affected: **0**.

The E4 occlusion change and `minConfidence` spec-versioning remain deferred to the single approved Batch 3 spec bump.

## Phase 1 baseline reconciliation

Pinned Phase 1 evidence:

- artifact: `phase1-audit-evidence-9e0f1653.zip`
- SHA-256: `bc27d6b6191e682cfd9014b726bbe1863d0de1bf248418c4059ddc8f24371ddc`

The Phase 1 source-only hash-chain probe had status `UNVERIFIED`. The Phase 1 runtime integration probe then executed 120 concurrent writes and measured:

- non-201 responses: **0**
- broken adjacent chain links: **119**
- strictly linear: **false**

Therefore the reconciled Phase 1 hash-chain status is **CONFIRMED_FAIL**, not UNVERIFIED.

The Batch 1 reconciliation script requires the rerun source probe and runtime probe to agree. After the fix they both report PASS/linear-chain behavior.

## Finding-by-finding before / after

| Finding | Phase 1 evidence | Permanent Batch 1 regression | Batch 1 result |
|---|---|---|---|
| R2 server proof-boundary bypass | arbitrary authenticated image/model request returned 200 and hit outbound Groq spy | outbound-spy integration + `R2-SERVER-GATE` | **PASS** |
| client chose model/settings | `CONFIRMED_FAIL` | request-envelope rejection + fixed-payload unit test | **PASS** |
| no server upstream timeout | `CONFIRMED_FAIL` | AbortController/source regression | **PASS** |
| analyze size policy mismatch | `CONFIRMED_MISMATCH` | body/image limit source + policy regressions | **PASS** |
| concurrent hash-chain race | runtime: 119 broken links / 120 writes | runtime concurrency probe + chain verifier | **PASS: 0 broken links** |
| weak audit-record envelope | `CONFIRMED_WEAK` | invalid-record integration | **PASS for Batch 1 schema scope** |
| duplicate `recordId` accepted | runtime: second write 201 | duplicate integration | **PASS: 409** |
| no authenticated tamper verifier | gap | post-write mutation + verifier | **PASS** |
| malformed JSON -> 500 | runtime 500 | malformed JSON integration | **PASS: 400** |
| browser hardening headers absent | Phase 1 headers null | header integration | **PASS** |

Every fixed finding keeps its Phase 1 probe/probe-equivalent in the branch as a permanent regression test.

## A. Server-side proof boundary

The browser can no longer submit a Groq/OpenAI payload to `/api/groq/analyze`.

Allowed client fields are restricted to:

- `imageDataUrl` — native captured frame;
- `configuredAsset`;
- `capturedAt`.

Caller-supplied `model`, `messages`, `temperature`, `seed`, `response_format`, or any other extra field causes HTTP 400 `CLIENT_MODEL_PARAMETERS_FORBIDDEN`.

Server-fixed policy:

- model: `qwen/qwen3.8-27b`
- prompt version: `vision-signal-v4.0.0`
- prompt text: existing v4 prompt, moved server-side
- temperature: `0`
- seed: `424242`
- max tokens: `850`
- response format: strict JSON Schema
- schema `additionalProperties: false`
- input images: one server-generated primary crop only
- decoded image max: **20 MiB**
- analyze body max: **28 MiB**
- upstream timeout: **30 s**

Flow:

```
authenticated request
        |
strict request-envelope validation
        |
native image decode + byte/MIME limits
        |
server deterministic verifier
        |
eligibleForModel?
     /        \
   NO          YES
 HTTP 422       server primary crop
 zero Groq      fixed server payload
 calls                |
                    Groq
```

The independent server verifier mirrors the existing structural/layout, preflight, timeframe badge AND time-axis/candle-pitch, configured-asset, price-axis, chart-type, and clock checks.

Its validation-coverage lock remains false, so Batch 1 does **not** create an accidental production unlock.

### Outbound-spy runtime result

For a real local server process with a Groq fetch spy:

- attacker-selected model/settings payload -> **400**
- deterministic-failing native image -> **422**
- outbound Groq calls -> **0**

No rejected image reaches model transport.

A successful image-bearing model call is intentionally not claimed while validation coverage is incomplete.

## B. Audit log integrity

Hash-chained writes use both:

1. a per-file in-process promise queue; and
2. an atomic filesystem lock directory around the read-head/hash/append critical section.

The filesystem lock makes the chain safe across multiple Node server processes sharing the same audit volume, not only within one process.

For a decision record the server:

1. validates the decision envelope and artifact envelopes;
2. rejects duplicate `recordId`;
3. ignores caller-supplied chain/server timestamp fields;
4. obtains the current chain head while holding the write lock;
5. adds server `serverRecordedAt`;
6. adds `previousRecordHash`;
7. computes SHA-256 `recordHash`;
8. appends the final NDJSON row.

The stored decision metadata is also required to match the server-owned model/prompt/temperature/seed policy.

### Concurrency evidence

Phase 1:

- writes: **120**
- non-201: **0**
- broken links: **119**
- linear: **false**

Batch 1 integration probe:

- writes: **120**
- non-201: **0**
- broken links: **0**
- linear: **true**

The permanent regression suite additionally writes decision records from **two server processes sharing one audit directory** and verifies one linear chain.

### Schema, duplicate and tamper evidence

- invalid decision envelope -> **400**
- valid decision record -> **201**
- duplicate `recordId` -> **409**
- clean chain -> **valid**
- record modified after write -> **409 / RECORD_HASH_MISMATCH**

Batch 1 does not claim semantic replay of every stored decision. Real deterministic replay is Batch 3.

## C. Malformed JSON and browser security headers

Malformed JSON now returns:

```
HTTP 400
MALFORMED_JSON
```

Applied response protections include:

- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`
- `Cache-Control: no-store` for API responses

Static 403/404 paths also receive the security-header helper.

## Docker/runtime compatibility

Batch 1 adds `sharp` for server-native image decoding. The Docker runtime stage now copies:

- `node_modules` from the build stage;
- the new `server/` modules;
- `server.mjs`.

This prevents a successful frontend build from producing a runtime image that cannot import the server verifier.

## Tests and mutation testing

A clean Batch 1 CI run on the branch has demonstrated:

- baseline + Batch 1 suite: **66 / 66 PASS**
- Phase 1 production-runtime audit suite: **29 / 29 PASS**
- TypeScript strict mode: **PASS**
- production Vite build: **PASS**
- npm dependency audit: **0 vulnerabilities**
- Phase 1 fixed-finding probes: **PASS**
- Batch 1 server integration probe: **PASS**
- source/runtime reconciliation: **PASS**
- Phase 1 mutation checks: **26 / 26 detected**
- Batch 1 P0 mutation checks: **13 / 13 detected**
- undetected sabotage in the clean run: **0**

During development an earlier mutation run exposed weak mutation coverage rather than a production bypass:

- the image-limit source assertion was initially too broad;
- a mutation that disabled only the in-process queue remained harmless because the independent filesystem lock still serialized writes.

The tests were corrected: the image-limit guard is matched exactly, and the audit-lock mutation now targets the real cross-process filesystem lock. The full mutation suites are rerun after the correction.

## Open issues intentionally left for later batches

Batch 2:

- outcome invalid-direction handling;
- structural/asset/expiry resolver requirements;
- actual trade expiry reference and elapsed-time tolerance;
- stale timer/busy closure;
- R1 history/display/export neutralization;
- R5 invented defaults.

Batch 3:

- real deterministic replay with stored runtime gate parameters;
- native-frame storage/replay cost decision;
- single spec bump for E4 price-axis occlusion rejection and `minConfidence` versioning.

Batch 4:

- tracked lockfile and linter;
- Auto Test AI-run/cooldown/re-entry fixes;
- Backtest unknown-timeframe/ISO/UTC/provenance corrections;
- stale docs/UI claims;
- stable error-reason coverage.

Still unverified:

- real non-M1 negative-control corpus;
- untouched multi-session/multi-window acceptance coverage;
- successful image-bearing server AI call under a fully validated acceptance state.

## Approval gate

This PR is **not merged and not deployed**.

Batch 2 must not begin until Batch 1 is explicitly approved.
