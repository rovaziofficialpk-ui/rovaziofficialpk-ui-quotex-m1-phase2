import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const port = 43127;
const token = 'phase1-ci-audit-token';
const dir = await mkdtemp(path.join(tmpdir(), 'quotex-phase1-server-'));
const child = spawn(process.execPath, ['--import', './tests/phase1-groq-fetch-spy.mjs', 'server.mjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    AUDIT_DATA_DIR: dir,
    AUDIT_AUTH_TOKEN: token,
    GROQ_API_KEY: 'phase1-fake-server-key',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stdout = [];
const stderr = [];
child.stdout.on('data', (b) => stdout.push(String(b)));
child.stderr.on('data', (b) => stderr.push(String(b)));

const base = `http://127.0.0.1:${port}`;
const headers = { 'X-Audit-Token': token, 'Content-Type': 'application/json' };

async function waitForHealth() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server did not become ready');
}

async function json(pathname, init = {}) {
  const r = await fetch(base + pathname, init);
  const body = await r.json().catch(() => null);
  return { status:r.status, body };
}

let result;
try {
  const health = await waitForHealth();
  const unauth = await json('/api/auth/check');
  const auth = await json('/api/auth/check', { headers:{ 'X-Audit-Token':token } });
  const unauthTime = await json('/api/time');
  const spyCountBeforeUnauthAnalyze = stdout.join('').split('\n').filter((line)=>line.startsWith('PHASE1_GROQ_SPY_CALLED ')).length;
  const unauthAnalyze = await json('/api/groq/analyze', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ model:'should-not-reach-spy', messages:[] }),
  });
  await new Promise((resolve)=>setTimeout(resolve,25));
  const spyCountAfterUnauthAnalyze = stdout.join('').split('\n').filter((line)=>line.startsWith('PHASE1_GROQ_SPY_CALLED ')).length;

  const arbitraryAnalyze = await json('/api/groq/analyze', {
    method:'POST',
    headers,
    body:JSON.stringify({
      model:'attacker-selected-model',
      messages:[{
        role:'user',
        content:[
          { type:'text', text:'arbitrary caller payload' },
          { type:'image_url', image_url:{ url:'data:image/png;base64,AA==' } },
        ],
      }],
      temperature:1,
    }),
  });
  await new Promise((resolve)=>setTimeout(resolve,50));
  const groqSpyLine = stdout.join('').split('\n').find((line)=>line.startsWith('PHASE1_GROQ_SPY_CALLED ')) || null;

  const invalidOutcome = await json('/api/outcomes/events', {
    method:'POST',
    headers,
    body:JSON.stringify({
      eventId:'invalid-payload-event',
      tradeId:'invalid-payload-trade',
      eventType:'ARMED',
      payload:{ direction:'SIDEWAYS', dueAt:null, entry:null, injected:true },
    }),
  });

  const fakeRecord = await json('/api/audit/records', {
    method:'POST',
    headers,
    body:JSON.stringify({
      record:{
        recordId:'fake-replay-record',
        gateSnapshot:{ finalBias:'NEUTRAL', finalReason:'AUDIT_LOCK' },
        deterministicScreen:{ safeForAi:false, reasons:['TIMEFRAME_UNVERIFIED'], impossible:'not-replayed' },
      },
      artifacts:[],
    }),
  });
  const duplicateFakeRecord = await json('/api/audit/records', {
    method:'POST',
    headers,
    body:JSON.stringify({
      record:{
        recordId:'fake-replay-record',
        gateSnapshot:{ finalBias:'NEUTRAL', finalReason:'AUDIT_LOCK_DUPLICATE_ID' },
        deterministicScreen:{ safeForAi:true, reasons:[], forged:true },
      },
      artifacts:[],
    }),
  });
  const replay = await json('/api/audit/replay?limit=2', { headers:{ 'X-Audit-Token':token } });

  const homeResponse = await fetch(base + '/');
  const homeHeaders = {
    contentSecurityPolicy: homeResponse.headers.get('content-security-policy'),
    xFrameOptions: homeResponse.headers.get('x-frame-options'),
    permissionsPolicy: homeResponse.headers.get('permissions-policy'),
    referrerPolicy: homeResponse.headers.get('referrer-policy'),
    xContentTypeOptions: homeResponse.headers.get('x-content-type-options'),
  };

  const malformedJson = await fetch(base + '/api/settings/log', {
    method:'POST',
    headers,
    body:'{',
  });
  const malformedJsonBody = await malformedJson.json().catch(()=>null);

  const concurrencyRequests = [];
  for (let i=0;i<120;i+=1) {
    concurrencyRequests.push(json('/api/outcomes/events', {
      method:'POST',
      headers,
      body:JSON.stringify({
        eventId:`race-event-${i}`,
        tradeId:`race-trade-${i}`,
        eventType:'ARMED',
        payload:{ direction:'CALL', dueAt:'2026-09-20T00:01:00.000Z', entry:{ n:i } },
      }),
    }));
  }
  const concurrencyResponses = await Promise.all(concurrencyRequests);
  const text = await readFile(path.join(dir,'outcome-events.ndjson'),'utf8');
  const rows = text.trim().split('\n').filter(Boolean).map((line)=>JSON.parse(line));
  let brokenLinks = 0;
  for (let i=1;i<rows.length;i+=1) {
    if (rows[i].previousRecordHash !== rows[i-1].recordHash) brokenLinks += 1;
  }

  result = {
    probeVersion:'phase1-server-integration-v3',
    health,
    unauthenticatedAuthStatus:unauth.status,
    authenticatedAuthStatus:auth.status,
    unauthenticatedTimeStatus:unauthTime.status,
    unauthenticatedAnalyzeStatus:unauthAnalyze.status,
    unauthenticatedAnalyzeReachedOutboundGroqSpy:spyCountAfterUnauthAnalyze > spyCountBeforeUnauthAnalyze,
    arbitraryAnalyzeStatus:arbitraryAnalyze.status,
    arbitraryAnalyzeReachedOutboundGroqSpy:arbitraryAnalyze.status === 200 && Boolean(groqSpyLine),
    arbitraryAnalyzeSpyEvidence:groqSpyLine,
    invalidOutcomePayloadAccepted:invalidOutcome.status === 201,
    invalidOutcomeStatus:invalidOutcome.status,
    fakeReplayRecordStored:fakeRecord.status === 201,
    duplicateAuditRecordIdAccepted:duplicateFakeRecord.status === 201,
    duplicateAuditRecordStatus:duplicateFakeRecord.status,
    replayStatus:replay.status,
    replayReportedAllSame:replay.body?.allSame ?? null,
    replayRows:replay.body?.rows ?? null,
    staticSecurityHeaders:homeHeaders,
    malformedJsonStatus:malformedJson.status,
    malformedJsonError:malformedJsonBody?.error ?? null,
    concurrencyWrites:concurrencyResponses.length,
    concurrencyNon201:concurrencyResponses.filter((x)=>x.status!==201).length,
    hashChainBrokenLinks:brokenLinks,
    hashChainStrictlyLinear:brokenLinks === 0,
    serverStdout:stdout.join('').trim().split('\n').slice(-8),
    serverStderr:stderr.join('').trim().split('\n').slice(-8),
  };
  console.log(JSON.stringify(result,null,2));
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve)=>setTimeout(resolve,100));
  await rm(dir,{recursive:true,force:true});
}
