import { appendFileSync } from 'node:fs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async function batch1GroqSpy(input, init = {}) {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  if (url === 'https://api.groq.com/openai/v1/chat/completions') {
    const log = process.env.GROQ_SPY_LOG;
    if (log) {
      let body = null;
      try { body = JSON.parse(String(init.body || '{}')); } catch {}
      appendFileSync(log, JSON.stringify({
        model: body?.model ?? null,
        temperature: body?.temperature ?? null,
        seed: body?.seed ?? null,
        responseFormat: body?.response_format ?? null,
        hasImage: JSON.stringify(body?.messages || []).includes('image_url'),
      }) + '\n');
    }
    return new Response(JSON.stringify({
      id:'batch1-spy',
      choices:[{ message:{ content: JSON.stringify({
        pair:'EUR/USD', bias:'NEUTRAL', confidence:0, pattern:'none', entry:'none',
        chartQuality:'poor', timeframe:'unknown', trend:'unclear', momentum:'unclear',
        structure:'unclear', candleSignal:'none', supportResistance:'none', evidence:[],
        contextAlignment:'not_provided', contextNotes:'', warnings:['spy']
      }) } }],
    }), { status:200, headers:{'content-type':'application/json'} });
  }
  return originalFetch(input, init);
};
