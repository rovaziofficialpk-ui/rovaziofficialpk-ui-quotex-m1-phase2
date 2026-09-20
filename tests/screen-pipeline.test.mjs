import test from 'node:test';
import assert from 'node:assert/strict';

function gate(args) {
  const m=args.metrics; const reasons=[];
  const layoutFound=m.width>=700&&m.height>=300&&m.aspectRatio>=2.15&&m.aspectRatio<=2.26&&m.plotCombinedCandleColorRatio>=.015&&m.rightPanelGreenRatio>=.015&&m.rightPanelRedRatio>=.015;
  if(!layoutFound) reasons.push('LAYOUT_NOT_FOUND');
  if(m.outerNearBlackRatio>.35) reasons.push('LETTERBOX_DETECTED');
  if(m.candleCount<12||m.candleCount>80) reasons.push('CANDLE_COUNT_OUT_OF_RANGE');
  if(m.lastCandleXFraction==null||m.lastCandleXFraction<.45||m.lastCandleXFraction>.80) reasons.push('NEWEST_CANDLE_NOT_VISIBLE');
  if(m.currentPriceBlueRatio<.005||m.horizontalMarkerRowRatio<.15) reasons.push('CURRENT_PRICE_MARKER_MISSING');
  if(!args.priceAxisReadable) reasons.push('PRICE_AXIS_UNREADABLE');
  if(!args.timeAxisReadable) reasons.push('TIME_AXIS_UNREADABLE');
  if(!args.parsedTimeframe) reasons.push('TIMEFRAME_UNVERIFIED');
  else if(args.parsedTimeframe!==args.configuredTimeframe) reasons.push('TIMEFRAME_MISMATCH');
  if(!args.configuredAsset||!args.parsedAsset) reasons.push('ASSET_UNVERIFIED');
  else if(args.parsedAsset!==args.configuredAsset) reasons.push('ASSET_MISMATCH');
  return {safeForAi:reasons.length===0,reasonCode:reasons[0]||null,reasons};
}
const goodMetrics={width:1472,height:668,aspectRatio:2.2036,plotCombinedCandleColorRatio:.055,rightPanelGreenRatio:.049,rightPanelRedRatio:.047,currentPriceBlueRatio:.011,horizontalMarkerRowRatio:.26,outerNearBlackRatio:.015,candleCount:17,lastCandleXFraction:.69};
const good={metrics:goodMetrics,configuredTimeframe:'M1',parsedTimeframe:'M1',configuredAsset:'CAD/CHF (OTC)',parsedAsset:'CAD/CHF (OTC)',priceAxisReadable:true,timeAxisReadable:true};

test('complete metrics pass only with verified labels and axes',()=>assert.equal(gate(good).safeForAi,true));
test('missing newest/right-side evidence rejects',()=>{const x=structuredClone(good);x.metrics.lastCandleXFraction=.20;assert.ok(gate(x).reasons.includes('NEWEST_CANDLE_NOT_VISIBLE'));});
test('wrong timeframe rejects',()=>{const x=structuredClone(good);x.parsedTimeframe='M5';assert.ok(gate(x).reasons.includes('TIMEFRAME_MISMATCH'));});
test('unreadable timeframe rejects',()=>{const x=structuredClone(good);x.parsedTimeframe=null;assert.ok(gate(x).reasons.includes('TIMEFRAME_UNVERIFIED'));});
test('wrong asset rejects',()=>{const x=structuredClone(good);x.parsedAsset='EUR/CAD (OTC)';assert.ok(gate(x).reasons.includes('ASSET_MISMATCH'));});
test('unconfigured asset rejects',()=>{const x=structuredClone(good);x.configuredAsset=null;assert.ok(gate(x).reasons.includes('ASSET_UNVERIFIED'));});
test('cut-off price axis rejects',()=>{const x=structuredClone(good);x.priceAxisReadable=false;assert.ok(gate(x).reasons.includes('PRICE_AXIS_UNREADABLE'));});
test('cut-off time axis rejects',()=>{const x=structuredClone(good);x.timeAxisReadable=false;assert.ok(gate(x).reasons.includes('TIME_AXIS_UNREADABLE'));});
test('letterbox rejects',()=>{const x=structuredClone(good);x.metrics.outerNearBlackRatio=.60;assert.ok(gate(x).reasons.includes('LETTERBOX_DETECTED'));});
test('unrecognized layout rejects first',()=>{const x=structuredClone(good);x.metrics.aspectRatio=1.5;assert.equal(gate(x).reasonCode,'LAYOUT_NOT_FOUND');});
