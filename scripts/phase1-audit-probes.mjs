import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = {
  server: fs.readFileSync('server.mjs','utf8'),
  app: fs.readFileSync('src/App.tsx','utf8'),
  backtest: fs.readFileSync('src/components/BacktestPanel.tsx','utf8'),
  signal: fs.readFileSync('src/signalLogic.ts','utf8'),
  readme: fs.readFileSync('README.md','utf8'),
  pkg: JSON.parse(fs.readFileSync('package.json','utf8')),
  stage3c: fs.readFileSync('src/services/screenStage3C.ts','utf8'),
  repro: fs.readFileSync('src/services/reproAudit.ts','utf8'),
  outcome: fs.readFileSync('src/services/outcomeResolver.ts','utf8'),
  precision: fs.readFileSync('src/services/precisionOptimizer.ts','utf8'),
  tabCapture: fs.readFileSync('src/services/tabCapture.ts','utf8'),
  outcomeResolverSource: fs.readFileSync('src/services/outcomeResolver.ts','utf8'),
  backtestService: fs.readFileSync('src/services/backtest.ts','utf8'),
  phases: fs.readFileSync('PHASES.md','utf8'),
  stage3bReport: fs.readFileSync('STAGE3B_VERIFICATION_REPORT.md','utf8'),
  stage3cReport: fs.readFileSync('STAGE3C_REPORT.md','utf8'),
  auditSignalLogSource: fs.readFileSync('src/services/auditSignalLog.ts','utf8'),
  auditArtifactsSource: fs.readFileSync('src/services/auditArtifacts.ts','utf8'),
  screenPipelineSource: fs.readFileSync('src/services/screenPipeline.ts','utf8'),
  historyPanelSource: fs.readFileSync('src/components/HistoryPanel.tsx','utf8'),
  storageSource: fs.readFileSync('src/services/storage.ts','utf8'),
  serverSecurity: fs.readFileSync('server/batch1Security.mjs','utf8'),
  serverGate: fs.readFileSync('server/deterministicGate.mjs','utf8'),
  imagePreflightSource: fs.readFileSync('src/services/imagePreflight.ts','utf8'),
  outcomePanelSource: fs.readFileSync('src/components/OutcomeResolverPanel.tsx','utf8'),
  exportHistorySource: fs.readFileSync('src/utils/exportHistory.ts','utf8'),
};

const signalLogic = await import('../src/signalLogic.ts');

function modelPayload(overrides={}) {
  return {
    pair:'EUR/USD', bias:'CALL', confidence:80, pattern:'x', entry:'x',
    chartQuality:'clear', timeframe:'M1', trend:'bullish', momentum:'bullish',
    structure:'bullish', candleSignal:'bullish', supportResistance:'x',
    evidence:['x'], contextAlignment:'not_provided', contextNotes:'', warnings:[],
    ...overrides,
  };
}

const findings = [];

const groqRoute = files.server.match(/if \(req\.method === 'POST' && url\.pathname === '\/api\/groq\/analyze'\) \{([\s\S]*?)\n      \}/);
findings.push({
  id:'R2-SERVER-GATE',
  status: groqRoute
    && /validateAnalyzeRequest/.test(groqRoute[1])
    && /verifyNativeFrame/.test(groqRoute[1])
    && /verification\.eligibleForModel/.test(groqRoute[1])
    && /fixedGroqPayload/.test(groqRoute[1])
    && !/proxyGroq\(payload\)/.test(groqRoute[1])
    ? 'PASS'
    : 'CONFIRMED_FAIL',
  evidence: groqRoute ? groqRoute[0] : 'route not found',
});

findings.push({
  id:'R4-REPLAY',
  status: /const replayedFinalBias = 'NEUTRAL'/.test(files.server) ? 'CONFIRMED_FAIL' : 'UNVERIFIED',
  evidence: /const replayedFinalBias = 'NEUTRAL'/.test(files.server)
    ? "replayRecent hard-codes replayedFinalBias='NEUTRAL' instead of recomputing deterministic gates"
    : 'constant replay not found',
});

findings.push({
  id:'R1-BACKTEST-VISIBLE-DIRECTION',
  status: /signal: result\.signal/.test(files.backtest) && /row\.bias === 'CALL'/.test(files.backtest) ? 'CONFIRMED_FAIL' : 'UNVERIFIED',
  evidence: 'Backtest rows are created from result.signal and render row.bias as CALL/PUT/NEUTRAL without applyAuditEdgeGate.',
});

let stringConfidenceAccepted = false;
let outOfRangeAccepted = false;
try { signalLogic.validateModelSignal(JSON.stringify(modelPayload({ confidence:'80' }))); stringConfidenceAccepted = true; } catch {}
try { signalLogic.validateModelSignal(JSON.stringify(modelPayload({ confidence:1000 }))); outOfRangeAccepted = true; } catch {}
findings.push({
  id:'G-STRICT-CLIENT-SCHEMA',
  status: stringConfidenceAccepted || outOfRangeAccepted ? 'CONFIRMED_FAIL' : 'CONFIRMED_PASS',
  evidence: { stringConfidenceAccepted, outOfRangeAccepted },
});

findings.push({
  id:'C-PREFLIGHT-AUDIT-DROP',
  status: /if \(quality\.status === 'block'\) \{[\s\S]*?return;/.test(files.app)
    && !/if \(quality\.status === 'block'\) \{[\s\S]*?persistReproDecision/.test(files.app)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'Auto-Test preflight block returns before executeAiAnalysis/audit record creation.',
});

findings.push({
  id:'R8-AUTOTEST-ERROR-CLEAR',
  status: /const resultSignal = await executeAiAnalysis[\s\S]*?setError\(''\)/.test(files.app) ? 'CONFIRMED_FAIL' : 'UNVERIFIED',
  evidence: "Auto-Test clears setError('') immediately after executeAiAnalysis returns, including deterministic NEUTRAL rejects that set a detailed error.",
});

findings.push({
  id:'R9-README-SECRET-DOC',
  status: /Groq API key is stored in the current browser's localStorage/.test(files.readme) ? 'CONFIRMED_FAIL' : 'CONFIRMED_PASS',
  evidence: 'README claims browser localStorage BYOK, while current code uses server-side GROQ_API_KEY and sessionStorage audit token.',
});

findings.push({
  id:'B-LINTER',
  status: files.pkg.scripts?.lint ? 'CONFIGURED' : 'NOT_CONFIGURED',
  evidence: files.pkg.scripts?.lint ?? null,
});

const lockfileTracked = spawnSync('git', ['ls-files', '--error-unmatch', 'package-lock.json'], { encoding:'utf8' }).status === 0;
findings.push({
  id:'B-LOCKFILE',
  status: lockfileTracked ? 'TRACKED' : 'MISSING_FROM_REPO',
  evidence: lockfileTracked
    ? 'package-lock.json is tracked in the audited commit.'
    : 'npm install may generate package-lock.json locally, but the audited commit does not track one.',
});


const repairedUnknowns = signalLogic.validateModelSignal(JSON.stringify(modelPayload({
  pair: '',
  pattern: '',
  entry: '',
  supportResistance: '',
})));
findings.push({
  id:'R5-MODEL-UNKNOWN-REPAIRS',
  status: repairedUnknowns.pair === 'Unknown Asset'
    && repairedUnknowns.pattern === 'No clear pattern'
    && repairedUnknowns.entry.startsWith('No trade')
    && repairedUnknowns.supportResistance.startsWith('No reliable level')
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: {
    pair: repairedUnknowns.pair,
    pattern: repairedUnknowns.pattern,
    entry: repairedUnknowns.entry,
    supportResistance: repairedUnknowns.supportResistance,
  },
});

findings.push({
  id:'AI-SERVER-PAYLOAD-NOT-FROZEN',
  status: /GROQ_FIXED_MODEL/.test(files.serverSecurity)
    && /GROQ_FIXED_TEMPERATURE = 0/.test(files.serverSecurity)
    && /GROQ_FIXED_SEED = 424242/.test(files.serverSecurity)
    && /strict: true/.test(files.serverSecurity)
    && /additionalProperties: false/.test(files.serverSecurity)
    && /CLIENT_MODEL_PARAMETERS_FORBIDDEN/.test(files.serverSecurity)
    ? 'PASS'
    : 'CONFIRMED_FAIL',
  evidence: 'Batch 1 server policy owns model, temperature, seed, strict response schema and rejects client model-parameter fields.',
});

findings.push({
  id:'AI-SERVER-UPSTREAM-TIMEOUT',
  status: /const controller = new AbortController\(\)/.test(files.server)
    && /signal: controller\.signal/.test(files.server)
    && /GROQ_UPSTREAM_TIMEOUT_MS/.test(files.server)
    && /GROQ_UPSTREAM_TIMEOUT/.test(files.server)
    ? 'PASS'
    : 'CONFIRMED_FAIL',
  evidence: 'Server proxy has an independent AbortController timeout and returns GROQ_UPSTREAM_TIMEOUT on abort.',
});

findings.push({
  id:'AI-REQUEST-SIZE-POLICY',
  status: /ANALYZE_MAX_BODY_BYTES = 28 \* 1024 \* 1024/.test(files.serverSecurity)
    && /ANALYZE_MAX_IMAGE_BYTES = 20 \* 1024 \* 1024/.test(files.serverSecurity)
    && /readJson\(req, ANALYZE_MAX_BODY_BYTES\)/.test(files.server)
    && /decoded\.bytes\.length > ANALYZE_MAX_IMAGE_BYTES/.test(files.server)
    ? 'PASS'
    : 'CONFIRMED_MISMATCH',
  evidence: 'Analyze body and decoded native-frame byte limits are independently enforced server-side.',
});

const outcomeRoute = files.server.match(/if \(req\.method === 'POST' && url\.pathname === '\/api\/outcomes\/events'\) \{([\s\S]*?)\n      \}/);
findings.push({
  id:'OUTCOME-SERVER-SCHEMA',
  status: outcomeRoute
    && /\.\.\.body/.test(outcomeRoute[1])
    && !/zod|schema|price|payout|direction.*CALL|direction.*PUT/.test(outcomeRoute[1])
    ? 'CONFIRMED_WEAK'
    : 'UNVERIFIED',
  evidence: 'Outcome POST validates eventId/tradeId/eventType, then persists ...body without a strict server schema for payload fields.',
});

findings.push({
  id:'AUDIT-HASHCHAIN-CONCURRENCY',
  status: /withSerializedFileWrite/.test(files.serverSecurity)
    && /const prior = queues\.get\(file\)/.test(files.serverSecurity)
    && /await fs\.appendFile/.test(files.serverSecurity)
    && /appendSerializedHashedRecord/.test(files.server)
    ? 'PASS'
    : 'CONFIRMED_RACE_RISK',
  evidence: 'Batch 1 serializes each hash-chained file through a single per-file promise queue; runtime integration must agree with this source probe.',
});


findings.push({
  id:'MALFORMED-JSON-STATUS',
  status: /throw malformedJsonError\(\)/.test(files.server)
    && /statusCode: 400/.test(files.serverSecurity)
    && /MALFORMED_JSON/.test(files.serverSecurity)
    ? 'PASS'
    : 'CONFIRMED_FAIL',
  evidence: 'Malformed JSON is mapped to a stable MALFORMED_JSON 400 error.',
});

findings.push({
  id:'SECURITY-HEADERS',
  status: /X-Frame-Options/.test(files.serverSecurity)
    && /Content-Security-Policy/.test(files.serverSecurity)
    && /Referrer-Policy/.test(files.serverSecurity)
    && /Permissions-Policy/.test(files.serverSecurity)
    && /securityHeaders/.test(files.server)
    ? 'PASS'
    : 'CONFIRMED_FAIL',
  evidence: 'Batch 1 applies browser security headers to API and static success responses.',
});

findings.push({
  id:'AUDIT-DUPLICATE-RECORDID',
  status: /uniqueField: 'recordId'/.test(files.server)
    && /DUPLICATE_/.test(files.serverSecurity)
    ? 'PASS'
    : 'CONFIRMED_FAIL',
  evidence: 'Duplicate recordId is rejected by the serialized persistent writer.',
});

findings.push({
  id:'AUDIT-TAMPER-DETECTION',
  status: /export async function verifyHashChain/.test(files.serverSecurity)
    && /RECORD_HASH_MISMATCH/.test(files.serverSecurity)
    && /\/api\/audit\/verify/.test(files.server)
    ? 'PASS'
    : 'CONFIRMED_FAIL',
  evidence: 'Server exposes authenticated chain verification and recomputes each record hash.',
});

findings.push({
  id:'AUTOTEST-SKIPPED-FRAME-AUDIT',
  status: /change\.score < AUTO_MIN_CHANGE_SCORE[\s\S]*?return;/.test(files.app)
    && !/change\.score < AUTO_MIN_CHANGE_SCORE[\s\S]*?persistReproDecision/.test(files.app)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'Near-duplicate Auto Test frames increment a UI counter and return without a durable decision/skip audit record.',
});

findings.push({
  id:'AUTOTEST-COOLDOWN-SKIP-AUDIT',
  status: /elapsedSinceAi < AUTO_AI_COOLDOWN_MS[\s\S]*?return;/.test(files.app)
    && !/elapsedSinceAi < AUTO_AI_COOLDOWN_MS[\s\S]*?persistReproDecision/.test(files.app)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'Cooldown-skipped frames are not durably recorded as skipped decisions.',
});

findings.push({
  id:'TRACK-ENDED-REASON',
  status: /track\?\.addEventListener\('ended'[\s\S]*?setLiveTabInfo\(null\)/.test(files.app)
    && !/track\?\.addEventListener\('ended'[\s\S]*?setError\(/.test(files.app)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'The track-ended handler clears live state but does not surface a specific reason code/message on the manual path.',
});

findings.push({
  id:'PAYOUT-NOT-AI-ELIGIBILITY-GATE',
  status: /const payout =/.test(files.stage3c)
    && !/if \(payout\.reasonCode\) reasons\.push/.test(files.stage3c)
    ? 'CONFIRMED'
    : 'UNVERIFIED',
  evidence: 'PAYOUT_UNREADABLE is returned but is not added to Stage3C reasons; payout is not required for productionEligible.',
});

findings.push({
  id:'REPRO-DURABLE-FAILURE-SWALLOWED',
  status: /catch \{\s*return \{ durable: false, recordHash: null \};\s*\}/.test(files.repro)
    ? 'CONFIRMED'
    : 'UNVERIFIED',
  evidence: 'persistReproDecision converts server audit write failure into {durable:false}; caller warning can later be overwritten by another setError.',
});

findings.push({
  id:'PRECISION-LOCALSTORAGE-TRUST',
  status: /window\.localStorage\.getItem\(STORAGE_KEY\)/.test(files.precision)
    && /parsed\.validated/.test(files.precision)
    && /parsed\.payoutValidated/.test(files.precision)
    ? 'CONFIRMED_INTEGRITY_RISK'
    : 'UNVERIFIED',
  evidence: 'Precision profile trust is client-local. Final audit edge gate still forces NEUTRAL, so this is not a final-signal escape.',
});


findings.push({
  id:'CAPTURE-TARGET-DPR-METADATA',
  status: /devicePixelRatio:\s*Number\(\(window\.devicePixelRatio/.test(files.tabCapture)
    && /cssViewportWidth = Math\.max\(0, window\.innerWidth/.test(files.tabCapture)
    && /sourceWidth \/ cssViewportWidth/.test(files.tabCapture)
    ? 'CONFIRMED_DIAGNOSTIC_LIMITATION'
    : 'UNVERIFIED',
  evidence: 'Capture videoWidth/videoHeight describe the shared target, but DPR and CSS viewport come from the analyzer app window. For a different shared tab/window, capturePixelsPerCssPixel mixes two browsing contexts and is not the target tab DPR/zoom.',
});

findings.push({
  id:'CAPTURE-SURFACE-NOT-ENFORCED',
  status: /displaySurface: settings\?\.displaySurface \|\| 'browser'/.test(files.tabCapture)
    && !/displaySurface[^\n]*!==[^\n]*browser|settings\?\.displaySurface[^\n]*===\s*'browser'/.test(files.tabCapture)
    ? 'CONFIRMED'
    : 'UNVERIFIED',
  evidence: 'The picker result records displaySurface but never rejects window/monitor sharing. UI calls it a browser-tab flow, but capture accepts any surface the browser returns.',
});

findings.push({
  id:'CAPTURE-MUTED-TRACK-NOT-CHECKED',
  status: /readyState === 'live' && track\.enabled/.test(files.tabCapture)
    && !/track\.muted/.test(files.tabCapture)
    ? 'CONFIRMED'
    : 'UNVERIFIED',
  evidence: 'isLiveTabStreamActive checks readyState/enabled but not track.muted; a live-but-muted/frozen source is not specifically classified before frame capture.',
});


findings.push({
  id:'CLOCK-STALENESS-COMPARES-POST-OCR-TIME',
  status: /const ocr = await ocrCrop\(crop, 'clock'\);[\s\S]*?const server = await serverUtcNow\(\)/.test(files.stage3c)
    && !/verifyPlatformClock\([^)]*capturedAt/.test(files.stage3c)
    ? 'CONFIRMED_TIMING_BIAS'
    : 'UNVERIFIED',
  evidence: 'The clock text belongs to the captured frame, but server time is fetched only after OCR. The verifier is not passed capturedAt, so OCR/network processing delay is included in serverDeltaSeconds and can cause a valid frame to be marked CLOCK_STALE near the 5s boundary.',
});

findings.push({
  id:'OUTCOME-ENTRY-REFERENCE-NOT-CONTRACT-TARGET',
  status: /const \[price, expiry\] = await Promise\.all\(\[[\s\S]*?readCurrentPrice/.test(files.outcomeResolverSource)
    && !/contract.*target|target.*price/i.test(files.outcomeResolverSource)
    ? 'CONFIRMED_METHOD_MISMATCH'
    : 'UNVERIFIED',
  evidence: 'The documented Quotex settlement reference is the contract purchase/target price, but the screen resolver records a chart current-price tag after the user manually places/records a reference. It does not read the actual contract target price.',
});

findings.push({
  id:'OUTCOME-DUEAT-ASSUMES-CAPTURE-EQUALS-TRADE-ENTRY',
  status: /Date\.parse\(entry\.capturedAt\) \+ \(REQUIRED_EXPIRY_SECONDS \* 1000\)/.test(files.outcomeResolverSource)
    ? 'CONFIRMED_ASSUMPTION'
    : 'UNVERIFIED',
  evidence: 'Resolver expiry capture is scheduled at entry.capturedAt + 60s, not from a platform-reported contract expiration timestamp. Manual trade placement and resolver capture are not proven simultaneous.',
});

findings.push({
  id:'EXPIRY-AMBIGUITY-ONE-60S-CANDIDATE-PASSES',
  status: /const oneMinute = candidates\.filter[\s\S]*?if \(oneMinute\.length === 1\) \{[\s\S]*?verifiedOneMinute: true/.test(files.outcomeResolverSource)
    ? 'CONFIRMED_FAIL_OPEN_IN_RESOLVER'
    : 'UNVERIFIED',
  evidence: 'readExpiryDuration accepts exactly one 60-second token even when other conflicting duration tokens are also present. An ambiguous trade-field crop can therefore be marked verifiedOneMinute=true.',
});

findings.push({
  id:'AUDIT-RECORD-SERVER-SCHEMA',
  status: /validateDecisionRecord\(payload\.record\)/.test(files.server)
    && /validateAuditArtifactEnvelope\(artifact\)/.test(files.server)
    && /uniqueField: 'recordId'/.test(files.server)
    && /INVALID_AUDIT_RECORD_SCHEMA/.test(files.serverSecurity)
    ? 'PASS'
    : 'CONFIRMED_WEAK',
  evidence: 'Batch 1 validates the decision-record envelope and artifact envelope server-side and enforces unique recordId.',
});


findings.push({
  id:'SPEC-MIN-CONFIDENCE-MUTABLE-WITHOUT-BUMP',
  status: /logSettingChange\('minConfidence',[\s\S]*?INPUT_PIPELINE_CONFIG_VERSION\);[\s\S]*?setMinConfidence\(value\)/.test(files.app)
    ? 'CONFIRMED_SPEC_HYGIENE_FAIL'
    : 'UNVERIFIED',
  evidence: 'The live minimum-confidence threshold is user-mutable and logged under the existing config version. No new spec ID/config version is created and no acceptance sessions are invalidated.',
});

{
  const start = files.app.indexOf('const captureOutcomeResolverSnapshot');
  const end = files.app.indexOf('const executeAiAnalysis', start);
  const outcomeSnapshotFn = start >= 0 && end > start ? files.app.slice(start, end) : '';
  findings.push({
    id:'OUTCOME-SNAPSHOT-IGNORES-STRUCTURAL-GATE',
    status: /const deterministic = await inspectAndCropSingleFrame/.test(outcomeSnapshotFn)
      && /verifyStage3CFrame\(\{/.test(outcomeSnapshotFn)
      && /return buildResolverSnapshot\(/.test(outcomeSnapshotFn)
      && !/if\s*\(\s*!?deterministic\.safeForAi/.test(outcomeSnapshotFn)
      ? 'CONFIRMED_FAIL_OPEN_IN_RESOLVER'
      : 'UNVERIFIED',
    evidence: 'Outcome snapshot capture computes the structural deterministic result but does not require deterministic.safeForAi before building a resolver snapshot. Structural failures are not merged into verification.reasons.',
  });
}

findings.push({
  id:'OUTCOME-RESOLVE-IGNORES-ASSET-AND-FRAME-REASONS',
  status: /export function resolveOutcome/.test(files.outcomeResolverSource)
    && !/args\.entry\.asset[^\n]*args\.expiry\.asset|frameReasons\.length/.test((files.outcomeResolverSource.match(/export function resolveOutcome[\s\S]*?\n\}/)||[''])[0])
    ? 'CONFIRMED_FAIL_OPEN_IN_RESOLVER'
    : 'UNVERIFIED',
  evidence: 'resolveOutcome checks expiry duration, entry/expiry prices and payout, but does not require matching entry/expiry asset or empty frameReasons. A readable wrong-asset/stale/otherwise-invalid snapshot can still resolve WIN/LOSS/TIE.',
});

findings.push({
  id:'REPLAY-CLI-CONSTANT-NEUTRAL',
  status: fs.readFileSync('scripts/replay-audit.mjs','utf8').includes("const replayed = stored.preAuditBias === 'NEUTRAL' ? 'NEUTRAL' : 'NEUTRAL'")
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'The CLI replay script also reduces every stored decision to NEUTRAL instead of recomputing the deterministic pipeline.',
});


findings.push({
  id:'BACKTEST-UNKNOWN-TIMEFRAME-ALLOWED',
  status: /if \(dataset\.timeframeStatus === 'not_m1'\)/.test(files.backtest)
    && !/if \(dataset\.timeframeStatus !== 'm1'\)/.test(files.backtest)
    ? 'CONFIRMED_FAIL_OPEN_RESEARCH_PATH'
    : 'UNVERIFIED',
  evidence: "Backtest run rejects only timeframeStatus='not_m1'; timeframeStatus='unknown' proceeds to AI replay.",
});

findings.push({
  id:'BACKTEST-SYNTHETIC-M1-TIMESTAMPS',
  status: /const timestamp = parsedTime \?\? \(\(candles\.length \+ 1\) \* 60_000\)/.test(files.backtestService)
    ? 'CONFIRMED_GUESS'
    : 'UNVERIFIED',
  evidence: 'Rows without parseable time are assigned synthetic 60-second timestamps. The dataset is still marked timeframeStatus=unknown, but the run path allows unknown.',
});

findings.push({
  id:'BACKTEST-OHLC-INVARIANTS-INCOMPLETE',
  status: /high < low/.test(files.backtestService)
    && !/open > high|open < low|close > high|close < low/.test(files.backtestService)
    ? 'CONFIRMED_WEAK'
    : 'UNVERIFIED',
  evidence: 'CSV validation rejects high<low but does not require open/close to lie within [low, high], so impossible OHLC rows can be accepted.',
});

findings.push({
  id:'BACKTEST-M1-MEDIAN-ONLY',
  status: /medianIntervalSeconds >= 45 && medianIntervalSeconds <= 75/.test(files.backtestService)
    ? 'CONFIRMED_WEAK'
    : 'UNVERIFIED',
  evidence: 'Backtest timeframe classification uses only the median timestamp interval; a series containing substantial 30s/120s gaps can still be labeled M1 when the median is 60s.',
});


findings.push({
  id:'R9-README-CONTEXT-UPLOAD-STALE',
  status: /Optional M5 and H1 context screenshots/.test(files.readme)
    && /contextImages:\s*\[\]/.test(files.app)
    && !/<ContextImagesPanel/.test(files.app)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'README advertises optional M5/H1 context screenshots, but the current decision path hardcodes contextImages:[] and App does not render ContextImagesPanel.',
});

findings.push({
  id:'R9-PRECISION-ENABLEMENT-STALE',
  status: /A profile is not enabled live unless the untouched holdout reaches 80%\+/.test(files.readme)
    && /const validated = false/.test(files.precision)
    && /const payoutValidated = false/.test(files.precision)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'README describes an optimizer-produced validated profile, while current optimizer hard-codes validated=false and payoutValidated=false for every generated profile.',
});

findings.push({
  id:'R9-PHASE5-PROXY-STALE',
  status: /Phase 5 — Production security[\s\S]*Server-side API proxy or authenticated accounts/.test(files.phases)
    && /url\.pathname === '\/api\/groq\/analyze'/.test(files.server)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'PHASES.md presents server-side proxy/auth as future Phase 5, but production already contains authenticated server proxy routes.',
});

findings.push({
  id:'R9-RAW-SOURCE-PERSISTENCE-CLAIM-STALE',
  status: /raw source screenshot bytes are no longer persisted/.test(files.stage3bReport)
    && /buildFullFrameArtifact\('native_source_frame_png'/.test(files.app)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'Stage3B report says raw source bytes are no longer persisted, but current timeframe rejection path deliberately persists a full native source PNG.',
});

findings.push({
  id:'R9-STAGE3C-GROQ-DEPLOYMENT-STALE',
  status: /GROQ_API_KEY is still absent from the Railway environment/.test(files.stage3cReport)
    ? 'CONFIRMED_STALE_DEPLOYMENT_CLAIM'
    : 'UNVERIFIED',
  evidence: 'Current Railway runtime reports server-side Groq configured=true, while STAGE3C_REPORT says the key is absent.',
});

findings.push({
  id:'R9-BACKTEST-SAME-GATES-CLAIM',
  status: /same Phase 3 gates/.test(files.backtest)
    && !/inspectAndCropSingleFrame|verifyStage3CFrame/.test(files.backtest)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'Backtest UI says same Phase 3 gates, but BacktestPanel invokes image preflight + analyzeChartWithGroq without the live deterministic screen verifier.',
});

findings.push({
  id:'R8-BACKTEST-AUTH-ERROR-STALE',
  status: /Add your Groq API key in the main dashboard first/.test(files.backtest)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'Backtest unauthenticated error tells the user to add a browser Groq API key, but current architecture uses a server key plus audit authentication.',
});


findings.push({
  id:'R5-AUDIT-SIGNAL-UNKNOWN-STRING-DEFAULTS',
  status: /asset: args\.signal\.pair \|\| 'Unknown Asset'/.test(files.auditSignalLogSource)
    && /feed: args\.feed \|\| 'Unknown feed'/.test(files.auditSignalLogSource)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: "The signal audit schema substitutes human strings such as 'Unknown Asset'/'Unknown feed' rather than keeping unavailable fields null with a reason code.",
});


findings.push({
  id:'R4-NATIVE-SOURCE-NOT-RETAINED-FOR-ALL-DECISIONS',
  status: /const sourceArtifact = await buildPrivacyMaskedSourceArtifact/.test(files.app)
    && /if \(timeframeRejected && analysisImage\.startsWith\('data:image\/png'\)\)[\s\S]*?buildFullFrameArtifact\('native_source_frame_png'/.test(files.app)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'Exact native full-frame PNG bytes are retained only for timeframe rejects. Other rejects and successful decisions retain a privacy-masked JPEG plus derived crops and the original source hash, so the exact original frame needed to recompute all structural metrics is unavailable.',
});

findings.push({
  id:'R4-DERIVED-CROPS-ARE-REENCODED',
  status: /canvas\.toDataURL\(small \? 'image\/png' : 'image\/jpeg'/.test(files.screenPipelineSource)
    && /canvas\.toDataURL\('image\/jpeg', 0\.92\)/.test(files.auditArtifactsSource)
    ? 'CONFIRMED_REPLAY_LIMITATION'
    : 'UNVERIFIED',
  evidence: 'Audit source/crops are transformed: primary/plot crops use JPEG and the source artifact is privacy-masked JPEG. Their bytes are not identical to source pixels used for the original deterministic computation.',
});


findings.push({
  id:'BACKTEST-ISO-FRACTIONAL-TIMESTAMP-CORRUPTION',
  status: /Date\.parse\(trimmed\.replace\(\/\\\.\/g, '-'\)\)/.test(files.backtestService)
    ? 'CONFIRMED_BUG'
    : 'UNVERIFIED',
  evidence: "parseTimestamp replaces every '.' with '-' before Date.parse; standard ISO strings containing fractional seconds such as 2026-09-20T00:00:00.000Z are corrupted and become unparseable, pushing the dataset toward timeframeStatus='unknown'.",
});


findings.push({
  id:'R1-PERSISTED-HISTORY-DIRECTIONAL',
  status: /\.filter\(\(item\) => item && typeof item === 'object' && typeof item\.id === 'string'\)/.test(files.storageSource)
    && /\{item\.bias\}/.test(files.historyPanelSource)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'loadHistory validates only that id is a string and does not force persisted bias through the audit edge gate. HistoryPanel renders item.bias directly, so a legacy/tampered CALL/PUT record remains user-visible while AUDIT LOCK is on.',
});


findings.push({
  id:'R4-BACKTEST-EXPORT-LACKS-RUN-PROVENANCE',
  status: /JSON\.stringify\(\{ exportedAt: new Date\(\)\.toISOString\(\), summary, rows \}/.test(files.backtestService)
    && !/configVersion|promptVersion|modelName|minConfidence|datasetHash/.test((files.backtestService.match(/export function exportBacktestJson[\s\S]*?\n\}/)||[''])[0])
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'Backtest JSON export contains exportedAt, summary and rows only. It omits config/spec version, model/prompt version, minConfidence, source dataset hash and other run parameters required for exact replay.',
});


findings.push({
  id:'OUTCOME-INVALID-DIRECTION-FALLS-THROUGH-AS-PUT',
  status: /else outcome = expiry < entry \? 'WIN' : 'LOSS'/.test(files.outcomeResolverSource)
    && !/direction !== 'CALL'.*direction !== 'PUT'|\['CALL','PUT'\].*direction/.test(files.outcomeResolverSource)
    ? 'CONFIRMED_FAIL_OPEN_IN_RESOLVER'
    : 'UNVERIFIED',
  evidence: "resolveOutcome branches CALL vs else; an invalid runtime direction such as SIDEWAYS falls into the PUT branch. This is reachable because the server outcome endpoint accepts arbitrary direction payloads.",
});

findings.push({
  id:'MANUAL-ANALYZE-REENTRY-GUARD',
  status: /const canAnalyze = Boolean\([\s\S]*?apiKey\.trim\(\)[\s\S]*?!preflightLoading[\s\S]*?!autoTestEnabled/.test(files.app)
    && !/const canAnalyze = Boolean\([\s\S]*?!analyzing/.test(files.app)
    ? 'CONFIRMED_RACE_RISK'
    : 'UNVERIFIED',
  evidence: 'The Analyze button eligibility does not include !analyzing and there is no manual busy ref, so repeated manual clicks can overlap analysis/audit operations.',
});

findings.push({
  id:'PREFLIGHT-NO-STABLE-REASON-CODE',
  status: /export interface ImagePreflightResult \{[\s\S]*?warnings: string\[\];[\s\S]*?\}/.test(files.imagePreflightSource)
    && !/reasonCode/.test(files.imagePreflightSource)
    ? 'CONFIRMED_R8_GAP'
    : 'UNVERIFIED',
  evidence: 'Preflight exposes status/score/warnings but no stable reasonCode; blocked blank/blurred frames therefore cannot be durably classified with a specific machine-readable failure code.',
});

findings.push({
  id:'OUTCOME-TIMER-STALE-BUSY-CLOSURE',
  status: /setTimeout\(\(\) => \{ void resolvePending\(pending\.tradeId\); \}, delay\)/.test(files.outcomePanelSource)
    && /if \(!trade \|\| trade\.expiry \|\| !liveTabActive \|\| busy\) return;/.test(files.outcomePanelSource)
    ? 'CONFIRMED_RACE_RISK'
    : 'UNVERIFIED',
  evidence: 'The scheduled expiry callback captures the render-time busy value, but busy is not an effect dependency. A manual Capture now operation can race the already-scheduled timer and create duplicate expiry captures/events.',
});


findings.push({
  id:'R1-HISTORY-EXPORT-EXPOSES-DIRECTION',
  status: /'finalBias', 'proposedBias'/.test(files.exportHistorySource)
    && /item\.proposedBias/.test(files.exportHistorySource)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'History CSV export explicitly includes proposedBias and JSON export serializes the full gated signal object. A live final NEUTRAL can therefore still export model-proposed CALL/PUT while AUDIT LOCK is on.',
});

findings.push({
  id:'R4-DECISION-RECORD-MISSING-RUNTIME-GATE-PARAMETERS',
  status: !/minConfidence:/.test(files.repro)
    && !/precisionProfile/.test(files.repro)
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'ReproDecisionRecord does not store minConfidence or the applied precision-profile rule/version, even though both can affect pre-audit gate output. Exact gate replay is therefore under-specified.',
});

findings.push({
  id:'BACKTEST-UNKNOWN-DATA-HARDCODED-AS-M1-IN-IMAGE',
  status: /timeframeStatus === 'not_m1'/.test(files.backtest)
    && /\$\{pair\}  •  M1/.test(files.backtestService)
    && /Historical replay • 1-minute candles/.test(files.backtestService)
    ? 'CONFIRMED_GUESS'
    : 'UNVERIFIED',
  evidence: 'Backtest allows timeframeStatus=unknown, but renderBacktestChart always writes M1 and "1-minute candles" into the image sent to the model. Unknown timeframe is therefore converted into asserted M1 visual evidence.',
});

findings.push({
  id:'BACKTEST-LOCAL-TIMEZONE-RENDERING',
  status: /toLocaleTimeString\(\[\], \{ hour: '2-digit', minute: '2-digit', hour12: false \}\)/.test(files.backtestService)
    ? 'CONFIRMED_REPRODUCIBILITY_GAP'
    : 'UNVERIFIED',
  evidence: 'Backtest chart time labels are rendered with the host browser local timezone/locale, so the same timestamp dataset can generate different model images on different machines. The run export does not record timezone/locale.',
});

findings.push({
  id:'BACKTEST-PAIR-MARKET-PROVENANCE-UNVERIFIED',
  status: /renderBacktestChart\(window, displayPair, decision\.timeLabel\)/.test(files.backtest)
    && /market,\s*decision,\s*expiry/.test(files.backtest)
    ? 'CONFIRMED_WEAK'
    : 'UNVERIFIED',
  evidence: 'The selected pair/FOREX-vs-OTC label is user-provided and rendered/stored, but the CSV parser has no dataset provenance field that verifies the candles actually belong to that pair or market.',
});


findings.push({
  id:'AUTOTEST-AIRUNS-COUNTS-PREMODEL-REJECTS',
  status: /autoLastAiAtRef\.current = Date\.now\(\);[\s\S]*?const resultSignal = await executeAiAnalysis[\s\S]*?aiRuns: current\.aiRuns \+ 1/.test(files.app)
    ? 'CONFIRMED_STATISTICS_BUG'
    : 'UNVERIFIED',
  evidence: 'Auto Test increments aiRuns after executeAiAnalysis returns even when that function returned a deterministic NEUTRAL before any Groq request. The UI counter is therefore not a reliable model-call count.',
});

findings.push({
  id:'AUTOTEST-COOLDOWN-STARTS-BEFORE-MODEL-CALL',
  status: /autoLastAiAtRef\.current = Date\.now\(\);[\s\S]*?await executeAiAnalysis/.test(files.app)
    ? 'CONFIRMED_BEHAVIOR_BUG'
    : 'UNVERIFIED',
  evidence: 'The AI cooldown timestamp is set before deterministic verification inside executeAiAnalysis. A pre-model reject therefore starts the 15s AI cooldown and can cause later changed frames to be skipped even though no AI request occurred.',
});


findings.push({
  id:'REPRO-LOCAL-WRITE-BLOCKS-SERVER-DURABILITY',
  status: /export async function persistReproDecision[\s\S]*?await appendLocalReproRecord\(record\);[\s\S]*?try \{[\s\S]*?apiFetch\('\/api\/audit\/records'/.test(files.repro)
    ? 'CONFIRMED_DURABILITY_GAP'
    : 'UNVERIFIED',
  evidence: 'persistReproDecision awaits IndexedDB insertion before entering the server-write try block. If local IndexedDB fails, the durable server audit write is never attempted.',
});

findings.push({
  id:'REPRO-LOCAL-DURABLE-STATUS-NEVER-FINALIZED',
  status: /await appendLocalReproRecord\(record\)/.test(files.repro)
    && /record: \{ \.\.\.record, durableWrite: 'ok' \}/.test(files.repro)
    && !/durableWrite: 'failed'|objectStore\(STORE\)\.put/.test(files.repro)
    ? 'CONFIRMED_AUDIT_METADATA_BUG'
    : 'UNVERIFIED',
  evidence: "The local IndexedDB copy is inserted with durableWrite='pending' and is never updated to 'ok' after server success or 'failed' after server failure. Local audit metadata therefore cannot state actual durability.",
});


findings.push({
  id:'PRICE-AXIS-OCCLUSION-DROPPED-NOT-REJECTED',
  status: /reason: 'OCCLUDED_BY_CURRENT_PRICE_TAG' \}\);[\s\S]*?continue;/.test(files.stage3c)
    && /const linear = monotonic[\s\S]*?PRICE_AXIS_STEP_CV_MAX;/.test(files.stage3c)
    && !/const linear =[^;]*!band/.test(files.stage3c)
    ? 'CONFIRMED_SPEC_VIOLATION'
    : 'UNVERIFIED',
  evidence: 'verifyPriceAxis detects a blue current-price occlusion band, drops OCR labels inside that band, and can still mark the axis readable from the remaining labels. The requested E4 contract says occlusion must be rejected, not repaired/excluded.',
});

console.log(JSON.stringify({ probeVersion:'phase1-v18', findings }, null, 2));
