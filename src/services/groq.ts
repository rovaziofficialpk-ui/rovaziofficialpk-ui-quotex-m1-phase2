import { applySignalGate, validateModelSignal, type TradeSignal } from '../signalLogic';
import type { ImagePreflightResult } from './imagePreflight';
import { apiFetch } from './apiClient';

export const GROQ_MODEL = 'qwen/qwen3.8-27b';
export const GROQ_PROMPT_VERSION = 'vision-signal-v5.0.0-server-fixed';
export const GROQ_TEMPERATURE = 0;
export const GROQ_SEED = 424242;
const REQUEST_TIMEOUT_MS = 45_000;

export type ContextLabel = 'M5' | 'H1';
export interface ContextImage {
  label: ContextLabel;
  image: string;
}

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
    if (typeof data?.error === 'string') {
      return data.reasonCode ? `${data.error}: ${data.reasonCode}` : data.error;
    }
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

export interface GroqAnalysisResult {
  signal: TradeSignal;
  responseTimeMs: number;
  aiCallMs: number;
  gatesMs: number;
  rawApiResponseText: string;
  systemFingerprint: string | null;
}

export async function analyzeChartWithGroq(args: {
  apiKey: string;
  image: string;
  minConfidence: number;
  preflight: ImagePreflightResult;
  contextImages?: ContextImage[];
  configuredAsset: string;
  capturedAt?: string | null;
}): Promise<GroqAnalysisResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await apiFetch('/api/groq/analyze', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageDataUrl: args.image,
        configuredAsset: args.configuredAsset,
        capturedAt: args.capturedAt ?? null,
      }),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const data = await response.clone().json();
        detail = typeof data?.reasonCode === 'string'
          ? `${data.error || 'Server analysis rejected'}: ${data.reasonCode}`
          : typeof data?.error === 'string'
            ? data.error
            : '';
      } catch {
        // Fall through to the normal Groq error reader.
      }
      throw new GroqRequestError(detail || await readErrorMessage(response), response.status);
    }

    const rawApiResponseText = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawApiResponseText);
    } catch {
      throw new GroqRequestError('Groq returned invalid JSON.');
    }
    const aiCallFinishedAt = performance.now();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new GroqRequestError('AI returned an empty response. Please re-analyze the chart.');
    }

    const gatesStartedAt = performance.now();
    const modelSignal = validateModelSignal(content);
    const signal = applySignalGate(
      modelSignal,
      args.minConfidence,
      content,
      { score: args.preflight.score, status: args.preflight.status },
      0,
    );
    const gatesFinishedAt = performance.now();
    return {
      signal,
      responseTimeMs: Math.round(gatesFinishedAt - startedAt),
      aiCallMs: Math.round(aiCallFinishedAt - startedAt),
      gatesMs: Math.round(gatesFinishedAt - gatesStartedAt),
      rawApiResponseText,
      systemFingerprint: typeof data?.system_fingerprint === 'string' ? data.system_fingerprint : null,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function testGroqConnection(_apiKey: string): Promise<void> {
  const response = await apiFetch('/api/groq/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new GroqRequestError(await readErrorMessage(response), response.status);
  }
}
