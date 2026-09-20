import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const DATA_ROOT = process.env.AUDIT_DATA_DIR || '/data/audit';
const RECORDS_FILE = path.join(DATA_ROOT, 'records.ndjson');
const IMAGES_DIR = path.join(DATA_ROOT, 'images');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 32 * 1024 * 1024;

await fs.mkdir(IMAGES_DIR, { recursive: true });

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text || '{}');
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

async function lastRecordHash() {
  try {
    const text = await fs.readFile(RECORDS_FILE, 'utf8');
    const lines = text.trim().split('\n').filter(Boolean);
    if (!lines.length) return null;
    const last = JSON.parse(lines.at(-1));
    return typeof last.recordHash === 'string' ? last.recordHash : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function appendAuditPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.record || !Array.isArray(payload.artifacts)) {
    throw Object.assign(new Error('Expected { record, artifacts[] }.'), { statusCode: 400 });
  }
  const recordId = String(payload.record.recordId || '');
  if (!recordId) throw Object.assign(new Error('recordId is required.'), { statusCode: 400 });

  const storedArtifacts = [];
  for (const artifact of payload.artifacts) {
    const { mimeType, bytes } = decodeDataUrl(artifact.dataUrl);
    const actualSha = sha256(bytes);
    if (artifact.sha256 && artifact.sha256 !== actualSha) {
      throw Object.assign(new Error(`Artifact hash mismatch for ${artifact.role || 'unknown'}.`), { statusCode: 409 });
    }
    const filename = `${actualSha}${extensionFor(mimeType)}`;
    const filepath = path.join(IMAGES_DIR, filename);
    try {
      await fs.writeFile(filepath, bytes, { flag: 'wx' });
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
    });
  }

  const previousRecordHash = await lastRecordHash();
  const baseRecord = {
    ...payload.record,
    artifacts: storedArtifacts,
    durableStoredAt: new Date().toISOString(),
    previousRecordHash,
  };
  const recordHash = sha256(Buffer.from(JSON.stringify(baseRecord)));
  const finalRecord = { ...baseRecord, recordHash };
  await fs.appendFile(RECORDS_FILE, JSON.stringify(finalRecord) + '\n', 'utf8');
  return { recordId, recordHash, artifacts: storedArtifacts };
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
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
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
        auditStorage: DATA_ROOT,
        durableAudit: true,
        groqConfigured: Boolean(process.env.GROQ_API_KEY),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/audit/records') {
      const payload = await readJson(req);
      const stored = await appendAuditPayload(payload);
      return sendJson(res, 201, { ok: true, ...stored });
    }
    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: 'Unknown API route.' });
    }
    return serveStatic(req, res);
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    return sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : 'Server error.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`quotex audit server listening on :${PORT}`);
  console.log(`audit storage: ${DATA_ROOT}`);
  console.log(`GROQ_API_KEY configured: ${Boolean(process.env.GROQ_API_KEY)}`);
});
