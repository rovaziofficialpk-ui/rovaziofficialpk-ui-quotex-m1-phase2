import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const signalLogic = await import('../src/signalLogic.ts');
const edgeGate = await import('../src/services/edgeGate.ts');
const screenPipeline = await import('../src/services/screenPipeline.ts');
const screenFields = await import('../src/services/screenFieldVerification.ts');
const outcomeResolver = await import('../src/services/outcomeResolver.ts');
const precisionOptimizer = await import('../src/services/precisionOptimizer.ts');

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
    const directional = bias === 'CALL' ? 'bullish' : 'bearish';
    const signal = signalLogic.applySignalGate(modelPayload({
      bias,
      trend: directional,
      momentum: directional,
      structure: directional,
      candleSignal: directional,
      confidence: 95,
    }), 50, '{}', { score: 100, status: 'pass' }, 0);
    assert.equal(signal.bias, bias);
    const gated = edgeGate.applyAuditEdgeGate(signal);
    assert.equal(gated.bias, 'NEUTRAL');
    assert.equal(gated.proposedBias, bias);
  }
});



test('signal gate handles 4/4, 3/4, 2/4, low confidence, poor chart, wrong timeframe and context conflict', () => {
  const run = (overrides={}, contextImages=0) => signalLogic.applySignalGate(
    modelPayload({ confidence:95, ...overrides }),
    70,
    '{}',
    { score:100, status:'pass' },
    contextImages,
  );

  const four = run({ bias:'CALL', trend:'bullish', momentum:'bullish', structure:'bullish', candleSignal:'bullish' });
  assert.equal(four.confirmationCount, 4);
  assert.equal(four.bias, 'CALL');

  const three = run({ bias:'CALL', trend:'bullish', momentum:'bullish', structure:'bullish', candleSignal:'none' });
  assert.equal(three.confirmationCount, 3);
  assert.equal(three.bias, 'CALL');

  const two = run({ bias:'CALL', trend:'bullish', momentum:'bullish', structure:'neutral', candleSignal:'none' });
  assert.equal(two.confirmationCount, 2);
  assert.equal(two.bias, 'NEUTRAL');

  const oneOpposing = run({ bias:'CALL', trend:'bullish', momentum:'bullish', structure:'bullish', candleSignal:'bearish' });
  assert.equal(oneOpposing.confirmationCount, 3);
  assert.equal(oneOpposing.opposingConfirmations, 1);
  assert.equal(oneOpposing.bias, 'CALL');

  const twoOpposing = run({ bias:'CALL', trend:'bullish', momentum:'bullish', structure:'bearish', candleSignal:'bearish' });
  assert.equal(twoOpposing.opposingConfirmations, 2);
  assert.equal(twoOpposing.bias, 'NEUTRAL');

  assert.equal(run({ confidence:69, bias:'CALL', trend:'bullish', momentum:'bullish', structure:'bullish', candleSignal:'bullish' }).bias, 'NEUTRAL');
  assert.equal(run({ chartQuality:'poor', bias:'CALL', trend:'bullish', momentum:'bullish', structure:'bullish', candleSignal:'bullish' }).bias, 'NEUTRAL');
  assert.equal(run({ timeframe:'other', bias:'CALL', trend:'bullish', momentum:'bullish', structure:'bullish', candleSignal:'bullish' }).bias, 'NEUTRAL');
  assert.equal(run({
    bias:'CALL', trend:'bullish', momentum:'bullish', structure:'bullish', candleSignal:'bullish',
    contextAlignment:'conflicting',
  }, 1).bias, 'NEUTRAL');
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

  const fieldGate = (overrides = {}) => screenPipeline.decideDeterministicScreenGate({
    metrics: baseMetrics,
    configuredTimeframe: 'M1',
    parsedTimeframe: 'M1',
    configuredAsset: 'EUR/USD',
    parsedAsset: 'EUR/USD',
    priceAxisReadable: true,
    timeAxisReadable: true,
    ...overrides,
  });
  assert.ok(fieldGate({ priceAxisReadable:false }).reasons.includes('PRICE_AXIS_UNREADABLE'));
  assert.ok(fieldGate({ timeAxisReadable:false }).reasons.includes('TIME_AXIS_UNREADABLE'));
  assert.ok(fieldGate({ parsedTimeframe:null }).reasons.includes('TIMEFRAME_UNVERIFIED'));
  assert.ok(fieldGate({ parsedTimeframe:'M5' }).reasons.includes('TIMEFRAME_MISMATCH'));
  assert.ok(fieldGate({ configuredAsset:null }).reasons.includes('ASSET_UNVERIFIED'));
  assert.ok(fieldGate({ parsedAsset:null }).reasons.includes('ASSET_UNVERIFIED'));
  assert.ok(fieldGate({ parsedAsset:'GBP/USD' }).reasons.includes('ASSET_MISMATCH'));
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
  const insufficient = screenFields.deriveMinutesPerCandle(m1.slice(0, 3), 45.5);
  const noPitch = screenFields.deriveMinutesPerCandle(m1, null);
  assert.equal(a.intervalCount, 3);
  assert.ok(Math.abs(a.minutesPerCandle - 1) <= screenFields.MINUTES_PER_CANDLE_TOLERANCE);
  assert.ok(Math.abs(b.minutesPerCandle - 1) > screenFields.MINUTES_PER_CANDLE_TOLERANCE);
  assert.equal(insufficient.intervalCount, 0);
  assert.equal(insufficient.minutesPerCandle, null);
  assert.equal(noPitch.intervalCount, 0);
  assert.equal(noPitch.minutesPerCandle, null);
});

test('price-axis parser fails closed below its minimum label count', () => {
  const tokens = [
    { text:'1.1000', confidence:95, left:0, top:0, width:10, height:10 },
    { text:'1.0995', confidence:95, left:0, top:20, width:10, height:10 },
    { text:'1.0990', confidence:95, left:0, top:40, width:10, height:10 },
  ];
  const result = screenFields.parsePriceAxis(tokens, '1.1000 1.0995 1.0990');
  assert.equal(result.readable, false);
  assert.equal(result.reasonCode, 'INSUFFICIENT_PRICE_LABELS');

  const lowConfidence = screenFields.parsePriceAxis([
    { text:'1.1000', confidence:69, left:0, top:0, width:10, height:10 },
    { text:'1.0995', confidence:69, left:0, top:20, width:10, height:10 },
    { text:'1.0990', confidence:69, left:0, top:40, width:10, height:10 },
    { text:'1.0985', confidence:69, left:0, top:60, width:10, height:10 },
  ], '1.1000 1.0995 1.0990 1.0985');
  assert.equal(lowConfidence.readable, false);
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


test('Wilson lower 95, win-rate denominator and tie handling match independent known values', () => {
  const rows = Array.from({ length: 100 }, (_, index) => {
    let outcome = 'WIN';
    if (index < 70) {
      outcome = index < 56 ? 'WIN' : 'LOSS';
    } else {
      const h = index - 70;
      outcome = h < 24 ? 'WIN' : h < 28 ? 'LOSS' : 'TIE';
    }
    return {
      index,
      timestamp: index,
      bias: 'CALL',
      confidence: 100,
      confirmationCount: 4,
      opposingConfirmations: 0,
      chartQuality: 'clear',
      warningCount: 0,
      outcome,
    };
  });

  const result = precisionOptimizer.optimizePrecisionProfile(rows, 'EUR/USD', 'FOREX', 80);
  assert.ok(result.profile);
  assert.equal(result.profile.holdout.wins, 24);
  assert.equal(result.profile.holdout.losses, 4);
  assert.equal(result.profile.holdout.ties, 2);
  assert.equal(result.profile.holdout.winRate, 85.7);
  assert.equal(result.profile.holdout.wilsonLower95, 68.5);
});

test('outcome summary keeps full-sample expectancy null when any expired outcome is unresolved', () => {
  const trade = (id, outcome, unitReturn) => ({
    tradeId: id,
    armedAt: new Date(0).toISOString(),
    dueAt: new Date(60000).toISOString(),
    direction: 'CALL',
    entry: {},
    expiry: {},
    resolverOutcome: outcome,
    resolverNullReason: outcome === null ? 'ENTRY_PRICE_UNREADABLE' : null,
    unitReturn,
    platformOutcome: null,
    agreement: null,
    settlementRuleVersion: 'x',
    settlementRuleStatus: 'DOCUMENTED_VERIFIED',
    screenValidationStatus: 'PENDING_30_MANUAL_DEMO_TRADES',
  });

  const complete = outcomeResolver.summarizeOutcomeTrades([
    trade('w', 'WIN', 0.9),
    trade('l', 'LOSS', -1),
    trade('t', 'TIE', 0),
  ]);
  assert.equal(complete.fullSampleExpectancy, -0.033333);
  assert.equal(complete.meanUnitReturnKnown, -0.033333);

  const incomplete = outcomeResolver.summarizeOutcomeTrades([
    trade('w', 'WIN', 0.9),
    trade('u', null, null),
  ]);
  assert.equal(incomplete.fullSampleExpectancy, null);
  assert.equal(incomplete.resolverNull, 1);
  assert.ok(incomplete.selectionBiasWarning);
});

test('source guard: production payout breakeven formula is exactly 1/(1+payout)', () => {
  const stage = fs.readFileSync(new URL('../src/services/screenStage3C.ts', import.meta.url), 'utf8');
  assert.match(stage, /breakevenWinRate:\s*Number\(\(1 \/ \(1 \+ payoutDecimal\)\)\.toFixed\(6\)\)/);
});


test('coverage locks remain hard false in both field and Stage3C verifiers', () => {
  const fields = fs.readFileSync(new URL('../src/services/screenFieldVerification.ts', import.meta.url), 'utf8');
  const stage = fs.readFileSync(new URL('../src/services/screenStage3C.ts', import.meta.url), 'utf8');
  assert.match(fields, /export const LAYOUT_VALIDATION_COVERAGE_COMPLETE = false/);
  assert.match(stage, /export const STAGE3C_VALIDATION_COVERAGE_COMPLETE = false/);
});
