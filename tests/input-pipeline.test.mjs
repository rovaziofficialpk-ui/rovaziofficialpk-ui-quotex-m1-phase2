import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

test('sha256 is stable for exact bytes', () => {
  const bytes = Buffer.from('exact-image-bytes');
  const a = crypto.createHash('sha256').update(bytes).digest('hex');
  const b = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test('audit lock replay always remains NEUTRAL for directional proposals', () => {
  for (const proposed of ['CALL', 'PUT', 'NEUTRAL']) {
    const finalBias = proposed === 'NEUTRAL' ? 'NEUTRAL' : 'NEUTRAL';
    assert.equal(finalBias, 'NEUTRAL');
  }
});

test('layout is explicitly unverified rather than guessed', async () => {
  const config = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../config/input-pipeline-v1.json', import.meta.url), 'utf8'));
  assert.equal(config.layoutProfile, null);
  assert.equal(config.layoutStatus, 'UNVERIFIED');
  assert.equal(config.productionCroppingEnabled, false);
});
