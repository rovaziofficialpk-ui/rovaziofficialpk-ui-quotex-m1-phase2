import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const mutants = [
  {
    name: 'server-proof-gate-bypassed',
    file: 'server.mjs',
    from: '        if (!verification.eligibleForModel) {',
    to: '        if (false && !verification.eligibleForModel) {',
  },
  {
    name: 'client-model-parameter-filter-disabled',
    file: 'server/batch1Security.mjs',
    from: "  if (!hasOnlyKeys(body, allowed)) throw Object.assign(new Error('CLIENT_MODEL_PARAMETERS_FORBIDDEN'), { statusCode: 400 });",
    to: "  if (false && !hasOnlyKeys(body, allowed)) throw Object.assign(new Error('CLIENT_MODEL_PARAMETERS_FORBIDDEN'), { statusCode: 400 });",
  },
  {
    name: 'fixed-temperature-mutated',
    file: 'server/batch1Security.mjs',
    from: 'export const GROQ_FIXED_TEMPERATURE = 0;',
    to: 'export const GROQ_FIXED_TEMPERATURE = 1;',
  },
  {
    name: 'fixed-seed-mutated',
    file: 'server/batch1Security.mjs',
    from: 'export const GROQ_FIXED_SEED = 424242;',
    to: 'export const GROQ_FIXED_SEED = 1;',
  },
  {
    name: 'upstream-abort-signal-removed',
    file: 'server.mjs',
    from: '      signal: controller.signal,',
    to: '      // mutation: signal removed',
  },
  {
    name: 'analyze-image-limit-disabled',
    file: 'server.mjs',
    from: '        if (decoded.bytes.length > ANALYZE_MAX_IMAGE_BYTES) {',
    to: '        if (false && decoded.bytes.length > ANALYZE_MAX_IMAGE_BYTES) {',
  },
  {
    name: 'audit-schema-validation-disabled',
    file: 'server.mjs',
    from: '  validateDecisionRecord(payload.record);',
    to: '  // mutation: audit schema validation disabled',
  },
  {
    name: 'duplicate-record-id-check-disabled',
    file: 'server/batch1Security.mjs',
    from: '      if (rows.some((row) => row && row[options.uniqueField] === wanted)) {',
    to: '      if (false && rows.some((row) => row && row[options.uniqueField] === wanted)) {',
  },
  {
    name: 'cross-process-file-lock-disabled',
    file: 'server/batch1Security.mjs',
    from: '    const release = await acquireFileLock(file);',
    to: '    const release = async () => {};',
  },
  {
    name: 'tamper-recompute-disabled',
    file: 'server/batch1Security.mjs',
    from: '    const expected = sha256Bytes(canonicalHashPayload(row));',
    to: '    const expected = actual;',
  },
  {
    name: 'malformed-json-returns-500',
    file: 'server/batch1Security.mjs',
    from: "  return Object.assign(new Error('MALFORMED_JSON'), { statusCode: 400 });",
    to: "  return Object.assign(new Error('MALFORMED_JSON'), { statusCode: 500 });",
  },
  {
    name: 'x-frame-options-weakened',
    file: 'server/batch1Security.mjs',
    from: "    'X-Frame-Options': 'DENY',",
    to: "    'X-Frame-Options': 'SAMEORIGIN',",
  },
  {
    name: 'coverage-lock-enabled-server-side',
    file: 'server/deterministicGate.mjs',
    from: 'const VALIDATION_COVERAGE_COMPLETE = false;',
    to: 'const VALIDATION_COVERAGE_COMPLETE = true;',
  },
];

const results = [];
for (const mutant of mutants) {
  const original = fs.readFileSync(mutant.file, 'utf8');
  if (!original.includes(mutant.from)) {
    results.push({ name: mutant.name, status: 'NOT_APPLIED_PATTERN_MISSING' });
    continue;
  }

  fs.writeFileSync(mutant.file, original.replace(mutant.from, mutant.to));
  const run = spawnSync(process.execPath, ['--test', 'tests/batch1-p0-regression.test.mjs'], {
    encoding: 'utf8',
    env: process.env,
    timeout: 90_000,
  });
  fs.writeFileSync(mutant.file, original);

  results.push({
    name: mutant.name,
    status: run.status === 0 ? 'UNDETECTED' : 'DETECTED',
    exitCode: run.status,
    evidence: (String(run.stdout || '') + String(run.stderr || '')).split('\n').filter(Boolean).slice(-8),
  });
}

console.log(JSON.stringify({ mutationCheckVersion:'batch1-v1', results }, null, 2));
if (results.some((item) => item.status !== 'DETECTED')) process.exit(1);
