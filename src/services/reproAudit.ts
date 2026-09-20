import type { AuditArtifact } from './auditArtifacts';

export interface ReproDecisionRecord {
  schemaVersion: 'decision-record-v1';
  recordId: string;
  configVersion: string;
  promptVersion: string;
  modelName: string;
  temperature: number;
  seed: number | null;
  seedReason: string | null;
  systemFingerprint: string | null;
  capturedAt: string | null;
  decisionAt: string;
  source: 'live_tab' | 'upload' | 'paste';
  configuredTimeframe: 'M1';
  layoutProfileVersion: string | null;
  layoutReason: string;
  rawModelResponseText: string;
  preflight: unknown;
  gateSnapshot: {
    modelProposedBias: string;
    preAuditBias: string;
    finalBias: 'NEUTRAL';
    finalReason: string;
  };
  timingsMs: {
    capture: number | null;
    preflight: number | null;
    aiCall: number;
    gates: number;
    totalCaptureToDecision: number | null;
  };
  nullReasons: Record<string, string>;
  durableWrite: 'pending' | 'ok' | 'failed';
  createdAt: string;
}

const DB_NAME = 'quotex_m1_repro_audit_v1';
const DB_VERSION = 1;
const STORE = 'decisions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'recordId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open reproducibility database.'));
  });
}

export async function appendLocalReproRecord(record: ReproDecisionRecord): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).add(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Could not append reproducibility record.'));
    });
  } finally {
    db.close();
  }
}

export async function persistReproDecision(record: ReproDecisionRecord, artifacts: AuditArtifact[]): Promise<{ durable: boolean; recordHash: string | null }> {
  await appendLocalReproRecord(record);
  try {
    const response = await fetch('/api/audit/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: { ...record, durableWrite: 'ok' }, artifacts }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'Durable audit write failed.');
    return { durable: true, recordHash: String(data.recordHash || '') };
  } catch {
    return { durable: false, recordHash: null };
  }
}

export function newRecordId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
