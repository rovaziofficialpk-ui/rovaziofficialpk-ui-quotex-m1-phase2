const originalFetch = globalThis.fetch;

globalThis.fetch = async function batch1GroqSpy(input, init = {}) {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  if (url === 'https://api.groq.com/openai/v1/chat/completions') {
    let payload = null;
    try { payload = JSON.parse(String(init.body || '{}')); } catch {}
    process.stdout.write('BATCH1_GROQ_SPY_CALLED ' + JSON.stringify({
      model: payload?.model ?? null,
      temperature: payload?.temperature ?? null,
      seed: payload?.seed ?? null,
      responseFormat: payload?.response_format?.type ?? null,
      hasImage: JSON.stringify(payload?.messages || []).includes('image_url'),
    }) + '\n');
    return new Response(JSON.stringify({
      id: 'batch1-spy',
      choices: [{ message: { content: '{"pair":"EUR/USD","bias":"NEUTRAL","confidence":0,"pattern":"","entry":"","chartQuality":"poor","timeframe":"unknown","trend":"unclear","momentum":"unclear","structure":"unclear","candleSignal":"none","supportResistance":"","evidence":[],"contextAlignment":"not_provided","contextNotes":"","warnings":[]}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};
