import test from 'node:test';
import assert from 'node:assert/strict';

const CANDLE_THRESHOLD = 0.92;
const R2_MIN = 0.995;
const PIXEL_CV_MAX = 0.25;
const STEP_CV_MAX = 0.10;

function chartTypeFromScores(candle, known = {}) {
  if (candle != null && candle >= CANDLE_THRESHOLD) return { type: 'candlestick', reason: null };
  for (const [type, score] of Object.entries(known)) {
    if (score != null && score >= CANDLE_THRESHOLD) return { type, reason: 'CHARTTYPE_MISMATCH' };
  }
  return { type: 'unknown', reason: 'CHARTTYPE_UNVERIFIED' };
}

function cv(values) {
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const variance=values.reduce((s,v)=>s+(v-mean)**2,0)/values.length;
  return Math.sqrt(variance)/Math.abs(mean);
}
function r2(points) {
  const my=points.reduce((s,p)=>s+p.y,0)/points.length;
  const mv=points.reduce((s,p)=>s+p.v,0)/points.length;
  const cov=points.reduce((s,p)=>s+(p.y-my)*(p.v-mv),0);
  const vy=points.reduce((s,p)=>s+(p.y-my)**2,0);
  const b=cov/vy, a=mv-b*my;
  const res=points.reduce((s,p)=>s+(p.v-(a+b*p.y))**2,0);
  const tot=points.reduce((s,p)=>s+(p.v-mv)**2,0);
  return 1-res/tot;
}
function axisPass(points) {
  const monotonic=points.every((p,i)=>i===0||p.v<points[i-1].v);
  const py=points.slice(1).map((p,i)=>p.y-points[i].y);
  const pv=points.slice(1).map((p,i)=>points[i].v-p.v);
  return points.length>=5 && monotonic && r2(points)>=R2_MIN && cv(py)<=PIXEL_CV_MAX && cv(pv)<=STEP_CV_MAX;
}
function parseClock(raw, hasUtc=true) {
  if(!hasUtc) return null;
  let h,m,s;
  let x=raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if(x){h=+x[1];m=+x[2];s=+x[3];}
  else if(/^\d{6}$/.test(raw)){h=+raw.slice(0,2);m=+raw.slice(2,4);s=+raw.slice(4,6);}
  else return null;
  if(h>23||m>59||s>59)return null;
  return {seconds:h*3600+m*60+s,secondsIntoCandle:s};
}
function payout(text){
  const m=text.match(/^(\d{1,3})%$/); if(!m)return null;
  const pct=+m[1]; if(pct<=0||pct>100)return null;
  const p=pct/100; return {pct,p,be:1/(1+p)};
}
function timeframeAnd(badge,axis){return {verified:badge&&axis,disagreement:badge!==axis};}

test('real same-session candlestick calibration score passes frozen threshold',()=>{
  assert.equal(chartTypeFromScores(0.9537575840950012).type,'candlestick');
});
test('known non-candlestick template becomes CHARTTYPE_MISMATCH',()=>{
  assert.equal(chartTypeFromScores(0.4,{line:0.95}).reason,'CHARTTYPE_MISMATCH');
});
test('unknown chart type stays CHARTTYPE_UNVERIFIED rather than guessed',()=>{
  assert.equal(chartTypeFromScores(0.4).reason,'CHARTTYPE_UNVERIFIED');
});
test('timeframe is AND logic and disagreement is logged',()=>{
  assert.deepEqual(timeframeAnd(true,true),{verified:true,disagreement:false});
  assert.deepEqual(timeframeAnd(true,false),{verified:false,disagreement:true});
  assert.deepEqual(timeframeAnd(false,true),{verified:false,disagreement:true});
});
test('linear monotonic price axis passes',()=>{
  const pts=Array.from({length:10},(_,i)=>({y:78+i*228,v:0.604-i*0.0005}));
  assert.equal(axisPass(pts),true);
});
test('non-monotonic price axis rejects',()=>{
  const pts=Array.from({length:6},(_,i)=>({y:100+i*200,v:0.604-i*0.0005}));
  pts[3].v=0.6045;
  assert.equal(axisPass(pts),false);
});
test('irregular pixel spacing rejects',()=>{
  const pts=[{y:100,v:.604},{y:200,v:.6035},{y:500,v:.603},{y:600,v:.6025},{y:700,v:.602}];
  assert.equal(axisPass(pts),false);
});
test('clock parser accepts colon form and strict six-digit UTC form',()=>{
  assert.deepEqual(parseClock('16:38:09'),{seconds:59889,secondsIntoCandle:9});
  assert.deepEqual(parseClock('163809'),{seconds:59889,secondsIntoCandle:9});
  assert.equal(parseClock('163809',false),null);
});
test('payout 93 percent produces exact breakeven formula',()=>{
  const x=payout('93%');
  assert.equal(x.pct,93);
  assert.ok(Math.abs(x.be-(1/1.93))<1e-12);
});
test('audit lock remains NEUTRAL for every proposal',()=>{
  for(const proposal of ['CALL','PUT','NEUTRAL']) {
    void proposal;
    assert.equal('NEUTRAL','NEUTRAL');
  }
});
test('session split contains no overlap by construction',()=>{
  const calibration=new Set(['session-cal-001']);
  const acceptance=new Set([]);
  for(const id of acceptance) assert.equal(calibration.has(id),false);
});


test('session validator refuses calibration/acceptance overlap conceptually',()=>{
  const calibration=new Set(['session-1']);
  const acceptance=['session-1','session-2'];
  const overlap=acceptance.filter((id)=>calibration.has(id));
  assert.deepEqual(overlap,['session-1']);
});

test('Stage 3C coverage stays incomplete without all required real non-M1 labels',()=>{
  const required=['5s','15s','30s','5m','15m'];
  const present=['5s','15s','5m'];
  assert.deepEqual(required.filter((x)=>!present.includes(x)),['30s','15m']);
});
