import fs from 'node:fs';

const phase1 = JSON.parse(fs.readFileSync(process.argv[2] || 'phase1-probes.json', 'utf8'));
const integration = JSON.parse(fs.readFileSync(process.argv[3] || 'batch1-server-integration.json', 'utf8'));
const baseline = JSON.parse(fs.readFileSync('audit/phase1-baseline-for-batch1.json','utf8'));

function finding(id) {
  const item = phase1.findings.find((entry) => entry.id === id);
  if (!item) throw new Error('MISSING_PHASE1_FINDING:' + id);
  return item;
}

const hash = finding('AUDIT-HASHCHAIN-CONCURRENCY');
const gate = finding('R2-SERVER-GATE');

const hashAgrees = hash.status === 'PASS'
  && integration.hashChainStrictlyLinear === true
  && integration.hashChainBrokenLinks === 0
  && integration.concurrencyNon201 === 0;

const gateAgrees = gate.status === 'PASS'
  && integration.outboundGroqCalls === 0
  && integration.arbitraryPayloadStatus === 400
  && integration.failingGateStatus === 422;

const baselineHashRuntime = baseline.phase1ServerIntegration;
const baselineHashReconciled = baseline.phase1SourceProbes['AUDIT-HASHCHAIN-CONCURRENCY'] === 'UNVERIFIED'
  && baselineHashRuntime.hashChainStrictlyLinear === false
  && baselineHashRuntime.hashChainBrokenLinks === 119
  && baselineHashRuntime.concurrencyNon201 === 0
  && baseline.reconciliation.hashChainBefore === 'CONFIRMED_FAIL';

const result = {
  reconciled: baselineHashReconciled && hashAgrees && gateAgrees,
  phase1Before: {
    hashChainSourceProbe: baseline.phase1SourceProbes['AUDIT-HASHCHAIN-CONCURRENCY'],
    hashChainRuntimeBrokenLinks: baselineHashRuntime.hashChainBrokenLinks,
    hashChainRuntimeStrictlyLinear: baselineHashRuntime.hashChainStrictlyLinear,
    hashChainReconciledStatus: baseline.reconciliation.hashChainBefore,
    groqBoundarySourceProbe: baseline.phase1SourceProbes['R2-SERVER-GATE'],
    arbitraryAnalyzeStatus: baselineHashRuntime.arbitraryAnalyzeStatus,
    arbitraryAnalyzeReachedOutboundGroqSpy: baselineHashRuntime.arbitraryAnalyzeReachedOutboundGroqSpy,
    malformedJsonStatus: baselineHashRuntime.malformedJsonStatus,
    duplicateAuditRecordIdAccepted: baselineHashRuntime.duplicateAuditRecordIdAccepted,
  },
  phase2Batch1After: {
    hashChain: {
      phase1ProbeRerunStatus: hash.status,
      runtimeStrictlyLinear: integration.hashChainStrictlyLinear,
      runtimeBrokenLinks: integration.hashChainBrokenLinks,
      runtimeNon201: integration.concurrencyNon201,
      agrees: hashAgrees,
    },
    groqBoundary: {
      phase1ProbeRerunStatus: gate.status,
      runtimeOutboundGroqCalls: integration.outboundGroqCalls,
      arbitraryPayloadStatus: integration.arbitraryPayloadStatus,
      failingGateStatus: integration.failingGateStatus,
      agrees: gateAgrees,
    },
    malformedJsonStatus: integration.malformedJsonStatus,
    securityHeadersPresent: integration.securityHeadersPresent,
    tamperDetected: integration.tamperDetected,
  },
};

console.log(JSON.stringify(result, null, 2));
if (!result.reconciled) process.exit(1);
