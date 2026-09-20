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
  status: groqRoute && /proxyGroq\(payload\)/.test(groqRoute[1]) && !/deterministic|timeframe|layout|chartType|priceAxis|asset/.test(groqRoute[1]) ? 'CONFIRMED_FAIL' : 'UNVERIFIED',
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
  status: groqRoute && !/GROQ_MODEL|vision-signal-v4\.0\.0|json_schema|SIGNAL_SCHEMA/.test(groqRoute[1])
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'The authenticated server route forwards the caller-supplied payload unchanged; model, prompt, schema, temperature and image count are not server-frozen.',
});

findings.push({
  id:'AI-SERVER-UPSTREAM-TIMEOUT',
  status: /await fetch\(GROQ_URL, \{/.test(files.server) && !/AbortController|signal:/.test((files.server.match(/async function proxyGroq\([\s\S]*?\n\}/)||[''])[0])
    ? 'CONFIRMED_FAIL'
    : 'UNVERIFIED',
  evidence: 'proxyGroq uses fetch without a server-side AbortController/timeout.',
});

const bodyCap = files.server.match(/const MAX_BODY_BYTES = ([^;]+);/);
findings.push({
  id:'AI-REQUEST-SIZE-POLICY',
  status: /32 \* 1024 \* 1024/.test(bodyCap?.[1] || '') ? 'CONFIRMED_MISMATCH' : 'UNVERIFIED',
  evidence: bodyCap?.[0] || 'MAX_BODY_BYTES not found',
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
  status: /const previousRecordHash = await lastHash\(file\);[\s\S]*?await fs\.appendFile\(file/.test(files.server)
    && !/Mutex|lock|queue|exclusive/.test(files.server)
    ? 'CONFIRMED_RACE_RISK'
    : 'UNVERIFIED',
  evidence: 'appendHashedRecord performs read-last-hash then append without serialization; concurrent writes can share the same previousRecordHash.',
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

console.log(JSON.stringify({ probeVersion:'phase1-v2', findings }, null, 2));
