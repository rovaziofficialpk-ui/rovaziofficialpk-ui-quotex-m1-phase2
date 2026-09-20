import { createServer, get as httpGet } from 'node:http';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ANALYZE_MAX_BODY_BYTES,
  ANALYZE_MAX_IMAGE_BYTES,
  GROQ_UPSTREAM_TIMEOUT_MS,
  appendSerializedHashedRecord,
  fixedGroqPayload,
  malformedJsonError,
  securityHeaders,
  validateAnalyzeRequest,
  validateAuditArtifactEnvelope,
  validateDecisionRecord,
  verifyHashChain,
} from './server/batch1Security.mjs';
import { buildModelPrimaryDataUrl, verifyNativeFrame } from './server/deterministicGate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const DATA_ROOT = process.env.AUDIT_DATA_DIR || '/data/audit';
const RECORDS_FILE = path.join(DATA_ROOT, 'records.ndjson');
const SETTINGS_FILE = path.join(DATA_ROOT, 'settings.ndjson');
const OUTCOME_EVENTS_FILE = path.join(DATA_ROOT, 'outcome-events.ndjson');
const IMAGES_DIR = path.join(DATA_ROOT, 'images');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const AUDIT_AUTH_TOKEN = String(process.env.AUDIT_AUTH_TOKEN || '');
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || '');
const TESSERACT_AVAILABLE = spawnSync('tesseract', ['--version'], { stdio: 'ignore' }).status === 0;

await fs.mkdir(IMAGES_DIR, { recursive: true });

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    ...securityHeaders('application/json; charset=utf-8'),
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...securityHeaders(contentType),
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('REQUEST_BODY_TOO_LARGE'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw malformedJsonError();
  }
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function authorized(req) {
  if (!AUDIT_AUTH_TOKEN) return false;
  const supplied = String(req.headers['x-audit-token'] || '');
  return safeEqual(supplied, AUDIT_AUTH_TOKEN);
}

function requireAuth(req, res) {
  if (!AUDIT_AUTH_TOKEN) {
    sendJson(res, 503, { ok: false, error: 'AUDIT_AUTH_NOT_CONFIGURED' });
    return false;
  }
  if (!authorized(req)) {
    sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    return false;
  }
  return true;
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!match) throw Object.assign(new Error('Artifact must be a base64 data URL.'), { statusCode: 400 });
  return { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') };
}

function extensionFor(mimeType) {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.bin';
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function appendHashedRecord(file, value, options = {}) {
  return appendSerializedHashedRecord(file, value, options);
}

async function readNdjson(file, maxRecords = 5000) {
  try {
    const text = await fs.readFile(file, 'utf8');
    const rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return rows.slice(-Math.max(1, maxRecords));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}


async function appendAuditPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.record || !Array.isArray(payload.artifacts)) {
    throw Object.assign(new Error('Expected { record, artifacts[] }.'), { statusCode: 400 });
  }
  validateDecisionRecord(payload.record);
  const recordId = String(payload.record.recordId || '');
  if (payload.artifacts.length > 32) throw Object.assign(new Error('TOO_MANY_AUDIT_ARTIFACTS'), { statusCode: 400 });

  const storedArtifacts = [];
  for (const artifact of payload.artifacts) {
    validateAuditArtifactEnvelope(artifact);
    const { mimeType, bytes } = decodeDataUrl(artifact.dataUrl);
    const actualSha = sha256(bytes);
    if (artifact.sha256 && artifact.sha256 !== actualSha) {
      throw Object.assign(new Error(`Artifact hash mismatch for ${artifact.role || 'unknown'}.`), { statusCode: 409 });
    }
    const filename = `${actualSha}${extensionFor(mimeType)}`;
    const filepath = path.join(IMAGES_DIR, filename);
    try {
      await fs.writeFile(filepath, bytes, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    storedArtifacts.push({
      role: artifact.role ?? null,
      sha256: actualSha,
      mimeType,
      byteLength: bytes.length,
      file: `images/${filename}`,
      cropRect: artifact.cropRect ?? null,
      sourceFrameSize: artifact.sourceFrameSize ?? null,
      sourceFrameSha256: artifact.sourceFrameSha256 ?? null,
      capturedAt: artifact.capturedAt ?? null,
      privacyMasked: Boolean(artifact.privacyMasked),
    });
  }

  return appendHashedRecord(RECORDS_FILE, {
    ...payload.record,
    durableWrite: 'ok',
    artifacts: storedArtifacts,
  }, { uniqueField: 'recordId' });
}

async function replayRecent(limit) {
  let rows = [];
  try {
    const text = await fs.readFile(RECORDS_FILE, 'utf8');
    rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const selected = rows.slice(-Math.max(1, Math.min(100, limit)));
  return selected.map((record) => {
    const snapshot = record.gateSnapshot || null;
    const replayedFinalBias = 'NEUTRAL';
    return {
      recordId: record.recordId ?? null,
      storedFinalBias: snapshot?.finalBias ?? null,
      replayedFinalBias,
      same: snapshot?.finalBias === replayedFinalBias,
      finalReason: snapshot?.finalReason ?? null,
    };
  });
}

const OCR_MODES = {
  asset: { psm: '11', whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ/() -' },
  asset_payout: { psm: '11', whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ/() -0123456789%' },
  clock: { psm: '11', whitelist: '0123456789:UTC ' },
  time_axis: { psm: '11', whitelist: '0123456789:' },
  price_axis: { psm: '11', whitelist: '0123456789.' },
  trade_fields: { psm: '11', whitelist: '0123456789:%.$ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ' },
  timeframe: { psm: '11', whitelist: '0123456789mM' },
};

function runTesseract(imageBytes, mode) {
  const config = OCR_MODES[mode];
  if (!config) throw Object.assign(new Error('Unsupported OCR mode.'), { statusCode: 400 });
  const tmp = path.join(os.tmpdir(), `quotex-ocr-${crypto.randomUUID()}.png`);
  return fs.writeFile(tmp, imageBytes, { mode: 0o600 }).then(() => new Promise((resolve, reject) => {
    const args = [
      tmp,
      'stdout',
      '--psm', config.psm,
      '-l', 'eng',
      '-c', `tessedit_char_whitelist=${config.whitelist}`,
      'tsv',
    ];
    const child = spawn('tesseract', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', async (code) => {
      await fs.unlink(tmp).catch(() => undefined);
      if (code !== 0) {
        reject(Object.assign(new Error('OCR_ENGINE_FAILED'), { statusCode: 503, detail: Buffer.concat(stderr).toString('utf8').slice(0, 300) }));
        return;
      }
      const tsv = Buffer.concat(stdout).toString('utf8');
      const lines = tsv.split(/\r?\n/).filter(Boolean);
      const header = lines.shift()?.split('\t') || [];
      const tokens = [];
      for (const line of lines) {
        const cols = line.split('\t');
        if (cols.length < 12) continue;
        const row = Object.fromEntries(header.map((key, index) => [key, cols[index] ?? '']));
        const text = String(row.text || '').trim();
        if (!text) continue;
        const conf = Number(row.conf);
        tokens.push({
          text,
          confidence: Number.isFinite(conf) ? conf : -1,
          left: Number(row.left) || 0,
          top: Number(row.top) || 0,
          width: Number(row.width) || 0,
          height: Number(row.height) || 0,
        });
      }
      resolve({
        rawText: tokens.map((token) => token.text).join(' '),
        tokens,
        engine: 'tesseract-5',
        psm: Number(config.psm),
      });
    });
  }));
}

async function proxyGroq(payload) {
  if (!GROQ_API_KEY) throw Object.assign(new Error('GROQ_SERVER_KEY_NOT_CONFIGURED'), { statusCode: 503 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    return { status: response.status, contentType: response.headers.get('content-type') || 'application/json; charset=utf-8', text };
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('GROQ_UPSTREAM_TIMEOUT'), { statusCode: 504 });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  let target = path.resolve(DIST_DIR, '.' + rel);
  if (!target.startsWith(path.resolve(DIST_DIR))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    target = path.join(DIST_DIR, 'index.html');
  }
  try {
    const stat = await fs.stat(target);
    res.writeHead(200, {
      ...securityHeaders(MIME[path.extname(target).toLowerCase()] || 'application/octet-stream'),
      'Content-Length': stat.size,
      'Cache-Control': path.basename(target) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        durableAudit: true,
        authConfigured: Boolean(AUDIT_AUTH_TOKEN),
        groqConfigured: Boolean(GROQ_API_KEY),
        ocrConfigured: TESSERACT_AVAILABLE,
        auditLock: true,
      });
    }

    if (url.pathname === '/api/auth/check') {
      if (!requireAuth(req, res)) return;
      return sendJson(res, 200, { ok: true, authenticated: true, groqConfigured: Boolean(GROQ_API_KEY) });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!requireAuth(req, res)) return;

      if (req.method === 'GET' && url.pathname === '/api/time') {
        return sendJson(res, 200, { ok: true, serverUnixMs: Date.now(), serverUtc: new Date().toISOString() });
      }

      if (req.method === 'POST' && url.pathname === '/api/audit/records') {
        const payload = await readJson(req);
        const stored = await appendAuditPayload(payload);
        return sendJson(res, 201, { ok: true, recordId: stored.recordId, recordHash: stored.recordHash, artifacts: stored.artifacts });
      }

      if (req.method === 'GET' && url.pathname === '/api/audit/replay') {
        const limit = Number(url.searchParams.get('limit') || 5);
        const rows = await replayRecent(limit);
        return sendJson(res, 200, { ok: true, count: rows.length, allSame: rows.length > 0 && rows.every((row) => row.same), rows });
      }

      if (req.method === 'GET' && url.pathname === '/api/audit/verify') {
        const result = await verifyHashChain(RECORDS_FILE);
        return sendJson(res, result.valid ? 200 : 409, { ok: result.valid, ...result });
      }

      if (req.method === 'POST' && url.pathname === '/api/settings/log') {
        const body = await readJson(req);
        const entry = await appendHashedRecord(SETTINGS_FILE, {
          schemaVersion: 'settings-change-v1',
          timestamp: new Date().toISOString(),
          setting: typeof body.setting === 'string' ? body.setting : null,
          oldValue: body.oldValue ?? null,
          newValue: body.newValue ?? null,
          configVersion: typeof body.configVersion === 'string' ? body.configVersion : null,
        });
        return sendJson(res, 201, { ok: true, recordHash: entry.recordHash });
      }

      if (req.method === 'POST' && url.pathname === '/api/outcomes/events') {
        const body = await readJson(req);
        const eventId = typeof body.eventId === 'string' ? body.eventId : '';
        const tradeId = typeof body.tradeId === 'string' ? body.tradeId : '';
        const eventType = typeof body.eventType === 'string' ? body.eventType : '';
        if (!eventId || !tradeId || !['ARMED', 'EXPIRED', 'MANUAL_OUTCOME'].includes(eventType)) {
          return sendJson(res, 400, { ok: false, error: 'INVALID_OUTCOME_EVENT' });
        }
        const entry = await appendHashedRecord(OUTCOME_EVENTS_FILE, {
          ...body,
        }, { uniqueField: 'eventId' });
        return sendJson(res, 201, { ok: true, eventId, tradeId, recordHash: entry.recordHash });
      }

      if (req.method === 'GET' && url.pathname === '/api/outcomes/events') {
        const events = await readNdjson(OUTCOME_EVENTS_FILE, 5000);
        return sendJson(res, 200, { ok: true, count: events.length, events });
      }


      if (req.method === 'POST' && url.pathname === '/api/ocr') {
        if (!TESSERACT_AVAILABLE) return sendJson(res, 503, { ok: false, error: 'OCR_ENGINE_NOT_AVAILABLE' });
        const body = await readJson(req);
        const decoded = decodeDataUrl(body.imageDataUrl);
        if (!decoded.mimeType.startsWith('image/')) throw Object.assign(new Error('OCR requires an image.'), { statusCode: 400 });
        const result = await runTesseract(decoded.bytes, String(body.mode || ''));
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (req.method === 'POST' && url.pathname === '/api/groq/analyze') {
        const body = validateAnalyzeRequest(await readJson(req, ANALYZE_MAX_BODY_BYTES));
        const decoded = decodeDataUrl(body.imageDataUrl);
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(decoded.mimeType)) {
          return sendJson(res, 400, { ok: false, error: 'INVALID_NATIVE_FRAME_TYPE' });
        }
        if (decoded.bytes.length > ANALYZE_MAX_IMAGE_BYTES) {
          return sendJson(res, 413, { ok: false, error: 'NATIVE_FRAME_TOO_LARGE' });
        }
        const verification = await verifyNativeFrame({
          imageBytes: decoded.bytes,
          configuredAsset: body.configuredAsset,
          capturedAt: body.capturedAt,
          runOcr: TESSERACT_AVAILABLE ? runTesseract : null,
          templatesDir: path.join(DIST_DIR, 'templates'),
        });
        if (!verification.eligibleForModel) {
          return sendJson(res, 422, {
            ok: false,
            error: 'DETERMINISTIC_GATE_REJECT',
            reasonCode: verification.blockReason,
            verification,
          });
        }
        const modelImage = await buildModelPrimaryDataUrl(decoded.bytes, verification.rects.primary);
        const result = await proxyGroq(fixedGroqPayload(modelImage));
        return sendText(res, result.status, result.text, result.contentType);
      }

      if (req.method === 'POST' && url.pathname === '/api/groq/test') {
        const result = await proxyGroq({
          model: 'qwen/qwen3.8-27b',
          messages: [{ role: 'user', content: 'Say "OK" only.' }],
          max_tokens: 5,
          reasoning_effort: 'none',
          temperature: 0,
          seed: 424242,
        });
        return sendText(res, result.status, result.text, result.contentType);
      }

      return sendJson(res, 404, { ok: false, error: 'Unknown API route.' });
    }

    return serveStatic(req, res);
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    return sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : 'Server error.',
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`quotex audit server listening on :${PORT}`);
  console.log(`audit storage: ${DATA_ROOT}`);
  console.log(`audit auth configured: ${Boolean(AUDIT_AUTH_TOKEN)}`);
  console.log(`server-side Groq configured: ${Boolean(GROQ_API_KEY)}`);
  console.log(`tesseract available: ${TESSERACT_AVAILABLE}`);
});
