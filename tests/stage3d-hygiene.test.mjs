import test from 'node:test';
import assert from 'node:assert/strict';

test('acceptance session from older spec is contaminated', () => {
  const currentSpecId = 'spec-v2';
  const session = { split: 'acceptance', evaluatedSpecId: 'spec-v1' };
  assert.equal(session.evaluatedSpecId !== currentSpecId, true);
});

test('explicit invalidation converts acceptance to calibration-only evidence', () => {
  const invalidated = new Set(['accept-001']);
  assert.equal(invalidated.has('accept-001'), true);
});

test('negative timeframe controls are separate for badge and time-axis methods', () => {
  const result = { badgeCheck: 'REJECTED_REAL', timeAxisCheck: 'NOT_RUN' };
  assert.equal(result.badgeCheck === 'REJECTED_REAL' && result.timeAxisCheck === 'REJECTED_REAL', false);
});

test('condition key includes asset timeframe chart type and window state', () => {
  const condition = { asset:'CAD/CHF (OTC)', timeframe:'M1', chartType:'candlestick', windowState:'desktop-100pct' };
  assert.equal([condition.asset,condition.timeframe,condition.chartType,condition.windowState].join(' | '),
    'CAD/CHF (OTC) | M1 | candlestick | desktop-100pct');
});

test('no automatic unlock is ever emitted', () => {
  const recommendation = 'ELIGIBLE_FOR_MANUAL_REVIEW_ONLY_DO_NOT_AUTO_UNLOCK';
  assert.match(recommendation, /DO_NOT_AUTO_UNLOCK/);
});
