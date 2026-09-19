import { SIGNAL_SCHEMA, applySignalGate, validateModelSignal, type TradeSignal } from '../signalLogic';
import type { ImagePreflightResult } from './imagePreflight';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = 'qwen/qwen3.8-27b';
const REQUEST_TIMEOUT_MS = 45_000;

export type ContextLabel = 'M5' | 'H1';
export interface ContextImage {
  label: ContextLabel;
  image: string;
}

const SYSTEM_PROMPT = `You analyze trading-chart screenshots for educational technical-analysis purposes. Focus on visible evidence only and be conservative.

The FIRST image is always the primary M1 chart. Additional images, when supplied, are optional higher-timeframe context and are explicitly labeled M5 or H1 in the user message.

For the primary M1 chart:
- CALL only when visible price action supports a bullish setup.
- PUT only when visible price action supports a bearish setup.
- NEUTRAL when evidence is weak, conflicting, mid-range, blurry, cropped, or lacks usable context.
- Detect whether the primary screenshot visibly appears to be M1. If another timeframe is visible, set timeframe to "other". If you cannot verify it, set timeframe to "unknown".
- Set chartQuality to "poor" when candles, labels, or recent price action are too blurry/cropped to analyze reliably.
- confidence is AI setup-confidence from 0-100 based only on visible chart evidence. It is NOT a measured probability of trade success.

Independent evidence fields:
- trend: directional trend visible on the primary chart.
- momentum: short-term momentum visible on the primary chart.
- structure: swing/high-low or range structure visible on the primary chart.
- candleSignal: latest relevant candle/candlestick evidence.
Do NOT force these fields to agree with the proposed bias. Report each independently from visible evidence.

Other fields:
- supportResistance: briefly state the most relevant visible support/resistance or say no reliable level is visible.
- evidence: short concrete observations from the screenshot; do not invent indicators or levels that are not visible.
- contextAlignment: if no context screenshots were supplied use "not_provided". Otherwise compare M5/H1 context with the M1 proposal and choose aligned, mixed, or conflicting.
- contextNotes: briefly explain the higher-timeframe relationship, or say no context was provided.
- warnings: important limitations visible in the screenshots.

For weak or unclear setups choose NEUTRAL rather than inventing certainty. Identify the asset/pair only if visible; otherwise use "Unknown Asset".
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
  preflight: ImagePreflightResult;
  contextImages?: ContextImage[];
}): Promise<{ signal: TradeSignal; responseTimeMs: number }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  const contextImages = (args.contextImages || []).slice(0, 2);

  const userContent: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: `Analyze the primary M1 screenshot below. Local preflight score: ${args.preflight.score}/100 (${args.preflight.status}). Use the score only as image-quality context; do your own visual assessment.`,
    },
    { type: 'image_url', image_url: { url: args.image } },
  ];

  for (const contextImage of contextImages) {
    userContent.push({ type: 'text', text: `Optional ${contextImage.label} context screenshot:` });
    userContent.push({ type: 'image_url', image_url: { url: contextImage.image } });
  }

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
          { role: 'user', content: userContent },
        ],
        reasoning_effort: 'none',
        temperature: 0.15,
        max_tokens: 850,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'm1_chart_signal_phase3',
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
    const signal = applySignalGate(
      modelSignal,
      args.minConfidence,
      content,
      { score: args.preflight.score, status: args.preflight.status },
      contextImages.length,
    );
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
