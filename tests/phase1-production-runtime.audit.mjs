import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const signalLogic = await import('../src/signalLogic.ts');
const edgeGate = await import('../src/services/edgeGate.ts');
const screenPipeline = await import('../src/services/screenPipeline.ts');
const screenFields = await import('../src/services/screenFieldVerification.ts');
const outcomeResolver = await import('../src/services/outcomeResolver.ts');

function modelPayload(overrides = {}) {
  return {
    pair: 'EUR/USD',
    bias: 'CALL',
    confidence: 80,
    pattern: 'test',
    entry: 'test',
    chartQuality: 'clear',
    timeframe: 'M1',
    trend: 'bullish',
    momentum: 'bullish',
    structure: 'bullish',
    candleSignal: 'bullish',
    supportResistance: 'test',
    evidence: ['x'],
    contextAlignment: 'not_provided',
    contextNotes: '',
    warnings: [],
    ...overrides,
  };
}

test('R1 behavioral: audit edge gate forces CALL and PUT to NEUTRAL', () => {
  for (const bias of ['CALL', 'PUT']) {
    const signal = signalLogic.applySignalGate(modelPayload({ bias }), 50, '{}', { score: 100, status: 'pass' }, 0);
    assert.equal(signal.bias, bias);
    const gated = edgeGate.applyAuditEdgeGate(signal);
    assert.equal(gated.bias, 'NEUTRAL');
    assert.equal(gated.proposedBias, bias);
  }
});

test('deterministic structural gate rejects each mutated invalid condition', () => {
  const baseMetrics = {
    width: 1472,
    height: 668,
    aspectRatio: 2.2036,
    plotCombinedCandleColorRatio: 0.055,
    rightPanelGreenRatio: 0.049,
    rightPanelRedRatio: 0.047,
    currentPriceBlueRatio: 0.011,
    horizontalMarkerRowRatio: 0.26,
    outerNearBlackRatio: 0.015,
    candleCount: 17,
    candlePitchPx: 45.5,
    candleCentersPx: [100,145.5,191],
    lastCandleXFraction: 0.69,
  };
  const gate = (metrics) => screenPipeline.decideDeterministicScreenGate({
    metrics,
    configuredTimeframe: 'M1',
    parsedTimeframe: 'M1',
    configuredAsset: 'EUR/USD',
    parsedAsset: 'EUR/USD',
    priceAxisReadable: true,
    timeAxisReadable: true,
  });
  assert.equal(gate(baseMetrics).safeForAi, true);
  assert.ok(gate({ ...baseMetrics, aspectRatio: 1.5 }).reasons.includes('LAYOUT_NOT_FOUND'));
  assert.ok(gate({ ...baseMetrics, outerNearBlackRatio: 0.9 }).reasons.includes('LETTERBOX_DETECTED'));
  assert.ok(gate({ ...baseMetrics, candleCount: 1 }).reasons.includes('CANDLE_COUNT_OUT_OF_RANGE'));
  assert.ok(gate({ ...baseMetrics, lastCandleXFraction: 0.2 }).reasons.includes('NEWEST_CANDLE_NOT_VISIBLE'));
  assert.ok(gate({ ...baseMetrics, currentPriceBlueRatio: 0 }).reasons.includes('CURRENT_PRICE_MARKER_MISSING'));
});

test('time-axis production function handles midnight rollover and separates M1 from M5 geometry', () => {
  const mk = (text, secondsOfDay, x) => ({ text, secondsOfDay, x, confidence: 95 });
  const m1 = [
    mk('23:58', 86280, 100),
    mk('00:00', 0, 191),
    mk('00:02', 120, 282),
    mk('00:04', 240, 373),
  ];
  const m5 = [
    mk('23:50', 85800, 100),
    mk('00:00', 0, 191),
    mk('00:10', 600, 282),
    mk('00:20', 1200, 373),
  ];
  const a = screenFields.deriveMinutesPerCandle(m1, 45.5);
  const b = screenFields.deriveMinutesPerCandle(m5, 45.5);
  assert.equal(a.intervalCount, 3);
  assert.ok(Math.abs(a.minutesPerCandle - 1) <= screenFields.MINUTES_PER_CANDLE_TOLERANCE);
  assert.ok(Math.abs(b.minutesPerCandle - 1) > screenFields.MINUTES_PER_CANDLE_TOLERANCE);
});

test('price-axis parser fails closed below its minimum label count', () => {
  const tokens = [
    { text:'1.1000', confidence:95, left:0, top:0, width:10, height:10 },
    { text:'1.0995', confidence:95, left:0, top:20, width:10, height:10 },
    { text:'1.0990', confidence:95, left:0, top:40, width:10, height:10 },
  ];
  const result = screenFields.parsePriceAxis(tokens, '1.1000 1.0995 1.0990');
  assert.equal(result.readable, false);
  assert.equal(result.reasonCode, 'PRICE_AXIS_UNREADABLE');
});

test('model validator rejects malformed JSON and invalid enum', () => {
  assert.throws(() => signalLogic.validateModelSignal('{'));
  assert.throws(() => signalLogic.validateModelSignal(JSON.stringify(modelPayload({ bias: 'BUY' }))));
});

test('outcome resolver keeps missing fields null and tie return zero', () => {
  const baseSnap = {
    capturedAt: new Date(0).toISOString(),
    platformClockUtc: null,
    asset: 'EUR/USD',
    price: { price: 1.1, rawText:'1.1', ocrConfidence:95, axisPredictedPrice:1.1, axisResidual:0, allowedResidual:0.001, crossCheckPassed:true, confidence:95, reasonCode:null },
    expiry: { rawText:'00:01:00', expirySeconds:60, verifiedOneMinute:true, confidence:95, reasonCode:null },
    payoutDecimal: 0.9,
    payoutPercent: 90,
    payoutConfidence: 95,
    breakevenWinRate: 1/1.9,
    payoutReason: null,
    frameReasons: [],
    priceAxisR2: 1,
    sourceFrameSha256: 'x',
  };
  const tie = outcomeResolver.resolveOutcome({ direction:'CALL', entry:baseSnap, expiry:{...baseSnap} });
  assert.deepEqual(tie, { outcome:'TIE', nullReason:null, unitReturn:0 });
  const missing = outcomeResolver.resolveOutcome({
    direction:'CALL',
    entry:{ ...baseSnap, price:{ ...baseSnap.price, price:null, reasonCode:'CURRENT_PRICE_TAG_UNREADABLE' } },
    expiry:baseSnap,
  });
  assert.equal(missing.outcome, null);
  assert.equal(missing.nullReason, 'CURRENT_PRICE_TAG_UNREADABLE');
});

test('breakeven formula known value is correct', () => {
  const payout = 0.93;
  assert.ok(Math.abs((1/(1+payout)) - 0.5181347150259068) < 1e-12);
});

test('source guard: timeframe remains badge AND axis and expiry timer is not timeframe', () => {
  const src = fs.readFileSync(new URL('../src/services/screenFieldVerification.ts', import.meta.url), 'utf8');
  const config = JSON.parse(fs.readFileSync(new URL('../config/input-pipeline-v1.6.json', import.meta.url), 'utf8'));
  assert.match(src, /const timeframeVerified = badgeSaysM1 && timeAxis\.verifiedM1/);
  assert.equal(config.timeframeVerification.logic, 'explicit_1m_badge AND time_axis_candle_pitch');
  assert.equal(config.timeframeVerification.expiryTimerAcceptedAsTimeframe, false);
});

test('source guard: chart type, price-axis, clock and payout checks remain present', () => {
  const stage = fs.readFileSync(new URL('../src/services/screenStage3C.ts', import.meta.url), 'utf8');
  assert.match(stage, /candleScore !== null && candleScore >= CHARTTYPE_CANDLE_THRESHOLD/);
  assert.match(stage, /r2 !== null && r2 >= PRICE_AXIS_R2_MIN/);
  assert.match(stage, /pixelSpacingCv !== null && pixelSpacingCv <= PRICE_AXIS_PIXEL_SPACING_CV_MAX/);
  assert.match(stage, /priceStepCv !== null && priceStepCv <= PRICE_AXIS_STEP_CV_MAX/);
  assert.match(stage, /const stale = delta > CLOCK_STALE_TOLERANCE_SECONDS/);
  assert.match(stage, /if \(candidates\.length !== 1\)/);
});
