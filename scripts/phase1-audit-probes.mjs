import fs from 'node:fs';

const files = {
  server: fs.readFileSync('server.mjs','utf8'),
  app: fs.readFileSync('src/App.tsx','utf8'),
  backtest: fs.readFileSync('src/components/BacktestPanel.tsx','utf8'),
  signal: fs.readFileSync('src/signalLogic.ts','utf8'),
  readme: fs.readFileSync('README.md','utf8'),
  pkg: JSON.parse(fs.readFileSync('package.json','utf8')),
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

findings.push({
  id:'B-LOCKFILE',
  status: fs.existsSync('package-lock.json') ? 'PRESENT' : 'MISSING',
  evidence: 'A dependency lockfile is required for strong from-scratch reproducibility.',
});

console.log(JSON.stringify({ probeVersion:'phase1-v1', findings }, null, 2));
