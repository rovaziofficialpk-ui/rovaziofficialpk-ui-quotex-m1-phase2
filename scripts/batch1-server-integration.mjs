import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { verifyHashChain } from '../server/batch1Security.mjs';

const dataDir = await mkdtemp(path.join(tmpdir(), 'quotex-batch1-probe-'));
const port = 43272;
const token = 'batch1-probe-token';
const child = spawn(process.execPath, ['--import', './tests/batch1-groq-fetch-spy.mjs', 'server.mjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    AUDIT_DATA_DIR: dataDir,
    AUDIT_AUTH_TOKEN: token,
    GROQ_API_KEY: 'probe-key',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });
const base = 'http://127.0.0.1:' + port;
const headers = { 'X-Audit-Token': token, 'Content-Type': 'application/json' };

async function waitReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('SERVER_NOT_READY');
}

async function call(pathname, init = {}) {
  const r = await fetch(base + pathname, init);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, headers: Object.fromEntries(r.headers.entries()) };
}

const result = {
  probeVersion: 'batch1-server-integration-v1',
  arbitraryPayloadStatus: null,
  failingGateStatus: null,
  outboundGroqCalls: null,
  malformedJsonStatus: null,
  securityHeadersPresent: null,
  concurrencyWrites: 120,
  concurrencyNon201: null,
  hashChainBrokenLinks: null,
  hashChainStrictlyLinear: null,
  tamperDetected: null,
};

try {
  await waitReady();
  const health = await call('/api/health');
  result.securityHeadersPresent = health.headers['x-frame-options'] === 'DENY'
    && health.headers['x-content-type-options'] === 'nosniff'
    && Boolean(health.headers['content-security-policy']);

  const blank = await sharp({
    create: { width: 800, height: 360, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();
  const imageDataUrl = 'data:image/png;base64,' + blank.toString('base64');

  const arbitrary = await call('/api/groq/analyze', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      imageDataUrl,
      configuredAsset: 'EUR/USD',
      model: 'attacker-model',
      temperature: 1,
      seed: 1,
      response_format: { type: 'text' },
    }),
  });
  result.arbitraryPayloadStatus = arbitrary.status;

  const failing = await call('/api/groq/analyze', {
    method: 'POST',
    headers,
    body: JSON.stringify({ imageDataUrl, configuredAsset: 'EUR/USD', capturedAt: new Date().toISOString() }),
  });
  result.failingGateStatus = failing.status;

  const malformed = await fetch(base + '/api/settings/log', {
    method: 'POST',
    headers,
    body: '{"setting":',
  });
  result.malformedJsonStatus = malformed.status;

  const writes = [];
  for (let index = 0; index < 120; index += 1) {
    writes.push(call('/api/outcomes/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventId: 'reconcile-event-' + index,
        tradeId: 'reconcile-trade-' + index,
        eventType: 'ARMED',
        payload: { direction: 'CALL', dueAt: new Date(Date.now() + 60_000).toISOString(), entry: { index } },
      }),
    }));
  }
  const responses = await Promise.all(writes);
  result.concurrencyNon201 = responses.filter((item) => item.status !== 201).length;

  const chain = await verifyHashChain(path.join(dataDir, 'outcome-events.ndjson'));
  result.hashChainBrokenLinks = chain.errors.filter((item) => item.reason === 'PREVIOUS_HASH_MISMATCH').length;
  result.hashChainStrictlyLinear = chain.valid;

  const record = {
    schemaVersion: 'decision-record-v1',
    recordId: 'tamper-record-0001',
    configVersion: 'input-pipeline-v1.6.0',
    promptVersion: 'vision-signal-v4.0.0',
    modelName: 'qwen/qwen3.8-27b',
    temperature: 0,
    seed: 424242,
    seedReason: null,
    systemFingerprint: null,
    capturedAt: new Date().toISOString(),
    decisionAt: new Date().toISOString(),
    source: 'live_tab',
    captureEnvironment: null,
    configuredTimeframe: 'M1',
    layoutProfileVersion: 'quotex-desktop-observed-v1.3.0',
    layoutReason: 'PROBE',
    deterministicScreen: { safeForAi: false },
    rawModelResponseText: null,
    modelCallSkippedReason: 'LAYOUT_VALIDATION_INCOMPLETE',
    preflight: {},
    gateSnapshot: { modelProposedBias: 'NEUTRAL', preAuditBias: 'NEUTRAL', finalBias: 'NEUTRAL', finalReason: 'AUDIT_LOCK' },
    timingsMs: { capture: 0, preflight: 0, deterministicScreen: 0, aiCall: null, gates: 0, totalCaptureToDecision: 0 },
    nullReasons: {},
    durableWrite: 'pending',
    createdAt: new Date().toISOString(),
  };
  await call('/api/audit/records', { method: 'POST', headers, body: JSON.stringify({ record, artifacts: [] }) });
  const recordsPath = path.join(dataDir, 'records.ndjson');
  const line = (await fs.readFile(recordsPath, 'utf8')).trim();
  const stored = JSON.parse(line);
  stored.layoutReason = 'TAMPERED';
  await fs.writeFile(recordsPath, JSON.stringify(stored) + '\n', 'utf8');
  const verify = await call('/api/audit/verify', { headers: { 'X-Audit-Token': token } });
  result.tamperDetected = verify.status === 409 && verify.body?.valid === false;

  result.outboundGroqCalls = stdout.split('\n').filter((line) => line.startsWith('BATCH1_GROQ_SPY_CALLED')).length;
  console.log(JSON.stringify(result, null, 2));
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await fs.rm(dataDir, { recursive: true, force: true });
  if (child.exitCode && child.exitCode !== 0) {
    process.stderr.write(stderr);
  }
}
