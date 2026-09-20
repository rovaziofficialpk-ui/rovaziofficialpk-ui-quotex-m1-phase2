import { AUDIT_CONFIG_VERSION } from './edgeGate';
import { GROQ_MODEL } from './groq';
import type { TradeSignal } from '../signalLogic';

export type AuditSignalSource = 'live_tab' | 'upload' | 'paste' | 'backtest' | 'forward_demo';
export type AuditOutcome = 'WIN' | 'LOSS' | 'TIE' | 'NEUTRAL' | 'UNKNOWN';

export interface AuditSignalRecord {
  schemaVersion: 'signal-log-v1';
  recordId: string;
  configVersion: string;
  modelVersion: string;
  capturedAt: string | null;
  decisionAt: string;
  asset: string;
  timeframe: string;
  trend: TradeSignal['trend'];
  momentum: TradeSignal['momentum'];
  structure: TradeSignal['structure'];
  latestCandle: TradeSignal['candleSignal'];
  aiConfidence: number;
  opposingEvidenceCount: number;
  chartQuality: TradeSignal['chartQuality'];
  proposedBias: TradeSignal['proposedBias'];
  emittedBias: TradeSignal['bias'];
  neutralReason: string | null;
  entryPrice: number | null;
  entryTimestamp: string | null;
  expiryTimestamp: string | null;
  expirySeconds: number | null;
  payout: number | null;
  outcome: AuditOutcome;
  captureToDecisionMs: number | null;
  feed: string;
  source: AuditSignalSource;
  rawDataRef: string | null;
  recordedAt: string;
}

const DB_NAME = 'quotex_m1_audit_v1';
const DB_VERSION = 1;
const STORE = 'signals';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'recordId' });
        store.createIndex('decisionAt', 'decisionAt', { unique: false });
        store.createIndex('asset', 'asset', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open audit log database.'));
  });
}

export async function appendAuditSignal(record: AuditSignalRecord): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).add(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Could not append audit record.'));
    });
  } finally {
    db.close();
  }
}

export async function readAuditSignals(): Promise<AuditSignalRecord[]> {
  const db = await openDb();
  try {
    return await new Promise<AuditSignalRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as AuditSignalRecord[]).sort((a, b) => a.decisionAt.localeCompare(b.decisionAt)));
      request.onerror = () => reject(request.error || new Error('Could not read audit records.'));
    });
  } finally {
    db.close();
  }
}

export function createAuditSignalRecord(args: {
  signal: TradeSignal;
  source: AuditSignalSource;
  capturedAt: string | null;
  decisionAt: string;
  entryPrice?: number | null;
  entryTimestamp?: string | null;
  expiryTimestamp?: string | null;
  expirySeconds?: number | null;
  payout?: number | null;
  outcome?: AuditOutcome;
  feed?: string;
  rawDataRef?: string | null;
}): AuditSignalRecord {
  const captureMs = args.capturedAt ? Date.parse(args.capturedAt) : Number.NaN;
  const decisionMs = Date.parse(args.decisionAt);
  const latency = Number.isFinite(captureMs) && Number.isFinite(decisionMs)
    ? Math.max(0, Math.round(decisionMs - captureMs))
    : null;

  return {
    schemaVersion: 'signal-log-v1',
    recordId: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    configVersion: AUDIT_CONFIG_VERSION,
    modelVersion: GROQ_MODEL,
    capturedAt: args.capturedAt,
    decisionAt: args.decisionAt,
    asset: args.signal.pair || 'Unknown Asset',
    timeframe: args.signal.timeframe,
    trend: args.signal.trend,
    momentum: args.signal.momentum,
    structure: args.signal.structure,
    latestCandle: args.signal.candleSignal,
    aiConfidence: args.signal.confidence,
    opposingEvidenceCount: args.signal.opposingConfirmations,
    chartQuality: args.signal.chartQuality,
    proposedBias: args.signal.proposedBias,
    emittedBias: args.signal.bias,
    neutralReason: args.signal.bias === 'NEUTRAL' ? (args.signal.gateReason || 'Base strategy returned NEUTRAL.') : null,
    entryPrice: args.entryPrice ?? null,
    entryTimestamp: args.entryTimestamp ?? null,
    expiryTimestamp: args.expiryTimestamp ?? null,
    expirySeconds: args.expirySeconds ?? null,
    payout: args.payout ?? null,
    outcome: args.outcome ?? (args.signal.bias === 'NEUTRAL' ? 'NEUTRAL' : 'UNKNOWN'),
    captureToDecisionMs: latency,
    feed: args.feed || 'Unknown feed',
    source: args.source,
    rawDataRef: args.rawDataRef ?? null,
    recordedAt: new Date().toISOString(),
  };
}
