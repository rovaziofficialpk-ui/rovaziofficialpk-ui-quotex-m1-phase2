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
  const run = spawnSync(process.execPath, ['--test', 'tests/phase1-production-runtime.test.mjs'], {
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

console.log(JSON.stringify({ mutationCheckVersion:'phase1-v1', results }, null, 2));
