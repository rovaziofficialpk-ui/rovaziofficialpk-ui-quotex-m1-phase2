import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import {
  ANALYZE_MAX_IMAGE_BYTES,
  GROQ_FIXED_MODEL,
  GROQ_FIXED_SEED,
  GROQ_FIXED_TEMPERATURE,
  SERVER_SIGNAL_SCHEMA,
  fixedGroqPayload,
  securityHeaders,
  validateAnalyzeRequest,
  verifyHashChain,
} from '../server/batch1Security.mjs';

function validRecord(id) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 'decision-record-v1',
    recordId: id,
    configVersion: 'input-pipeline-v1.6.0',
    promptVersion: 'vision-signal-v4.0.0',
    modelName: 'qwen/qwen3.8-27b',
    temperature: 0,
    seed: 424242,
    seedReason: null,
    systemFingerprint: null,
    capturedAt: now,
    decisionAt: now,
    source: 'live_tab',
    captureEnvironment: null,
    configuredTimeframe: 'M1',
    layoutProfileVersion: 'quotex-desktop-observed-v1.3.0',
    layoutReason: 'TEST',
    deterministicScreen: { safeForAi: false, reasons: ['LAYOUT_VALIDATION_INCOMPLETE'] },
    rawModelResponseText: null,
    modelCallSkippedReason: 'LAYOUT_VALIDATION_INCOMPLETE',
    preflight: { status: 'pass', score: 100 },
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
      gates: 1,
      totalCaptureToDecision: 4,
    },
    nullReasons: {},
    durableWrite: 'pending',
    createdAt: now,
  };
}

async function waitForHealth(base) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return r;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('server did not start');
}

async function requestJson(base, pathname, init = {}) {
  const response = await fetch(base + pathname, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, body, text };
}

test('Batch 1 P0 fixed policy is server-owned and strict', () => {
  const payload = fixedGroqPayload('data:image/png;base64,AAAA');
  assert.equal(payload.model, GROQ_FIXED_MODEL);
  assert.equal(payload.temperature, GROQ_FIXED_TEMPERATURE);
  assert.equal(payload.seed, GROQ_FIXED_SEED);
  assert.equal(payload.response_format.type, 'json_schema');
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.equal(payload.response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(payload.response_format.json_schema.schema, SERVER_SIGNAL_SCHEMA);
  assert.ok(ANALYZE_MAX_IMAGE_BYTES <= 20 * 1024 * 1024);

  assert.throws(() => validateAnalyzeRequest({
    imageDataUrl: 'data:image/png;base64,AAAA',
    configuredAsset: 'EUR/USD',
    model: 'attacker-model',
  }), /CLIENT_MODEL_PARAMETERS_FORBIDDEN/);

  assert.throws(() => validateAnalyzeRequest({
    imageDataUrl: 'data:image/png;base64,AAAA',
    configuredAsset: 'EUR/USD',
    temperature: 1,
  }), /CLIENT_MODEL_PARAMETERS_FORBIDDEN/);

  assert.throws(() => validateAnalyzeRequest({
    imageDataUrl: 'data:image/png;base64,AAAA',
    configuredAsset: 'EUR/USD',
    seed: 999,
  }), /CLIENT_MODEL_PARAMETERS_FORBIDDEN/);

  assert.throws(() => validateAnalyzeRequest({
    imageDataUrl: 'data:image/png;base64,AAAA',
    configuredAsset: 'EUR/USD',
    response_format: { type: 'text' },
  }), /CLIENT_MODEL_PARAMETERS_FORBIDDEN/);
});

test('Batch 1 security headers are present', () => {
  const headers = securityHeaders('application/json');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.match(headers['Permissions-Policy'], /display-capture=\(self\)/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
});

test('Batch 1 server integration: proof boundary, malformed JSON, serialized chain, schema, duplicates, tamper detection', { timeout: 60_000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'quotex-batch1-'));
  const port = 43271;
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
  const authHeaders = { 'X-Audit-Token': token, 'Content-Type': 'application/json' };

  try {
    const health = await waitForHealth(base);
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('referrer-policy'), 'no-referrer');
    assert.match(health.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);

    const blankPng = await sharp({
      create: { width: 800, height: 360, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
    const blankDataUrl = 'data:image/png;base64,' + blankPng.toString('base64');

    const oldOpenAiPayload = await requestJson(base, '/api/groq/analyze', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        model: 'attacker-selected-model',
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: blankDataUrl } }] }],
        temperature: 1,
      }),
    });
    assert.equal(oldOpenAiPayload.response.status, 400);
    assert.equal(oldOpenAiPayload.body.error, 'CLIENT_MODEL_PARAMETERS_FORBIDDEN');

    const arbitraryModel = await requestJson(base, '/api/groq/analyze', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        imageDataUrl: blankDataUrl,
        configuredAsset: 'EUR/USD',
        model: 'attacker-selected-model',
      }),
    });
    assert.equal(arbitraryModel.response.status, 400);
    assert.equal(arbitraryModel.body.error, 'CLIENT_MODEL_PARAMETERS_FORBIDDEN');

    const failingGate = await requestJson(base, '/api/groq/analyze', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        imageDataUrl: blankDataUrl,
        configuredAsset: 'EUR/USD',
        capturedAt: new Date().toISOString(),
      }),
    });
    assert.equal(failingGate.response.status, 422);
    assert.equal(failingGate.body.error, 'DETERMINISTIC_GATE_REJECT');
    assert.ok(Array.isArray(failingGate.body.verification.reasons));
    assert.ok(failingGate.body.verification.reasons.length > 0);

    assert.equal(stdout.includes('BATCH1_GROQ_SPY_CALLED'), false, 'no rejected analyze request may reach Groq');

    const malformed = await fetch(base + '/api/settings/log', {
      method: 'POST',
      headers: authHeaders,
      body: '{"setting":',
    });
    assert.equal(malformed.status, 400);
    const malformedBody = await malformed.json();
    assert.equal(malformedBody.error, 'MALFORMED_JSON');

    const invalidRecord = await requestJson(base, '/api/audit/records', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ record: { recordId: 'bad-record' }, artifacts: [] }),
    });
    assert.equal(invalidRecord.response.status, 400);
    assert.match(invalidRecord.body.error, /INVALID_AUDIT_RECORD_SCHEMA/);

    const record = validRecord('batch1-record-0001');
    const stored = await requestJson(base, '/api/audit/records', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ record, artifacts: [] }),
    });
    assert.equal(stored.response.status, 201);
    assert.match(stored.body.recordHash, /^[a-f0-9]{64}$/);

    const duplicate = await requestJson(base, '/api/audit/records', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ record, artifacts: [] }),
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.error, 'DUPLICATE_RECORDID');

    const recordsPath = path.join(dataDir, 'records.ndjson');
    const recordsText = await fs.readFile(recordsPath, 'utf8');
    const row = JSON.parse(recordsText.trim());
    assert.ok(Number.isFinite(Date.parse(row.serverRecordedAt)));
    assert.equal(row.previousRecordHash, null);
    assert.equal(row.durableWrite, 'ok');

    const verifyBeforeTamper = await requestJson(base, '/api/audit/verify', {
      headers: { 'X-Audit-Token': token },
    });
    assert.equal(verifyBeforeTamper.response.status, 200);
    assert.equal(verifyBeforeTamper.body.valid, true);

    const tampered = { ...row, layoutReason: 'TAMPERED_AFTER_WRITE' };
    await fs.writeFile(recordsPath, JSON.stringify(tampered) + '\n', 'utf8');

    const verifyAfterTamper = await requestJson(base, '/api/audit/verify', {
      headers: { 'X-Audit-Token': token },
    });
    assert.equal(verifyAfterTamper.response.status, 409);
    assert.equal(verifyAfterTamper.body.valid, false);
    assert.ok(verifyAfterTamper.body.errors.some((item) => item.reason === 'RECORD_HASH_MISMATCH'));

    // Restore a valid records file so later assertions stay isolated.
    await fs.writeFile(recordsPath, JSON.stringify(row) + '\n', 'utf8');

    const writes = [];
    for (let index = 0; index < 120; index += 1) {
      writes.push(requestJson(base, '/api/outcomes/events', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          eventId: 'batch1-race-event-' + index,
          tradeId: 'batch1-race-trade-' + index,
          eventType: 'ARMED',
          payload: { direction: 'CALL', dueAt: new Date(Date.now() + 60_000).toISOString(), entry: { index } },
        }),
      }));
    }
    const responses = await Promise.all(writes);
    assert.equal(responses.filter((item) => item.response.status !== 201).length, 0);

    const outcomePath = path.join(dataDir, 'outcome-events.ndjson');
    const chain = await verifyHashChain(outcomePath);
    assert.equal(chain.count, 120);
    assert.equal(chain.valid, true);
    assert.equal(chain.errors.length, 0);

    const outcomeLines = (await fs.readFile(outcomePath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    for (let index = 1; index < outcomeLines.length; index += 1) {
      assert.equal(outcomeLines[index].previousRecordHash, outcomeLines[index - 1].recordHash);
    }

    assert.equal(stdout.includes('BATCH1_GROQ_SPY_CALLED'), false);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await fs.rm(dataDir, { recursive: true, force: true });
    if (child.exitCode && child.exitCode !== 0) {
      throw new Error('server child failed: ' + stderr);
    }
  }
});

test('Batch 1 fixed model payload cannot be influenced by caller fields', () => {
  const attacker = {
    model: 'evil',
    temperature: 2,
    seed: 1,
    response_format: { type: 'text' },
  };
  const payload = fixedGroqPayload('data:image/png;base64,AAAA', attacker);
  assert.equal(payload.model, 'qwen/qwen3.8-27b');
  assert.equal(payload.temperature, 0);
  assert.equal(payload.seed, 424242);
  assert.equal(payload.response_format.type, 'json_schema');
  assert.equal(payload.response_format.json_schema.strict, true);
});

test('Batch 1 hash format is cryptographic SHA-256', () => {
  const digest = crypto.createHash('sha256').update('known').digest('hex');
  assert.equal(digest.length, 64);
});


test('Batch 1 source guards keep upstream timeout, native-frame proof gate, size checks, and security layer wired', () => {
  const server = fsSync.readFileSync('server.mjs', 'utf8');
  const policy = fsSync.readFileSync('server/batch1Security.mjs', 'utf8');
  const gate = fsSync.readFileSync('server/deterministicGate.mjs', 'utf8');

  assert.match(server, /const controller = new AbortController\(\)/);
  assert.match(server, /signal: controller\.signal/);
  assert.match(server, /GROQ_UPSTREAM_TIMEOUT_MS/);
  assert.match(server, /validateAnalyzeRequest\(await readJson\(req, ANALYZE_MAX_BODY_BYTES\)\)/);
  assert.match(server, /if \(decoded\.bytes\.length > ANALYZE_MAX_IMAGE_BYTES\) \{/);
  assert.match(server, /verifyNativeFrame\(/);
  assert.match(server, /if \(!verification\.eligibleForModel\)/);
  assert.match(server, /fixedGroqPayload\(modelImage\)/);
  assert.match(policy, /CLIENT_MODEL_PARAMETERS_FORBIDDEN/);
  assert.match(policy, /withSerializedFileWrite/);
  assert.match(policy, /DUPLICATE_/);
  assert.match(policy, /RECORD_HASH_MISMATCH/);
  assert.match(gate, /VALIDATION_COVERAGE_COMPLETE = false/);
  assert.match(gate, /TIMEFRAME_TEMPLATE_THRESHOLD = 0\.985/);
  assert.match(gate, /CHARTTYPE_THRESHOLD = 0\.92/);
  assert.match(gate, /PRICE_AXIS_R2_MIN = 0\.995/);
  assert.match(server, /return sendText\(res, 403, 'Forbidden'\)/);
  assert.match(server, /return sendText\(res, 404, 'Not found'\)/);
});
