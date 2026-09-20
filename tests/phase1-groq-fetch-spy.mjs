const originalFetch = globalThis.fetch;

globalThis.fetch = async function phase1FetchSpy(input, init = {}) {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  if (url === 'https://api.groq.com/openai/v1/chat/completions') {
    let parsed = null;
    try { parsed = JSON.parse(String(init.body || '{}')); } catch {}
    process.stdout.write('PHASE1_GROQ_SPY_CALLED ' + JSON.stringify({
      model: parsed?.model ?? null,
      messageCount: Array.isArray(parsed?.messages) ? parsed.messages.length : null,
      hasImage: JSON.stringify(parsed?.messages || []).includes('image_url'),
      temperature: parsed?.temperature ?? null,
      hasResponseFormat: Boolean(parsed?.response_format),
    }) + '\n');
    return new Response(JSON.stringify({
      id: 'phase1-spy-response',
      choices: [{ message: { content: '{"bias":"NEUTRAL"}' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return originalFetch(input, init);
};
