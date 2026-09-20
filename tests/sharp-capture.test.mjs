import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('live capture no longer uses the old 2048 downscale', () => {
  const source = fs.readFileSync(new URL('../src/services/tabCapture.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('MAX_CAPTURE_WIDTH'), false);
  assert.match(source, /canvas\.width = sourceWidth/);
  assert.match(source, /canvas\.height = sourceHeight/);
});

test('live capture uses lossless PNG rather than JPEG', () => {
  const source = fs.readFileSync(new URL('../src/services/tabCapture.ts', import.meta.url), 'utf8');
  assert.match(source, /toDataURL\('image\/png'\)/);
  assert.equal(source.includes("toDataURL('image/jpeg', 0.94)"), false);
});

test('display capture requests higher resolution when the browser can provide it', () => {
  const source = fs.readFileSync(new URL('../src/services/tabCapture.ts', import.meta.url), 'utf8');
  assert.match(source, /PREFERRED_CAPTURE_WIDTH = 2560/);
  assert.match(source, /PREFERRED_CAPTURE_HEIGHT = 1440/);
});

test('audit lock source remains present', () => {
  const source = fs.readFileSync(new URL('../src/services/edgeGate.ts', import.meta.url), 'utf8');
  assert.match(source, /bias: 'NEUTRAL'/);
});
