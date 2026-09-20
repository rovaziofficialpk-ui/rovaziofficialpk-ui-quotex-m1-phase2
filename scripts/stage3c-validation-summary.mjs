import fs from 'node:fs/promises';

const manifestPath = process.argv[2] || 'validation/stage3c-labeled-results.json';
const REQUIRED_NON_M1 = ['5s','15s','30s','5m','15m'];

function unique(values) { return [...new Set(values)]; }

let manifest;
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
} catch (error) {
  console.error('Could not read Stage 3C manifest: ' + (error instanceof Error ? error.message : String(error)));
  process.exit(2);
}

if (manifest.version !== 'stage3c-session-manifest-v1' || !Array.isArray(manifest.sessions)) {
  console.error('Invalid manifest version or sessions list.');
  process.exit(2);
}

const calibration = manifest.sessions.filter((session) => session.split === 'calibration');
const acceptance = manifest.sessions.filter((session) => session.split === 'acceptance');
const calibrationIds = new Set(calibration.map((session) => session.sessionId));
const overlap = acceptance.map((session) => session.sessionId).filter((id) => calibrationIds.has(id));

const frameFailures = [];
for (const session of acceptance) {
  for (const frame of session.frames || []) {
    if (frame.expectedGate !== frame.actualGate) {
      frameFailures.push({ sessionId: session.sessionId, frameId: frame.frameId, expectedGate: frame.expectedGate, actualGate: frame.actualGate });
    }
  }
}

const allSessionIds = unique(manifest.sessions.map((session) => session.sessionId));
const acceptanceSessionIds = unique(acceptance.map((session) => session.sessionId));
const acceptanceAssets = unique(acceptance.map((session) => session.asset));
const acceptanceWindowStates = unique(acceptance.map((session) => session.windowState));
const acceptanceTimeframes = unique(acceptance.map((session) => session.timeframe));
const missingNonM1 = REQUIRED_NON_M1.filter((value) => !acceptanceTimeframes.includes(value));
const live = manifest.liveAcceptance || {};

const coverage = {
  sessionsTotal: allSessionIds.length,
  acceptanceSessions: acceptanceSessionIds.length,
  acceptanceAssets: acceptanceAssets.length,
  acceptanceWindowStates: acceptanceWindowStates.length,
  missingNonM1,
  postDeploymentDecisions: Number(live.postDeploymentDecisions || 0),
  replayMatches: Number(live.replayMatches || 0)
};

const acceptanceComplete =
  overlap.length === 0 &&
  coverage.sessionsTotal >= 3 &&
  coverage.acceptanceSessions >= 2 &&
  coverage.acceptanceAssets >= 2 &&
  coverage.acceptanceWindowStates >= 2 &&
  missingNonM1.length === 0 &&
  frameFailures.length === 0 &&
  coverage.postDeploymentDecisions >= 5 &&
  coverage.replayMatches >= 5;

const report = {
  version: 'stage3c-validation-summary-v1',
  sourceManifest: manifestPath,
  calibrationSessionIds: calibration.map((session) => session.sessionId),
  acceptanceSessionIds,
  overlap,
  coverage,
  frameFailures,
  acceptanceComplete,
  productionLockRecommendation: acceptanceComplete ? 'ELIGIBLE_FOR_MANUAL_REVIEW_ONLY_DO_NOT_AUTO_UNLOCK' : 'KEEP_LAYOUT_VALIDATION_INCOMPLETE'
};

console.log(JSON.stringify(report, null, 2));
if (!acceptanceComplete) process.exitCode = 1;
