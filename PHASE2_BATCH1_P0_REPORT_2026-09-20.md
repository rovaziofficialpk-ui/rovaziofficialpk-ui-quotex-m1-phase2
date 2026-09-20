# Phase 2 — Batch 1 P0 Report

Date: 2026-09-20  
Branch: `phase2/batch1-p0-proof-audit-integrity`  
Base: `main@eb2ba5b2b66bf85b2fe1183ac6a78f0c99d2421b`

## Scope and deployment state

This batch implements only approved Batch 1 items:

- server-side proof boundary for `POST /api/groq/analyze`;
- server-owned Groq model/prompt/temperature/seed/strict JSON schema;
- native-frame server deterministic verification before any image-bearing Groq call;
- request/image size limits and server upstream timeout;
- serialized append-only audit writes;
- server-side audit-record/artifact schema validation;
- duplicate `recordId` rejection;
- server-generated chain timestamp, previous hash and record hash;
- authenticated hash-chain verification/tamper detection;
- malformed JSON -> HTTP 400;
- browser security headers on API and static responses.

No Batch 2/3/4 finding was intentionally fixed in this batch.

**Production was not deployed or changed.** Railway remains on the existing `main` build until explicit approval.

Safety state after the batch:

- AUDIT LOCK: **ON**
- LAYOUT_VALIDATION_INCOMPLETE: **ON**
- server validation-coverage lock: **ON / false for eligibility**
- automatic unlock: **not added**
- app trade placement: **not added**

## Spec hygiene

**No spec bump in Batch 1.**

Reason: no frozen threshold, template, layout coordinate, timeframe AND-rule, signal threshold, or outcome rule was changed. The server now independently enforces the existing frozen deterministic conditions and retains the existing validation-incomplete lock.

Existing threshold examples remain unchanged:

- timeframe template correlation: 0.985
- timeframe fixed scales: 0.75, 0.9, 1.0, 1.1, 1.25, 1.5
- chart-type candlestick correlation: 0.92
- price-axis R²: 0.995
- price-axis pixel-spacing CV: 0.25
- price-axis price-step CV: 0.10
- clock staleness tolerance: 5 seconds

Acceptance sessions affected: **0**.

The E4 occlusion-rule change and `minConfidence` versioning are deliberately deferred to the single Batch 3 spec bump.

## Finding-by-finding before / after

| Phase 1 finding | Before | Batch 1 permanent probe | After |
|---|---|---|---|
| R2 server Groq gate bypass | CONFIRMED_FAIL; authenticated arbitrary image/model payload reached outbound Groq transport | `R2-SERVER-GATE` + outbound-spy integration | **PASS** |
| Client could choose Groq model/settings | CONFIRMED_FAIL | `AI-SERVER-PAYLOAD-NOT-FROZEN` | **PASS** |
| No server upstream timeout | CONFIRMED_FAIL | `AI-SERVER-UPSTREAM-TIMEOUT` | **PASS** |
| Analyze size policy did not match upstream image constraints | confirmed mismatch | `AI-REQUEST-SIZE-POLICY` | **PASS** |
| Hash-chain concurrent append race | CONFIRMED; 120 writes produced 119 broken adjacent links | `AUDIT-HASHCHAIN-CONCURRENCY` + 120-write runtime probe | **PASS; 0 broken links** |
| Audit record accepted weak/forged envelope | confirmed weak server schema | `AUDIT-RECORD-SERVER-SCHEMA` | **PASS for the approved schema requirement** |
| Duplicate decision record IDs accepted | CONFIRMED | `AUDIT-DUPLICATE-RECORDID` | **PASS** |
| No direct tamper verifier | CONFIRMED gap | `AUDIT-TAMPER-DETECTION` | **PASS** |
| Malformed JSON returned 500 | CONFIRMED | `MALFORMED-JSON-STATUS` | **PASS; returns 400** |
| Static/API browser hardening headers absent | CONFIRMED | `SECURITY-HEADERS` | **PASS** |

The Batch 1 copy of the Phase 1 probe suite now uses a uniform rule for these fixed findings: **PASS** when the protection is present, otherwise **CONFIRMED_FAIL**. The probes are retained as permanent regression tests.

## A. Server-side proof boundary

The analyze endpoint no longer accepts an OpenAI/Groq request body from the browser.

Accepted client fields are restricted to:

- native `imageDataUrl`;
- configured asset;
- capture timestamp.

Fields such as `model`, `temperature`, `seed`, `response_format`, `messages`, and arbitrary extra fields are rejected before model transport.

Server-owned policy:

- model: `qwen/qwen3.8-27b`
- temperature: `0`
- seed: `424242`
- max tokens: `850`
- response format: strict JSON Schema
- additional properties: false
- prompt: the existing `vision-signal-v4.0.0` prompt was moved server-side without intentionally changing its text
- upstream timeout: 30 seconds
- decoded image max: 20 MiB
- analyze request-body max: 28 MiB

Flow:

```
authenticated request
        |
validate request envelope
        |
decode native frame + byte/MIME limit
        |
server deterministic verifier
        |
eligibleForModel == true ?
      /                 \
    NO                   YES
  HTTP 422             server crop
  zero Groq calls        |
                     fixed Groq payload
                         |
                       Groq
```

The server verifier independently checks the existing structural/layout, preflight, timeframe badge AND time-axis/candle-pitch, asset, price-axis, chart-type, and clock conditions. Its validation-coverage lock remains false, so it cannot silently unlock model eligibility.

### Runtime outbound-spy evidence

The real Node server was started under the test suite with an outbound fetch spy.

Observed:

- arbitrary old OpenAI-style payload -> **400**
- request containing caller-selected model -> **400**
- blank/native arbitrary image that fails deterministic checks -> **422**
- outbound Groq calls for those rejected requests -> **0**

No failing-gate image reached the model transport.

A successful image-bearing Groq call is intentionally **not** claimed/tested while `LAYOUT_VALIDATION_INCOMPLETE` is ON. The fixed outbound payload itself is unit-tested. This preserves the lock rather than bypassing it for a positive test.

## B. Audit log integrity

Writes are serialized per NDJSON file through a single in-process writer queue.

For each stored row the server now:

1. validates the approved envelope where required;
2. checks duplicate unique IDs where required;
3. reads the current chain head inside the serialized section;
4. discards caller-supplied chain hash/timestamp fields;
5. adds server `serverRecordedAt`;
6. adds `previousRecordHash`;
7. computes SHA-256 `recordHash`;
8. appends the finalized row.

### 120-concurrent-write rerun

Phase 1 runtime result:

- writes attempted: 120
- non-201 writes: 0
- broken adjacent links: **119**

Batch 1 runtime result:

- writes attempted: 120
- non-201 writes: **0**
- broken adjacent links: **0**
- strictly linear chain: **true**

The source-level `phase1-probes.json` hash-chain finding and runtime integration result are reconciled by `scripts/batch1-reconcile.mjs` and the reconciliation result is **true**.

### Record schema / duplicate / tamper evidence

- invalid decision-record envelope -> **400**
- valid decision record -> **201**
- second write with same `recordId` -> **409**
- clean chain verifier -> **200 / valid=true**
- record modified after write -> **409 / valid=false / RECORD_HASH_MISMATCH**

The audit endpoint still accepts authenticated client-supplied semantic content inside fields such as `deterministicScreen`; Batch 1's approved requirement was server-side record schema/integrity, not full server reconstruction of every stored decision. Real deterministic replay/provenance is Batch 3.

## C. Malformed JSON and security headers

Malformed JSON is now normalized to the stable error:

```
HTTP 400
MALFORMED_JSON
```

Security response policy includes:

- Content-Security-Policy
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: no-referrer
- Permissions-Policy
- Cross-Origin-Opener-Policy
- Cross-Origin-Resource-Policy
- Strict-Transport-Security

The same helper is used by API responses and normal/static error responses.

## Tests

Final clean CI run at `f42e08e62a10debd768bc38a317c4b9ccf3e8d90`:

- baseline + Batch 1 test suite: **63 / 63 PASS**
- Phase 1 direct production-runtime audit suite: **29 / 29 PASS**
- TypeScript strict check: **PASS**
- production Vite build: **PASS**
- dependency audit: **0 vulnerabilities**
- Phase 1 fixed-finding probes: **PASS**
- server integration probe: **PASS**
- source/runtime reconciliation: **PASS**
- lock assertions: **PASS**

### Dependency audit correction

The first implementation used Sharp 0.34.x and the CI dependency audit surfaced one high-severity direct advisory affecting that range. The dependency was upgraded to `sharp ^0.35.4`, which the same clean CI audit reports as:

- info 0
- low 0
- moderate 0
- high 0
- critical 0

No vulnerable Sharp version is knowingly left in the Batch 1 branch.

## Mutation testing

All original Phase 1 sampled sabotages were rerun:

- Phase 1 mutants: **26**
- detected: **26**
- undetected: **0**

Batch 1 added 13 P0-specific sabotages covering proof-boundary bypass, caller-model filtering, fixed temperature/seed, upstream abort signal, image byte limit, audit schema, duplicate ID, serialization, tamper verification, malformed-JSON status, frame headers, and the server validation-coverage lock.

Final Batch 1 mutation result:

- Batch 1 mutants: **13**
- detected: **13**
- undetected: **0**

An earlier Batch 1 CI attempt exposed **one undetected sabotage**: `analyze-image-limit-disabled`. The production limit itself was present, but the initial regression assertion was too weak and still matched the sabotaged source. The regression test was strengthened to require the actual guarding `if (decoded.bytes.length > ANALYZE_MAX_IMAGE_BYTES)` statement. After that correction the full mutation suite was rerun and all 13/13 Batch 1 mutants were detected. This test weakness is not hidden from the final report.

## Open issues after Batch 1

These remain intentionally open because they belong to later approved batches:

- Batch 2: invalid outcome direction, structural/asset/expiry resolver validation, actual trade expiry reference, resolver timer race, all R1 display/history/export paths, unknown/default coercions.
- Batch 3: real replay and sufficient native input/runtime-parameter retention; single spec bump for price-axis occlusion rejection and `minConfidence` versioning.
- Batch 4: lockfile/linter, Auto Test counters/cooldown/re-entry, Backtest timestamp/timeframe/provenance fixes, documentation/UI claim corrections, stable reason code coverage.
- Real negative-control corpus remains incomplete.
- Server/browser deterministic-verifier equivalence on real untouched acceptance frames is not claimed; with validation coverage incomplete the server fails closed and sends no image-bearing model request.

## Approval gate

This branch has **not** been deployed or merged.

Next action requires explicit Batch 1 approval. Until then:

- production remains unchanged;
- AUDIT LOCK stays ON;
- LAYOUT_VALIDATION_INCOMPLETE stays ON;
- no Batch 2 work is started.
