import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const mutants = [
  {
    name: 'audit-edge-gate-directional-pass',
    file: 'src/services/edgeGate.ts',
    from: "    bias: 'NEUTRAL',",
    to: "    bias: signal.bias,",
  },
  {
    name: 'layout-not-found-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "  if (!layoutFound) reasons.push('LAYOUT_NOT_FOUND');",
    to: "  if (false && !layoutFound) reasons.push('LAYOUT_NOT_FOUND');",
  },

  {
    name: 'letterbox-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "  if (metrics.outerNearBlackRatio > PROFILE.maxNearBlackEdge) reasons.push('LETTERBOX_DETECTED');",
    to: "  if (false && metrics.outerNearBlackRatio > PROFILE.maxNearBlackEdge) reasons.push('LETTERBOX_DETECTED');",
  },
  {
    name: 'candle-count-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "  if (metrics.candleCount < PROFILE.minCandles || metrics.candleCount > PROFILE.maxCandles) reasons.push('CANDLE_COUNT_OUT_OF_RANGE');",
    to: "  if (false && (metrics.candleCount < PROFILE.minCandles || metrics.candleCount > PROFILE.maxCandles)) reasons.push('CANDLE_COUNT_OUT_OF_RANGE');",
  },
  {
    name: 'newest-candle-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "  if (metrics.lastCandleXFraction === null || metrics.lastCandleXFraction < 0.45 || metrics.lastCandleXFraction > 0.80) reasons.push('NEWEST_CANDLE_NOT_VISIBLE');",
    to: "  if (false && (metrics.lastCandleXFraction === null || metrics.lastCandleXFraction < 0.45 || metrics.lastCandleXFraction > 0.80)) reasons.push('NEWEST_CANDLE_NOT_VISIBLE');",
  },
  {
    name: 'current-price-marker-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "  if (metrics.currentPriceBlueRatio < PROFILE.minPriceBlue || metrics.horizontalMarkerRowRatio < PROFILE.minMarkerRow) reasons.push('CURRENT_PRICE_MARKER_MISSING');",
    to: "  if (false && (metrics.currentPriceBlueRatio < PROFILE.minPriceBlue || metrics.horizontalMarkerRowRatio < PROFILE.minMarkerRow)) reasons.push('CURRENT_PRICE_MARKER_MISSING');",
  },
  {
    name: 'price-axis-readable-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "    if (!args.priceAxisReadable) reasons.push('PRICE_AXIS_UNREADABLE');",
    to: "    if (false && !args.priceAxisReadable) reasons.push('PRICE_AXIS_UNREADABLE');",
  },
  {
    name: 'time-axis-readable-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "    if (!args.timeAxisReadable) reasons.push('TIME_AXIS_UNREADABLE');",
    to: "    if (false && !args.timeAxisReadable) reasons.push('TIME_AXIS_UNREADABLE');",
  },
  {
    name: 'timeframe-unverified-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "    if (!args.parsedTimeframe) reasons.push('TIMEFRAME_UNVERIFIED');",
    to: "    if (false && !args.parsedTimeframe) reasons.push('TIMEFRAME_UNVERIFIED');",
  },
  {
    name: 'timeframe-mismatch-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "    else if (args.parsedTimeframe !== args.configuredTimeframe) reasons.push('TIMEFRAME_MISMATCH');",
    to: "    else if (false && args.parsedTimeframe !== args.configuredTimeframe) reasons.push('TIMEFRAME_MISMATCH');",
  },
  {
    name: 'asset-unverified-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "    if (!args.configuredAsset || !args.parsedAsset) reasons.push('ASSET_UNVERIFIED');",
    to: "    if (false && (!args.configuredAsset || !args.parsedAsset)) reasons.push('ASSET_UNVERIFIED');",
  },
  {
    name: 'asset-mismatch-gate-disabled',
    file: 'src/services/screenPipeline.ts',
    from: "    else if (args.parsedAsset !== args.configuredAsset) reasons.push('ASSET_MISMATCH');",
    to: "    else if (false && args.parsedAsset !== args.configuredAsset) reasons.push('ASSET_MISMATCH');",
  },
  {
    name: 'field-coverage-lock-enabled',
    file: 'src/services/screenFieldVerification.ts',
    from: 'export const LAYOUT_VALIDATION_COVERAGE_COMPLETE = false;',
    to: 'export const LAYOUT_VALIDATION_COVERAGE_COMPLETE = true;',
  },
  {
    name: 'stage3c-coverage-lock-enabled',
    file: 'src/services/screenStage3C.ts',
    from: 'export const STAGE3C_VALIDATION_COVERAGE_COMPLETE = false;',
    to: 'export const STAGE3C_VALIDATION_COVERAGE_COMPLETE = true;',
  },
  {
    name: 'wilson-z-zeroed',
    file: 'src/services/precisionOptimizer.ts',
    from: '  const z = 1.959963984540054;',
    to: '  const z = 0;',
  },
  {
    name: 'wilson-ties-added-to-denominator',
    file: 'src/services/precisionOptimizer.ts',
    from: '  const decided = wins + losses;',
    to: '  const decided = wins + losses + ties;',
  },
  {
    name: 'payout-breakeven-formula-broken',
    file: 'src/services/screenStage3C.ts',
    from: '    breakevenWinRate: Number((1 / (1 + payoutDecimal)).toFixed(6)),',
    to: '    breakevenWinRate: Number((1 / payoutDecimal).toFixed(6)),',
  },
  {
    name: 'timeframe-and-changed-to-or',
    file: 'src/services/screenFieldVerification.ts',
    from: '  const timeframeVerified = badgeSaysM1 && timeAxis.verifiedM1;',
    to: '  const timeframeVerified = badgeSaysM1 || timeAxis.verifiedM1;',
  },
  {
    name: 'chart-type-threshold-bypassed',
    file: 'src/services/screenStage3C.ts',
    from: '  if (candleScore !== null && candleScore >= CHARTTYPE_CANDLE_THRESHOLD) {',
    to: '  if (candleScore !== null) {',
  },
  {
    name: 'price-axis-r2-bypassed',
    file: 'src/services/screenStage3C.ts',
    from: '      && r2 !== null && r2 >= PRICE_AXIS_R2_MIN',
    to: '      && r2 !== null',
  },
  {
    name: 'price-axis-pixel-spacing-bypassed',
    file: 'src/services/screenStage3C.ts',
    from: '      && pixelSpacingCv !== null && pixelSpacingCv <= PRICE_AXIS_PIXEL_SPACING_CV_MAX',
    to: '      && pixelSpacingCv !== null',
  },
  {
    name: 'price-axis-price-step-bypassed',
    file: 'src/services/screenStage3C.ts',
    from: '      && priceStepCv !== null && priceStepCv <= PRICE_AXIS_STEP_CV_MAX;',
    to: '      && priceStepCv !== null;',
  },
  {
    name: 'clock-staleness-disabled',
    file: 'src/services/screenStage3C.ts',
    from: '    const stale = delta > CLOCK_STALE_TOLERANCE_SECONDS;',
    to: '    const stale = false;',
  },
  {
    name: 'payout-ambiguity-check-disabled',
    file: 'src/services/screenStage3C.ts',
    from: '  if (candidates.length !== 1) {',
    to: '  if (false && candidates.length !== 1) {',
  },
  {
    name: 'model-bias-enum-disabled',
    file: 'src/signalLogic.ts',
    from: "const isTradeBias = (value: unknown): value is TradeBias =>\n  value === 'CALL' || value === 'PUT' || value === 'NEUTRAL';",
    to: "const isTradeBias = (_value: unknown): _value is TradeBias => true;",
  },
  {
    name: 'outcome-entry-null-check-disabled',
    file: 'src/services/outcomeResolver.ts',
    from: "  if (args.entry.price.price === null) return { outcome: null, nullReason: args.entry.price.reasonCode || 'ENTRY_PRICE_UNREADABLE', unitReturn: null };",
    to: "  if (false && args.entry.price.price === null) return { outcome: null, nullReason: args.entry.price.reasonCode || 'ENTRY_PRICE_UNREADABLE', unitReturn: null };",
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
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--loader', './tests/phase1-ts-loader.mjs', '--test', 'tests/phase1-production-runtime.audit.mjs'], {
    encoding: 'utf8',
    env: process.env,
  });
  fs.writeFileSync(mutant.file, original);
  results.push({
    name: mutant.name,
    status: run.status === 0 ? 'UNDETECTED' : 'DETECTED',
    exitCode: run.status,
    evidence: (run.stdout + run.stderr).split('\n').filter(Boolean).slice(-8),
  });
}

console.log(JSON.stringify({ mutationCheckVersion:'phase1-v2', results }, null, 2));
