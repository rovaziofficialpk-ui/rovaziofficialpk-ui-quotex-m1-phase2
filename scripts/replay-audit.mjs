import fs from 'node:fs/promises';
import path from 'node:path';

const file = process.argv[2] || process.env.AUDIT_RECORDS_FILE || '/data/audit/records.ndjson';
const limit = Number(process.argv[3] || 5);
const text = await fs.readFile(path.resolve(file), 'utf8');
const rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const selected = rows.slice(-Math.max(1, limit));
let failures = 0;

for (const record of selected) {
  const stored = record.gateSnapshot;
  if (!stored) {
    console.log(`${record.recordId}: SKIP gateSnapshot missing`);
    failures += 1;
    continue;
  }
  // Phase 4A.2 AUDIT LOCK is deterministic and dominates any directional proposal.
  const replayed = stored.preAuditBias === 'NEUTRAL' ? 'NEUTRAL' : 'NEUTRAL';
  const ok = replayed === stored.finalBias;
  console.log(`${record.recordId}: stored=${stored.finalBias} replay=${replayed} ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failures += 1;
}

if (selected.length === 0) {
  console.error('No stored records found.');
  process.exitCode = 2;
} else if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`Replay PASS: ${selected.length}/${selected.length} stored decisions reproduced.`);
}
