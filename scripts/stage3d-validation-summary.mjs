import fs from 'node:fs/promises';

const manifestPath = process.argv[2] || 'validation/stage3d-labeled-results.json';
const REQUIRED_NON_M1 = ['5s','15s','30s','5m','15m'];
const REQUIRED_NEGATIVE_CHARTS = ['line','bars','heikin_ashi'];

const unique = (values) => [...new Set(values)];
const countStatuses = (frames, field) => {
  const counts = {};
  for (const frame of frames) {
    const value = frame.fields?.[field] ?? 'MISSING';
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
};

let manifest;
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
} catch (error) {
  console.error('Could not read Stage 3D manifest: ' + (error instanceof Error ? error.message : String(error)));
  process.exit(2);
}

if (manifest.version !== 'stage3d-session-manifest-v2' || !Array.isArray(manifest.sessions) || !manifest.frozenSpec?.specId) {
  console.error('Invalid Stage 3D manifest.');
  process.exit(2);
}

const currentSpecId = manifest.frozenSpec.specId;
const explicitlyInvalidated = new Set(
  (manifest.specHistory || []).flatMap((entry) => Array.isArray(entry.invalidatedAcceptanceSessionIds) ? entry.invalidatedAcceptanceSessionIds : [])
);

const calibration = manifest.sessions.filter((session) => session.split === 'calibration');
const rawAcceptance = manifest.sessions.filter((session) => session.split === 'acceptance');
const contaminatedAcceptance = rawAcceptance.filter(
  (session) => session.evaluatedSpecId !== currentSpecId || explicitlyInvalidated.has(session.sessionId)
);
const contaminatedIds = new Set(contaminatedAcceptance.map((session) => session.sessionId));
const acceptance = rawAcceptance.filter((session) => !contaminatedIds.has(session.sessionId));

const calibrationIds = new Set(calibration.map((session) => session.sessionId));
const overlap = acceptance.map((session) => session.sessionId).filter((id) => calibrationIds.has(id));

const failedFrames = [];
const conditionMap = new Map();
for (const session of acceptance) {
  const key = [session.asset, session.timeframe, session.chartType, session.windowState].join(' | ');
  if (!conditionMap.has(key)) conditionMap.set(key, { asset:session.asset,timeframe:session.timeframe,chartType:session.chartType,windowState:session.windowState,frames:[] });
  const group = conditionMap.get(key);
  for (const frame of session.frames || []) {
    group.frames.push(frame);
    if (!frame.pass || frame.expectedGate !== frame.actualGate) {
      failedFrames.push({
        sessionId:session.sessionId,
        frameId:frame.frameId,
        asset:session.asset,
        timeframe:session.timeframe,
        chartType:session.chartType,
        windowState:session.windowState,
        expectedGate:frame.expectedGate,
        actualGate:frame.actualGate,
        failureReasons:Array.isArray(frame.failureReasons) ? frame.failureReasons : []
      });
    }
  }
}

const perCondition = [...conditionMap.values()].map((group) => ({
  asset:group.asset,
  timeframe:group.timeframe,
  chartType:group.chartType,
  windowState:group.windowState,
  frames:group.frames.length,
  passed:group.frames.filter((frame) => frame.pass && frame.expectedGate === frame.actualGate).length,
  failed:group.frames.filter((frame) => !frame.pass || frame.expectedGate !== frame.actualGate).length,
  fields:{
    timeframeBadge:countStatuses(group.frames,'timeframeBadge'),
    timeAxis:countStatuses(group.frames,'timeAxis'),
    chartType:countStatuses(group.frames,'chartType'),
    asset:countStatuses(group.frames,'asset'),
    priceAxis:countStatuses(group.frames,'priceAxis'),
    clock:countStatuses(group.frames,'clock'),
    payout:countStatuses(group.frames,'payout')
  }
}));

const allSessionIds = unique(manifest.sessions.map((session) => session.sessionId));
const acceptanceSessionIds = unique(acceptance.map((session) => session.sessionId));
const acceptanceAssets = unique(acceptance.map((session) => session.asset));
const acceptanceWindowStates = unique(acceptance.map((session) => session.windowState));
const acceptanceTimeframes = unique(acceptance.map((session) => session.timeframe));
const missingNonM1 = REQUIRED_NON_M1.filter((value) => !acceptanceTimeframes.includes(value));

const negative = manifest.negativeControls || {};
const chartControls = negative.chartTypes || {};
const missingNegativeCharts = REQUIRED_NEGATIVE_CHARTS.filter((type) => chartControls[type]?.status !== 'PASS_REAL');
const timeframeControls = negative.timeframes || {};
const separateTimeframeChecks = Object.fromEntries(REQUIRED_NON_M1.map((tf) => [tf, {
  badgeCheck:timeframeControls[tf]?.badgeCheck || 'NOT_RUN',
  timeAxisCheck:timeframeControls[tf]?.timeAxisCheck || 'NOT_RUN'
}]));
const missingSeparateTimeframeChecks = REQUIRED_NON_M1.filter((tf) => (
  separateTimeframeChecks[tf].badgeCheck !== 'REJECTED_REAL'
  || separateTimeframeChecks[tf].timeAxisCheck !== 'REJECTED_REAL'
));

const live = manifest.liveAcceptance || {};
const coverage = {
  sessionsTotal:allSessionIds.length,
  untouchedAcceptanceSessions:acceptanceSessionIds.length,
  contaminatedAcceptanceSessions:contaminatedAcceptance.map((session) => session.sessionId),
  acceptanceAssets:acceptanceAssets.length,
  acceptanceWindowStates:acceptanceWindowStates.length,
  missingNonM1,
  missingNegativeCharts,
  missingSeparateTimeframeChecks,
  postDeploymentDecisions:Number(live.postDeploymentDecisions || 0),
  replayMatches:Number(live.replayMatches || 0)
};

const acceptanceComplete =
  overlap.length === 0
  && contaminatedAcceptance.length === 0
  && coverage.sessionsTotal >= 3
  && coverage.untouchedAcceptanceSessions >= 2
  && coverage.acceptanceAssets >= 2
  && coverage.acceptanceWindowStates >= 2
  && missingNonM1.length === 0
  && missingNegativeCharts.length === 0
  && missingSeparateTimeframeChecks.length === 0
  && failedFrames.length === 0
  && coverage.postDeploymentDecisions >= 5
  && coverage.replayMatches >= 5;

console.log(JSON.stringify({
  version:'stage3d-validation-summary-v1',
  sourceManifest:manifestPath,
  currentSpecId,
  calibrationSessionIds:calibration.map((session) => session.sessionId),
  untouchedAcceptanceSessionIds:acceptanceSessionIds,
  contaminatedAcceptanceSessions:contaminatedAcceptance.map((session) => ({
    sessionId:session.sessionId,
    evaluatedSpecId:session.evaluatedSpecId,
    currentSpecId,
    reason:explicitlyInvalidated.has(session.sessionId) ? 'INVALIDATED_BY_RECORDED_SPEC_CHANGE' : 'SPEC_ID_MISMATCH'
  })),
  overlap,
  coverage,
  negativeControls:{
    chartTypes:chartControls,
    timeframes:separateTimeframeChecks
  },
  perCondition,
  failedFrames,
  acceptanceComplete,
  productionLockRecommendation:acceptanceComplete
    ? 'ELIGIBLE_FOR_MANUAL_REVIEW_ONLY_DO_NOT_AUTO_UNLOCK'
    : 'KEEP_LAYOUT_VALIDATION_INCOMPLETE'
}, null, 2));

if (!acceptanceComplete) process.exitCode = 1;
