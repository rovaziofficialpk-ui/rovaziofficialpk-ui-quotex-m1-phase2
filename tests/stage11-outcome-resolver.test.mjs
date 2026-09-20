import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function resolve(direction, entry, expiry, payout){
  if(entry==null||expiry==null||payout==null) return {outcome:null,unitReturn:null};
  let outcome;
  if(expiry===entry) outcome='TIE';
  else if(direction==='CALL') outcome=expiry>entry?'WIN':'LOSS';
  else outcome=expiry<entry?'WIN':'LOSS';
  return {outcome,unitReturn:outcome==='WIN'?payout:outcome==='LOSS'?-1:0};
}

test('documented CALL settlement uses strict higher price',()=>{
  assert.deepEqual(resolve('CALL',1.1000,1.1001,.9),{outcome:'WIN',unitReturn:.9});
  assert.deepEqual(resolve('CALL',1.1000,1.0999,.9),{outcome:'LOSS',unitReturn:-1});
});

test('documented PUT settlement uses strict lower price',()=>{
  assert.deepEqual(resolve('PUT',1.1000,1.0999,.9),{outcome:'WIN',unitReturn:.9});
  assert.deepEqual(resolve('PUT',1.1000,1.1001,.9),{outcome:'LOSS',unitReturn:-1});
});

test('exact displayed equality is TIE and returns zero unit profit/loss',()=>{
  assert.deepEqual(resolve('CALL',1.1000,1.1000,.9),{outcome:'TIE',unitReturn:0});
  assert.deepEqual(resolve('PUT',1.1000,1.1000,.9),{outcome:'TIE',unitReturn:0});
});

test('missing price or payout stays null rather than guessed',()=>{
  assert.equal(resolve('CALL',null,1.1,.9).outcome,null);
  assert.equal(resolve('CALL',1.1,null,.9).outcome,null);
  assert.equal(resolve('CALL',1.1,1.2,null).outcome,null);
});

test('breakeven formula is 1/(1+payout)',()=>{
  const payout=.93;
  assert.ok(Math.abs((1/(1+payout))-0.518134715)<1e-9);
});

test('backtester is explicitly marked research proxy',()=>{
  const source=fs.readFileSync(new URL('../src/services/backtest.ts',import.meta.url),'utf8');
  assert.match(source,/NEXT_CANDLE_CLOSE_RESEARCH_PROXY/);
});

test('resolver does not contain automated platform trade placement',()=>{
  const source=fs.readFileSync(new URL('../src/services/outcomeResolver.ts',import.meta.url),'utf8');
  assert.equal(/click\(|dispatchEvent\(|Higher button|Lower button|placeTrade|executeTrade/.test(source),false);
});

test('audit lock remains neutral-only',()=>{
  const source=fs.readFileSync(new URL('../src/services/edgeGate.ts',import.meta.url),'utf8');
  assert.match(source,/bias: 'NEUTRAL'/);
});
