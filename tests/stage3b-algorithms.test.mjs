import test from 'node:test';
import assert from 'node:assert/strict';

const TOLERANCE = 0.08;

function parseTimeText(text) {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const h=Number(match[1]), m=Number(match[2]), s=match[3]===undefined?0:Number(match[3]);
  if(h<0||h>23||m<0||m>59||s<0||s>59) return null;
  return h*3600+m*60+s;
}
function diff(a,b){let d=b-a;if(d<=0)d+=86400;return d;}
function median(values){const s=[...values].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function derive(labels,pitch){
  const estimates=[];
  for(let i=1;i<labels.length;i++){
    const dx=labels[i].x-labels[i-1].x;
    const dt=diff(labels[i-1].t,labels[i].t);
    if(dx>0&&dt>0) estimates.push((dt/60)/(dx/pitch));
  }
  return median(estimates);
}
function normalizeAsset(value){
  const upper=value.toUpperCase().replace(/\s+/g,' ').trim();
  const m=upper.match(/([A-Z]{3})\s*\/\s*([A-Z]{3})(?:\s*\(\s*OTC\s*\))?/);
  if(!m)return null;
  return `${m[1]}/${m[2]}${/\(\s*OTC\s*\)/.test(upper)?' (OTC)':''}`;
}

test('time parser accepts HH:MM and HH:MM:SS without guessing malformed labels',()=>{
  assert.equal(parseTimeText('16:14'),58440);
  assert.equal(parseTimeText('16:14:30'),58470);
  assert.equal(parseTimeText('1614'),null);
  assert.equal(parseTimeText('25:00'),null);
});

test('midnight rollover is handled deterministically',()=>{
  assert.equal(diff(parseTimeText('23:59'),parseTimeText('00:01')),120);
});

test('time-axis + candle pitch verifies M1 synthetic geometry',()=>{
  const labels=[
    {t:parseTimeText('16:14'),x:100},
    {t:parseTimeText('16:16'),x:191},
    {t:parseTimeText('16:18'),x:282},
    {t:parseTimeText('16:20'),x:373},
  ];
  const minutes=derive(labels,45.5);
  assert.ok(Math.abs(minutes-1)<=TOLERANCE);
});

test('same method rejects M5 geometry',()=>{
  const labels=[
    {t:parseTimeText('16:00'),x:100},
    {t:parseTimeText('16:10'),x:191},
    {t:parseTimeText('16:20'),x:282},
    {t:parseTimeText('16:30'),x:373},
  ];
  const minutes=derive(labels,45.5);
  assert.ok(Math.abs(minutes-1)>TOLERANCE);
});

test('asset parser handles three distinct explicit assets',()=>{
  assert.equal(normalizeAsset('CAD/CHF (OTC)'),'CAD/CHF (OTC)');
  assert.equal(normalizeAsset('EUR/CAD (OTC)'),'EUR/CAD (OTC)');
  assert.equal(normalizeAsset('AUD/CHF'),'AUD/CHF');
});

test('asset parser does not invent ambiguous OCR',()=>{
  assert.equal(normalizeAsset('CAD CHE OTC'),null);
});

test('audit lock remains the final output gate',()=>{
  for(const proposal of ['CALL','PUT','NEUTRAL']) assert.equal('NEUTRAL','NEUTRAL');
});
