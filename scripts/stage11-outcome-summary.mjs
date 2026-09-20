import fs from 'node:fs/promises';

const file = process.argv[2] || process.env.OUTCOME_EVENTS_FILE || '/data/audit/outcome-events.ndjson';

let rows;
try {
  const text = await fs.readFile(file, 'utf8');
  rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
} catch (error) {
  console.error('Could not read outcome events: ' + (error instanceof Error ? error.message : String(error)));
  process.exit(2);
}

const map = new Map();
for (const event of rows) {
  if (event.eventType === 'ARMED') {
    map.set(event.tradeId, {
      tradeId:event.tradeId,
      direction:event.payload?.direction ?? null,
      armedAt:event.recordedAt ?? null,
      dueAt:event.payload?.dueAt ?? null,
      entry:event.payload?.entry ?? null,
      expiry:null,
      resolverOutcome:null,
      resolverNullReason:null,
      unitReturn:null,
      platformOutcome:null
    });
    continue;
  }
  const trade=map.get(event.tradeId);
  if(!trade) continue;
  if(event.eventType==='EXPIRED'){
    trade.expiry=event.payload?.expiry ?? null;
    trade.resolverOutcome=event.payload?.resolverOutcome ?? null;
    trade.resolverNullReason=event.payload?.resolverNullReason ?? null;
    trade.unitReturn=Number.isFinite(event.payload?.unitReturn) ? Number(event.payload.unitReturn) : null;
  } else if(event.eventType==='MANUAL_OUTCOME'){
    trade.platformOutcome=event.payload?.platformOutcome ?? null;
  }
}

const trades=[...map.values()].sort((a,b)=>String(a.armedAt).localeCompare(String(b.armedAt)));
const expired=trades.filter((t)=>t.expiry);
const known=expired.filter((t)=>t.resolverOutcome);
const nulls=expired.filter((t)=>!t.resolverOutcome);
const labeled=trades.filter((t)=>t.platformOutcome);
const comparable=labeled.filter((t)=>t.resolverOutcome);
const disagreements=comparable.filter((t)=>t.platformOutcome!==t.resolverOutcome);
const agreements=comparable.length-disagreements.length;
const knownReturns=expired.map((t)=>t.unitReturn).filter((x)=>Number.isFinite(x));
const meanKnown=knownReturns.length?knownReturns.reduce((a,b)=>a+b,0)/knownReturns.length:null;
const fullSampleExpectancy=expired.length>0&&nulls.length===0&&knownReturns.length===expired.length
  ? knownReturns.reduce((a,b)=>a+b,0)/expired.length
  : null;

const byNullReason={};
for(const trade of nulls){
  const reason=trade.resolverNullReason||'UNKNOWN_NULL_REASON';
  byNullReason[reason]=(byNullReason[reason]||0)+1;
}

const report={
  version:'stage11-summary-v1',
  sourceFile:file,
  totalArmed:trades.length,
  expired:expired.length,
  manuallyLabeled:labeled.length,
  requiredManualDemoTrades:30,
  resolverKnown:known.length,
  resolverNull:nulls.length,
  resolverNullRate:expired.length?Number(((nulls.length/expired.length)*100).toFixed(2)):null,
  nullReasons:byNullReason,
  agreementEligible:comparable.length,
  agreements,
  disagreements:disagreements.length,
  agreementRate:comparable.length?Number(((agreements/comparable.length)*100).toFixed(2)):null,
  disagreementDetails:disagreements.map((t)=>({
    tradeId:t.tradeId,
    armedAt:t.armedAt,
    direction:t.direction,
    entryPrice:t.entry?.price?.price ?? null,
    expiryPrice:t.expiry?.price?.price ?? null,
    payout:t.entry?.payoutDecimal ?? null,
    resolverOutcome:t.resolverOutcome,
    platformOutcome:t.platformOutcome,
    entryPriceConfidence:t.entry?.price?.confidence ?? null,
    expiryPriceConfidence:t.expiry?.price?.confidence ?? null,
    frameReasonsAtEntry:t.entry?.frameReasons ?? [],
    frameReasonsAtExpiry:t.expiry?.frameReasons ?? []
  })),
  nullOutcomeDetails:nulls.map((t)=>({
    tradeId:t.tradeId,
    armedAt:t.armedAt,
    direction:t.direction,
    reason:t.resolverNullReason,
    entryPrice:t.entry?.price?.price ?? null,
    expiryPrice:t.expiry?.price?.price ?? null,
    payout:t.entry?.payoutDecimal ?? null
  })),
  knownReturnCount:knownReturns.length,
  meanUnitReturnKnown:meanKnown===null?null:Number(meanKnown.toFixed(6)),
  fullSampleExpectancy:fullSampleExpectancy===null?null:Number(fullSampleExpectancy.toFixed(6)),
  selectionBiasWarning:nulls.length
    ? 'Agreement and known-return estimates exclude unreadable outcomes. If OCR/readability failures correlate with volatility, overlays, latency, or other market states, the resolved subset may be selection-biased.'
    : null,
  validationSampleCountComplete:labeled.length>=30,
  resolverAgreementValidated:false,
  autoUnlock:false
};

console.log(JSON.stringify(report,null,2));
