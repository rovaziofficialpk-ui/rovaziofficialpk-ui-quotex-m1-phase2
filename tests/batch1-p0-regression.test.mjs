import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import {
  ANALYZE_MAX_BODY_BYTES,
  ANALYZE_MAX_IMAGE_BYTES,
  GROQ_FIXED_MODEL,
  GROQ_FIXED_SEED,
  GROQ_FIXED_TEMPERATURE,
  GROQ_UPSTREAM_TIMEOUT_MS,
  SERVER_SIGNAL_SCHEMA,
  fixedGroqPayload,
  securityHeaders,
  validateAnalyzeRequest,
  verifyHashChain,
} from '../server/batch1Security.mjs';

function validRecord(index) {
  const now = new Date(Date.UTC(2026, 8, 20, 14, 0, 0, index % 1000)).toISOString();
  return {
    schemaVersion: 'decision-record-v1',
    recordId: 'batch1-record-' + String(index).padStart(4, '0'),
    configVersion: 'input-pipeline-v1.6.0',
    promptVersion: 'vision-signal-v5.0.0-server-fixed',
    modelName: 'qwen/qwen3.8-27b',
    temperature: 0,
    seed: 424242,
    seedReason: 'batch1-regression',
    systemFingerprint: null,
    capturedAt: now,
    decisionAt: now,
    source: 'upload',
    captureEnvironment: null,
    configuredTimeframe: 'M1',
    layoutProfileVersion: 'quotex-desktop-observed-v1.3.0',
    layoutReason: 'BATCH1_REGRESSION',
    deterministicScreen: { safeForAi: false, reasons: ['LAYOUT_VALIDATION_INCOMPLETE'] },
    rawModelResponseText: null,
    modelCallSkippedReason: 'LAYOUT_VALIDATION_INCOMPLETE',
    preflight: { status: 'block', score: 0 },
    gateSnapshot: {
      modelProposedBias: 'NEUTRAL',
      preAuditBias: 'NEUTRAL',
      finalBias: 'NEUTRAL',
      finalReason: 'AUDIT_LOCK',
    },
    timingsMs: {
      capture: 1,
      preflight: 1,
      deterministicScreen: 1,
      aiCall: null,
      gates: 0,
      totalCaptureToDecision: 3,
    },
    nullReasons: { timeframe: 'LAYOUT_VALIDATION_INCOMPLETE' },
    durableWrite: 'pending',
    createdAt: now,
  };
}

async function waitForHealth(base) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('SERVER_NOT_READY');
}

async function requestJson(base, pathname, init = {}) {
  const response = await fetch(base + pathname, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, body, text };
}

async function startServer(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'quotex-batch1-'));
  const port = 43271 + Math.floor(Math.random() * 500);
  const token = 'batch1-test-audit-token';
  const child = spawn(process.execPath, ['--import', './tests/batch1-groq-fetch-spy.mjs', 'server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      AUDIT_DATA_DIR: dataDir,
      AUDIT_AUTH_TOKEN: token,
      GROQ_API_KEY: 'test-groq-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  const base = 'http://127.0.0.1:' + port;
  await waitForHealth(base);

  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await rm(dataDir, { recursive: true, force: true });
  });

  return {
    dataDir,
    base,
    token,
    headers: { 'X-Audit-Token': token, 'Content-Type': 'application/json' },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

test('Batch 1 P0: fixed Groq policy is server-owned and strict', () => {
  const payload = fixedGroqPayload('data:image/png;base64,AAAA', {
    model: 'attacker-model',
    temperature: 2,
    seed: 1,
    response_format: { type: 'text' },
  });

  assert.equal(payload.model, GROQ_FIXED_MODEL);
  assert.equal(payload.temperature, GROQ_FIXED_TEMPERATURE);
  assert.equal(payload.seed, GROQ_FIXED_SEED);
  assert.equal(payload.response_format.type, 'json_schema');
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.equal(payload.response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(payload.response_format.json_schema.schema, SERVER_SIGNAL_SCHEMA);
  assert.equal(ANALYZE_MAX_IMAGE_BYTES, 20 * 1024 * 1024);
  assert.ok(ANALYZE_MAX_BODY_BYTES > ANALYZE_MAX_IMAGE_BYTES);
  assert.equal(GROQ_UPSTREAM_TIMEOUT_MS, 30_000);

  for (const attack of [
    { model: 'attacker-model' },
    { temperature: 1 },
    { seed: 1 },
    { response_format: { type: 'text' } },
  ]) {
    assert.throws(() => validateAnalyzeRequest({
      imageDataUrl: 'data:image/png;base64,AAAA',
      configuredAsset: 'EUR/USD',
      ...attack,
    }), /CLIENT_MODEL_PARAMETERS_FORBIDDEN/);
  }
});

test('Batch 1 P0: security headers are stable', () => {
  const headers = securityHeaders('application/json');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.match(headers['Permissions-Policy'], /display-capture=\(self\)/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
});

test('Batch 1 P0: outbound spy observes zero Groq calls for arbitrary params and a failing native frame', { timeout: 60_000 }, async (t) => {
  const server = await startServer(t);
  const blankPng = await sharp({
    create: { width: 800, height: 360, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();
  const blankDataUrl = 'data:image/png;base64,' + blankPng.toString('base64');

  const arbitrary = await requestJson(server.base, '/api/groq/analyze', {
    method: 'POST',
    headers: server.headers,
    body: JSON.stringify({
      imageDataUrl: blankDataUrl,
      configuredAsset: 'EUR/USD',
      model: 'attacker-selected-model',
      temperature: 1,
      seed: 9,
      response_format: { type: 'text' },
    }),
  });
  assert.equal(arbitrary.response.status, 400);
  assert.equal(arbitrary.body.error, 'CLIENT_MODEL_PARAMETERS_FORBIDDEN');

  const failing = await requestJson(server.base, '/api/groq/analyze', {
    method: 'POST',
    headers: server.headers,
    body: JSON.stringify({
      imageDataUrl: blankDataUrl,
      configuredAsset: 'EUR/USD',
      capturedAt: '2026-09-20T14:00:00.000Z',
    }),
  });
  assert.equal(failing.response.status, 422);
  assert.equal(failing.body.error, 'DETERMINISTIC_GATE_REJECT');
  assert.ok(Array.isArray(failing.body.verification?.reasons));
  assert.ok(failing.body.verification.reasons.length > 0);

  assert.equal(server.stdout().includes('BATCH1_GROQ_SPY_CALLED'), false);
});

test('Batch 1 P0: malformed JSON is 400 and API response carries security headers', { timeout: 30_000 }, async (t) => {
  const server = await startServer(t);

  const malformed = await fetch(server.base + '/api/settings/log', {
    method: 'POST',
    headers: server.headers,
    body: '{"setting":',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'MALFORMED_JSON');

  const health = await fetch(server.base + '/api/health');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.equal(health.headers.get('referrer-policy'), 'no-referrer');
  assert.match(health.headers.get('permissions-policy') || '', /display-capture/);
  assert.match(health.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
});

test('Batch 1 P0: 120 concurrent audit records are linear, duplicate IDs reject, timestamps are server-owned', { timeout: 90_000 }, async (t) => {
  const server = await startServer(t);

  const writes = await Promise.all(Array.from({ length: 120 }, async (_, index) => {
    return requestJson(server.base, '/api/audit/records', {
      method: 'POST',
      headers: server.headers,
      body: JSON.stringify({ record: validRecord(index), artifacts: [] }),
    });
  }));
  assert.equal(writes.filter((item) => item.response.status !== 201).length, 0);

  const verify = await requestJson(server.base, '/api/audit/verify', {
    headers: { 'X-Audit-Token': server.token },
  });
  assert.equal(verify.response.status, 200);
  assert.equal(verify.body.valid, true);
  assert.equal(verify.body.count, 120);
  assert.deepEqual(verify.body.errors, []);

  const recordsPath = path.join(server.dataDir, 'records.ndjson');
  const rows = (await readFile(recordsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(rows.length, 120);
  for (let index = 0; index < rows.length; index += 1) {
    assert.match(rows[index].serverRecordedAt, /^\d{4}-\d\d-\d\dT/);
    assert.match(rows[index].recordHash, /^[a-f0-9]{64}$/);
    assert.equal(rows[index].previousRecordHash, index === 0 ? null : rows[index - 1].recordHash);
    assert.equal(rows[index].durableWrite, 'ok');
    assert.equal('durableStoredAt' in rows[index], false);
  }

  const duplicate = await requestJson(server.base, '/api/audit/records', {
    method: 'POST',
    headers: server.headers,
    body: JSON.stringify({ record: validRecord(0), artifacts: [] }),
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error, 'DUPLICATE_RECORDID');
});

test('Batch 1 P0: server rejects invalid audit schema and detects post-write tampering', { timeout: 30_000 }, async (t) => {
  const server = await startServer(t);

  const forged = validRecord(999);
  forged.gateSnapshot.finalBias = 'CALL';
  const invalid = await requestJson(server.base, '/api/audit/records', {
    method: 'POST',
    headers: server.headers,
    body: JSON.stringify({ record: forged, artifacts: [] }),
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'INVALID_AUDIT_RECORD_SCHEMA');

  const good = await requestJson(server.base, '/api/audit/records', {
    method: 'POST',
    headers: server.headers,
    body: JSON.stringify({ record: validRecord(1000), artifacts: [] }),
  });
  assert.equal(good.response.status, 201);

  const recordsPath = path.join(server.dataDir, 'records.ndjson');
  assert.equal((await verifyHashChain(recordsPath)).valid, true);

  const rows = (await readFile(recordsPath, 'utf8')).trim().split('\n');
  const row = JSON.parse(rows[0]);
  row.layoutReason = 'TAMPERED_AFTER_WRITE';
  rows[0] = JSON.stringify(row);
  await writeFile(recordsPath, rows.join('\n') + '\n', 'utf8');

  const direct = await verifyHashChain(recordsPath);
  assert.equal(direct.valid, false);
  assert.ok(direct.errors.some((item) => item.reason === 'RECORD_HASH_MISMATCH'));

  const endpoint = await requestJson(server.base, '/api/audit/verify', {
    headers: { 'X-Audit-Token': server.token },
  });
  assert.equal(endpoint.response.status, 409);
  assert.equal(endpoint.body.valid, false);
});

test('Batch 1 P0: client sends native frame contract, not model policy', () => {
  const groqSource = fs.readFileSync('src/services/groq.ts', 'utf8');
  assert.match(groqSource, /imageDataUrl:\s*args\.image/);
  assert.match(groqSource, /configuredAsset:\s*args\.configuredAsset/);
  assert.doesNotMatch(groqSource, /body:\s*JSON\.stringify\(\{\s*model:/);
  assert.doesNotMatch(groqSource, /response_format:\s*\{/);

  const appSource = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(appSource, /analyzeChartWithGroq\(\{[\s\S]*?image:\s*analysisImage/);
});

test('Batch 1 P0: source guards keep timeout, native-frame proof, request limits, and coverage lock wired', () => {
  const server = fs.readFileSync('server.mjs', 'utf8');
  const policy = fs.readFileSync('server/batch1Security.mjs', 'utf8');
  const gate = fs.readFileSync('server/deterministicGate.mjs', 'utf8');

  assert.match(server, /const controller = new AbortController\(\)/);
  assert.match(server, /signal: controller\.signal/);
  assert.match(server, /GROQ_UPSTREAM_TIMEOUT_MS/);
  assert.match(server, /validateAnalyzeRequest\(await readJson\(req, ANALYZE_MAX_BODY_BYTES\)\)/);
  assert.match(server, /decoded\.bytes\.length > ANALYZE_MAX_IMAGE_BYTES/);
  assert.match(server, /verifyNativeFrame\(/);
  assert.match(server, /if \(!verification\.eligibleForModel\)/);
  assert.match(server, /fixedGroqPayload\(modelImage\)/);
  assert.match(policy, /CLIENT_MODEL_PARAMETERS_FORBIDDEN/);
  assert.match(policy, /acquireFileLock/);
  assert.match(policy, /DUPLICATE_/);
  assert.match(policy, /RECORD_HASH_MISMATCH/);
  assert.match(gate, /VALIDATION_COVERAGE_COMPLETE = false/);
  assert.match(gate, /TIMEFRAME_TEMPLATE_THRESHOLD = 0\.985/);
  assert.match(gate, /CHARTTYPE_THRESHOLD = 0\.92/);
  assert.match(gate, /PRICE_AXIS_R2_MIN = 0\.995/);
});
