import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../config/input-pipeline-v1.6.json', import.meta.url), 'utf8'));
const verifier = fs.readFileSync(new URL('../src/services/screenFieldVerification.ts', import.meta.url), 'utf8');
const stage3c = fs.readFileSync(new URL('../src/services/screenStage3C.ts', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../validation/stage3d-labeled-results.json', import.meta.url), 'utf8'));

test('timeframe v2 keeps audit and layout locks on', () => {
  assert.equal(config.auditLock, true);
  assert.equal(config.layoutValidationIncomplete, true);
  assert.equal(config.acceptanceHygiene.autoUnlock, false);
  assert.match(stage3c, /STAGE3C_VALIDATION_COVERAGE_COMPLETE = false/);
  assert.match(verifier, /LAYOUT_VALIDATION_COVERAGE_COMPLETE = false/);
});

test('timeframe v2 preserves strict AND logic and never accepts expiry timer', () => {
  assert.equal(config.timeframeVerification.logic, 'explicit_1m_badge AND time_axis_candle_pitch');
  assert.equal(config.timeframeVerification.expiryTimerAcceptedAsTimeframe, false);
  assert.match(verifier, /const timeframeVerified = badgeSaysM1 && timeAxis\.verifiedM1/);
});

test('frozen safety thresholds are unchanged', () => {
  assert.equal(config.frozenThresholds.timeframeBadgeMinimumCorrelation, 0.985);
  assert.equal(config.frozenThresholds.minutesPerCandle, 1);
  assert.equal(config.frozenThresholds.minutesPerCandleTolerance, 0.08);
  assert.equal(config.timeframeVerification.axis.minimumUsableIntervals, 3);
  assert.equal(config.frozenThresholds.ocrMinimumTokenConfidence, 70);
  assert.match(verifier, /TIMEFRAME_TEMPLATE_THRESHOLD = 0\.985/);
  assert.match(verifier, /MINUTES_PER_CANDLE_TOLERANCE = 0\.08/);
});

test('badge search range is fixed in advance', () => {
  assert.deepEqual(
    config.timeframeVerification.badge.fixedScaleSearch,
    [0.75, 0.9, 1, 1.1, 1.25, 1.5],
  );
  assert.match(verifier, /TIMEFRAME_TEMPLATE_FIXED_SCALES = \[0\.75, 0\.9, 1\.0, 1\.1, 1\.25, 1\.5\]/);
});

test('TIMEFRAME_UNVERIFIED has explicit sub-reasons and crop diagnostics', () => {
  for (const code of [
    'BADGE_NO_MATCH',
    'BADGE_TEMPLATE_UNAVAILABLE',
    'AXIS_INSUFFICIENT_INTERVALS',
    'AXIS_CANDLE_PITCH_UNAVAILABLE',
    'AXIS_PITCH_MISMATCH',
    'BADGE_AXIS_DISAGREE',
  ]) {
    assert.ok(config.diagnostics.subReasons.includes(code));
    assert.ok(verifier.includes(code));
  }
  assert.equal(config.diagnostics.showFailedCropThumbnail, true);
  assert.equal(config.diagnostics.saveNativePngOnTimeframeReject, true);
});

test('spec bump invalidates zero acceptance sessions because none existed', () => {
  assert.equal(config.specId, 'stage3d-spec-v2');
  assert.equal(config.acceptanceHygiene.previousAcceptanceSessionsAffected, 0);
  assert.equal(manifest.frozenSpec.specId, 'stage3d-spec-v2');
  assert.equal(manifest.liveAcceptance.postDeploymentDecisions, 0);
  const acceptance = manifest.sessions.filter((session) => session.split === 'acceptance');
  assert.equal(acceptance.length, 0);
});

test('real non-M1 rejection remains explicitly unproven', () => {
  for (const tf of ['5s', '15s', '30s', '5m', '15m']) {
    assert.equal(manifest.negativeControls.timeframes[tf].status, 'NOT_SUPPLIED');
  }
  assert.equal(config.negativeControls.syntheticResultsCannotSatisfyAcceptance, true);
});
