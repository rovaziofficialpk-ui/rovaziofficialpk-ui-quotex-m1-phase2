import { SIGNAL_SCHEMA, applySignalGate, validateModelSignal, type TradeSignal } from '../signalLogic';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = 'qwen/qwen3.8-27b';
const REQUEST_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = `You analyze trading-chart screenshots for educational technical-analysis purposes. Focus on visible evidence only and be conservative.

For an M1 chart:
- CALL only when visible price action supports a bullish setup, such as a bullish reversal at support or bullish continuation with trend/momentum confirmation.
- PUT only when visible price action supports a bearish setup, such as a bearish reversal at resistance or bearish continuation with trend/momentum confirmation.
- NEUTRAL when evidence is weak, conflicting, mid-range, blurry, cropped, or lacks usable context.
- Treat doji/spinning-top/indecision structures cautiously.
- Detect whether the screenshot visibly appears to be M1. If another timeframe is visible, set timeframe to "other". If you cannot verify it, set timeframe to "unknown".
- Set chartQuality to "poor" when candles, labels, or recent price action are too blurry/cropped to analyze reliably.
- confidence is AI setup-confidence from 0-100 based only on visible chart evidence; it is NOT a measured probability of trade success.
- For weak or unclear setups, choose NEUTRAL rather than inventing certainty.
- Identify the asset/pair only if visible; otherwise use "Unknown Asset".
- warnings should briefly state important limitations visible in the screenshot.

Return only the fields required by the supplied JSON schema.`;

export class GroqRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GroqRequestError';
    this.status = status;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data?.error?.message || `Groq API error (${response.status})`;
  } catch {
    return `Groq API error (${response.status})`;
  }
}

export function humanizeGroqError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'The AI request timed out. Check your connection and try again.';
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const status = error instanceof GroqRequestError ? error.status : undefined;

  if (status === 401 || /401|invalid api key|authentication/i.test(err.message)) {
    return 'Invalid Groq API key. Update the key and try again.';
  }
  if (status === 429 || /429|rate limit|limit reached/i.test(err.message)) {
    return 'Groq rate limit reached. Try again after the limit resets.';
  }
  if (status && status >= 500) {
    return 'Groq is temporarily unavailable. Try again shortly.';
  }
  if (/failed to fetch|networkerror|network request/i.test(err.message)) {
    return 'Network request failed. Check your internet connection and browser network permissions.';
  }

  return err.message || 'Unable to analyze the chart.';
}

export async function analyzeChartWithGroq(args: {
  apiKey: string;
  image: string;
  minConfidence: number;
}): Promise<{ signal: TradeSignal; responseTimeMs: number }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${args.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this screenshot. Use only visible chart evidence and return the structured result.',
              },
              { type: 'image_url', image_url: { url: args.image } },
            ],
          },
        ],
        reasoning_effort: 'none',
        temperature: 0.2,
        max_tokens: 500,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'm1_chart_signal',
            strict: true,
            schema: SIGNAL_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new GroqRequestError(await readErrorMessage(response), response.status);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new GroqRequestError('AI returned an empty response. Please re-analyze the chart.');
    }

    const modelSignal = validateModelSignal(content);
    const signal = applySignalGate(modelSignal, args.minConfidence, content);
    return { signal, responseTimeMs: Math.round(performance.now() - startedAt) };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function testGroqConnection(apiKey: string): Promise<void> {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: 'Say "OK" only.' }],
      max_tokens: 5,
      reasoning_effort: 'none',
    }),
  });

  if (!response.ok) {
    throw new GroqRequestError(await readErrorMessage(response), response.status);
  }
}
