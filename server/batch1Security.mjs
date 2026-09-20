import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';

export const GROQ_FIXED_MODEL = 'qwen/qwen3.8-27b';
export const GROQ_FIXED_TEMPERATURE = 0;
export const GROQ_FIXED_SEED = 424242;
export const GROQ_FIXED_MAX_TOKENS = 850;
export const GROQ_UPSTREAM_TIMEOUT_MS = 30_000;
export const ANALYZE_MAX_BODY_BYTES = 28 * 1024 * 1024;
export const ANALYZE_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const SERVER_SIGNAL_SCHEMA = {
  type: 'object',
  properties: {
    pair: { type: 'string' },
    bias: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    pattern: { type: 'string' },
    entry: { type: 'string' },
    chartQuality: { type: 'string', enum: ['clear', 'usable', 'poor'] },
    timeframe: { type: 'string', enum: ['M1', 'other', 'unknown'] },
    trend: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'unclear'] },
    momentum: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'unclear'] },
    structure: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'unclear'] },
    candleSignal: { type: 'string', enum: ['bullish', 'bearish', 'indecision', 'none'] },
    supportResistance: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    contextAlignment: { type: 'string', enum: ['aligned', 'mixed', 'conflicting', 'not_provided'] },
    contextNotes: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'pair', 'bias', 'confidence', 'pattern', 'entry', 'chartQuality', 'timeframe',
    'trend', 'momentum', 'structure', 'candleSignal', 'supportResistance', 'evidence',
    'contextAlignment', 'contextNotes', 'warnings',
  ],
  additionalProperties: false,
};

export const SERVER_SYSTEM_PROMPT = "You analyze trading-chart screenshots for educational technical-analysis purposes. Focus on visible evidence only and be conservative.\n\nThe FIRST image is always the primary M1 chart. Additional images, when supplied, are optional higher-timeframe context and are explicitly labeled M5 or H1 in the user message.\n\nFor the primary M1 chart:\n- CALL only when visible price action supports a bullish setup.\n- PUT only when visible price action supports a bearish setup.\n- NEUTRAL when evidence is weak, conflicting, mid-range, blurry, cropped, or lacks usable context.\n- Detect whether the primary screenshot visibly appears to be M1. If another timeframe is visible, set timeframe to \"other\". If you cannot verify it, set timeframe to \"unknown\".\n- Set chartQuality to \"poor\" when candles, labels, or recent price action are too blurry/cropped to analyze reliably.\n- confidence is AI setup-confidence from 0-100 based only on visible chart evidence. It is NOT a measured probability of trade success.\n\nIndependent evidence fields:\n- trend: directional trend visible on the primary chart.\n- momentum: short-term momentum visible on the primary chart.\n- structure: swing/high-low or range structure visible on the primary chart.\n- candleSignal: latest relevant candle/candlestick evidence.\nDo NOT force these fields to agree with the proposed bias. Report each independently from visible evidence.\n\nOther fields:\n- supportResistance: briefly state the most relevant visible support/resistance or say no reliable level is visible.\n- evidence: short concrete observations from the screenshot; do not invent indicators or levels that are not visible.\n- contextAlignment: if no context screenshots were supplied use \"not_provided\". Otherwise compare M5/H1 context with the M1 proposal and choose aligned, mixed, or conflicting.\n- contextNotes: briefly explain the higher-timeframe relationship, or say no context was provided.\n- warnings: important limitations visible in the screenshots.\n\nFor weak or unclear setups choose NEUTRAL rather than inventing certainty. Identify the asset/pair only if visible; otherwise use \"Unknown Asset\".\nReturn only the fields required by the supplied JSON schema.";

export function fixedGroqPayload(imageDataUrl) {
  return {
    model: GROQ_FIXED_MODEL,
    messages: [
      { role: 'system', content: SERVER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this server-verified native M1 chart frame.' },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    reasoning_effort: 'none',
    temperature: GROQ_FIXED_TEMPERATURE,
    seed: GROQ_FIXED_SEED,
    max_tokens: GROQ_FIXED_MAX_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'm1_chart_signal_phase3',
        strict: true,
        schema: SERVER_SIGNAL_SCHEMA,
      },
    },
  };
}

export function securityHeaders(contentType = null) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=(self)',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

export function malformedJsonError() {
  return Object.assign(new Error('MALFORMED_JSON'), { statusCode: 400 });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function nullableString(value) {
  return value === null || typeof value === 'string';
}

function finiteOrNull(value) {
  return value === null || Number.isFinite(value);
}

function validateGateSnapshot(value) {
  return isPlainObject(value)
    && hasOnlyKeys(value, new Set(['modelProposedBias', 'preAuditBias', 'finalBias', 'finalReason']))
    && typeof value.modelProposedBias === 'string'
    && typeof value.preAuditBias === 'string'
    && value.finalBias === 'NEUTRAL'
    && typeof value.finalReason === 'string';
}

function validateTimings(value) {
  if (!isPlainObject(value)) return false;
  const keys = ['capture', 'preflight', 'deterministicScreen', 'aiCall', 'gates', 'totalCaptureToDecision'];
  if (!hasOnlyKeys(value, new Set(keys)) || !keys.every((key) => key in value)) return false;
  return keys.every((key) => finiteOrNull(value[key]) && (value[key] === null || value[key] >= 0));
}

function validateNullReasons(value) {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

const RECORD_KEYS = new Set([
  'schemaVersion', 'recordId', 'configVersion', 'promptVersion', 'modelName', 'temperature',
  'seed', 'seedReason', 'systemFingerprint', 'capturedAt', 'decisionAt', 'source',
  'captureEnvironment', 'configuredTimeframe', 'layoutProfileVersion', 'layoutReason',
  'deterministicScreen', 'rawModelResponseText', 'modelCallSkippedReason', 'preflight',
  'gateSnapshot', 'timingsMs', 'nullReasons', 'durableWrite', 'createdAt',
]);

export function validateDecisionRecord(record) {
  if (!isPlainObject(record) || !hasOnlyKeys(record, RECORD_KEYS)) {
    throw Object.assign(new Error('INVALID_AUDIT_RECORD_SCHEMA'), { statusCode: 400 });
  }
  for (const key of RECORD_KEYS) {
    if (!(key in record)) throw Object.assign(new Error('INVALID_AUDIT_RECORD_SCHEMA:' + key), { statusCode: 400 });
  }

  const valid =
    record.schemaVersion === 'decision-record-v1'
    && typeof record.recordId === 'string' && record.recordId.length >= 8 && record.recordId.length <= 200
    && typeof record.configVersion === 'string' && record.configVersion.length > 0
    && typeof record.promptVersion === 'string' && record.promptVersion.length > 0
    && typeof record.modelName === 'string' && record.modelName.length > 0
    && Number.isFinite(record.temperature)
    && (record.seed === null || Number.isInteger(record.seed))
    && nullableString(record.seedReason)
    && nullableString(record.systemFingerprint)
    && (record.capturedAt === null || isIso(record.capturedAt))
    && isIso(record.decisionAt)
    && ['live_tab', 'upload', 'paste'].includes(record.source)
    && record.configuredTimeframe === 'M1'
    && nullableString(record.layoutProfileVersion)
    && typeof record.layoutReason === 'string'
    && isPlainObject(record.deterministicScreen)
    && nullableString(record.rawModelResponseText)
    && nullableString(record.modelCallSkippedReason)
    && validateGateSnapshot(record.gateSnapshot)
    && validateTimings(record.timingsMs)
    && validateNullReasons(record.nullReasons)
    && ['pending', 'ok', 'failed'].includes(record.durableWrite)
    && isIso(record.createdAt);

  if (!valid) throw Object.assign(new Error('INVALID_AUDIT_RECORD_SCHEMA'), { statusCode: 400 });
  return true;
}

export function validateAuditArtifactEnvelope(artifact) {
  if (!isPlainObject(artifact)) throw Object.assign(new Error('INVALID_AUDIT_ARTIFACT_SCHEMA'), { statusCode: 400 });
  const allowed = new Set([
    'role', 'dataUrl', 'sha256', 'mimeType', 'byteLength', 'cropRect', 'sourceFrameSize',
    'sourceFrameSha256', 'capturedAt', 'privacyMasked',
  ]);
  if (!hasOnlyKeys(artifact, allowed)) throw Object.assign(new Error('INVALID_AUDIT_ARTIFACT_SCHEMA'), { statusCode: 400 });
  if (typeof artifact.role !== 'string' || artifact.role.length < 1 || artifact.role.length > 100) {
    throw Object.assign(new Error('INVALID_AUDIT_ARTIFACT_SCHEMA'), { statusCode: 400 });
  }
  if (typeof artifact.dataUrl !== 'string' || !artifact.dataUrl.startsWith('data:image/')) {
    throw Object.assign(new Error('INVALID_AUDIT_ARTIFACT_SCHEMA'), { statusCode: 400 });
  }
  if (artifact.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(String(artifact.sha256))) {
    throw Object.assign(new Error('INVALID_AUDIT_ARTIFACT_SCHEMA'), { statusCode: 400 });
  }
  if (artifact.capturedAt !== null && artifact.capturedAt !== undefined && !isIso(artifact.capturedAt)) {
    throw Object.assign(new Error('INVALID_AUDIT_ARTIFACT_SCHEMA'), { statusCode: 400 });
  }
  return true;
}

export function validateAnalyzeRequest(body) {
  if (!isPlainObject(body)) throw Object.assign(new Error('INVALID_GROQ_ANALYZE_REQUEST'), { statusCode: 400 });
  const allowed = new Set(['imageDataUrl', 'configuredAsset', 'capturedAt']);
  if (!hasOnlyKeys(body, allowed)) throw Object.assign(new Error('CLIENT_MODEL_PARAMETERS_FORBIDDEN'), { statusCode: 400 });
  if (typeof body.imageDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/i.test(body.imageDataUrl)) {
    throw Object.assign(new Error('INVALID_NATIVE_FRAME'), { statusCode: 400 });
  }
  if (typeof body.configuredAsset !== 'string' || body.configuredAsset.trim().length < 7 || body.configuredAsset.length > 40) {
    throw Object.assign(new Error('CONFIGURED_ASSET_REQUIRED'), { statusCode: 400 });
  }
  if (body.capturedAt !== undefined && body.capturedAt !== null && !isIso(body.capturedAt)) {
    throw Object.assign(new Error('INVALID_CAPTURE_TIMESTAMP'), { statusCode: 400 });
  }
  return {
    imageDataUrl: body.imageDataUrl,
    configuredAsset: body.configuredAsset.trim(),
    capturedAt: body.capturedAt ?? null,
  };
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function canonicalHashPayload(record) {
  const { recordHash: _recordHash, ...withoutHash } = record;
  return Buffer.from(JSON.stringify(withoutHash));
}

const queues = new Map();

export async function withSerializedFileWrite(file, task) {
  const prior = queues.get(file) || Promise.resolve();
  const next = prior.then(task, task);
  queues.set(file, next);
  try {
    return await next;
  } finally {
    if (queues.get(file) === next) queues.delete(file);
  }
}

export async function readNdjsonRows(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function appendSerializedHashedRecord(file, value, options = {}) {
  return withSerializedFileWrite(file, async () => {
    const rows = await readNdjsonRows(file);
    if (options.uniqueField) {
      const wanted = value && value[options.uniqueField];
      if (typeof wanted !== 'string' || !wanted) {
        throw Object.assign(new Error('MISSING_UNIQUE_FIELD:' + options.uniqueField), { statusCode: 400 });
      }
      if (rows.some((row) => row && row[options.uniqueField] === wanted)) {
        throw Object.assign(new Error('DUPLICATE_' + String(options.uniqueField).toUpperCase()), { statusCode: 409 });
      }
    }

    const previousRecordHash = rows.length ? String(rows[rows.length - 1].recordHash || '') || null : null;
    const {
      recordHash: _recordHash,
      previousRecordHash: _previousRecordHash,
      serverRecordedAt: _serverRecordedAt,
      durableStoredAt: _durableStoredAt,
      ...clientFields
    } = value || {};

    const base = {
      ...clientFields,
      serverRecordedAt: new Date().toISOString(),
      previousRecordHash,
    };
    const recordHash = sha256Bytes(Buffer.from(JSON.stringify(base)));
    const finalRecord = { ...base, recordHash };
    await fs.appendFile(file, JSON.stringify(finalRecord) + '\n', 'utf8');
    return finalRecord;
  });
}

export async function verifyHashChain(file) {
  const rows = await readNdjsonRows(file);
  const errors = [];
  let expectedPrevious = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.previousRecordHash !== expectedPrevious) {
      errors.push({ index, reason: 'PREVIOUS_HASH_MISMATCH', expected: expectedPrevious, actual: row.previousRecordHash ?? null });
    }
    const actual = row.recordHash;
    const expected = sha256Bytes(canonicalHashPayload(row));
    if (actual !== expected) {
      errors.push({ index, reason: 'RECORD_HASH_MISMATCH', expected, actual: actual ?? null });
    }
    expectedPrevious = typeof actual === 'string' ? actual : null;
  }

  return {
    valid: errors.length === 0,
    count: rows.length,
    errors,
    headHash: rows.length ? rows[rows.length - 1].recordHash ?? null : null,
  };
}
