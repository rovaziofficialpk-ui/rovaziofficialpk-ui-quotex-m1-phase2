export type TradeBias = 'CALL' | 'PUT' | 'NEUTRAL';
export type ChartQuality = 'clear' | 'usable' | 'poor';
export type ChartTimeframe = 'M1' | 'other' | 'unknown';

export interface ModelSignalPayload {
  pair: string;
  bias: TradeBias;
  confidence: number;
  pattern: string;
  entry: string;
  chartQuality: ChartQuality;
  timeframe: ChartTimeframe;
  warnings: string[];
}

export interface TradeSignal extends ModelSignalPayload {
  proposedBias: TradeBias;
  gateReason?: string;
  rawResponse?: string;
}

export interface SignalHistoryItem extends TradeSignal {
  id: string;
  createdAt: string;
  responseTimeMs: number;
  minConfidence: number;
}

export const SIGNAL_SCHEMA = {
  type: 'object',
  properties: {
    pair: { type: 'string' },
    bias: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    pattern: { type: 'string' },
    entry: { type: 'string' },
    chartQuality: { type: 'string', enum: ['clear', 'usable', 'poor'] },
    timeframe: { type: 'string', enum: ['M1', 'other', 'unknown'] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['pair', 'bias', 'confidence', 'pattern', 'entry', 'chartQuality', 'timeframe', 'warnings'],
  additionalProperties: false,
};

const isTradeBias = (value: unknown): value is TradeBias =>
  value === 'CALL' || value === 'PUT' || value === 'NEUTRAL';

export const validateModelSignal = (content: string): ModelSignalPayload => {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('AI returned invalid structured data. Please re-analyze the chart.');
  }

  if (!value || typeof value !== 'object') {
    throw new Error('AI response was empty or malformed. Please re-analyze the chart.');
  }

  const data = value as Record<string, unknown>;
  const confidence = Number(data.confidence);
  const chartQuality = data.chartQuality;
  const timeframe = data.timeframe;

  if (
    typeof data.pair !== 'string' ||
    !isTradeBias(data.bias) ||
    !Number.isFinite(confidence) ||
    typeof data.pattern !== 'string' ||
    typeof data.entry !== 'string' ||
    !['clear', 'usable', 'poor'].includes(String(chartQuality)) ||
    !['M1', 'other', 'unknown'].includes(String(timeframe)) ||
    !Array.isArray(data.warnings) ||
    !data.warnings.every((warning) => typeof warning === 'string')
  ) {
    throw new Error('AI response failed validation. Please re-analyze the chart.');
  }

  return {
    pair: data.pair.trim() || 'Unknown Asset',
    bias: data.bias,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    pattern: data.pattern.trim() || 'No clear pattern',
    entry: data.entry.trim() || 'No trade. Wait for a clearer setup.',
    chartQuality: chartQuality as ChartQuality,
    timeframe: timeframe as ChartTimeframe,
    warnings: (data.warnings as string[]).map((warning) => warning.trim()).filter(Boolean).slice(0, 5),
  };
};

export const applySignalGate = (payload: ModelSignalPayload, minConfidence: number, rawResponse: string): TradeSignal => {
  const proposedBias = payload.bias;
  let bias: TradeBias = payload.bias;
  let gateReason: string | undefined;

  if (payload.chartQuality === 'poor') {
    bias = 'NEUTRAL';
    gateReason = 'Blocked: chart quality is too poor for a reliable signal.';
  } else if (payload.timeframe !== 'M1') {
    bias = 'NEUTRAL';
    gateReason = payload.timeframe === 'other'
      ? 'Blocked: the uploaded chart does not appear to be M1.'
      : 'Blocked: the chart timeframe could not be verified as M1.';
  } else if (payload.bias !== 'NEUTRAL' && payload.confidence < minConfidence) {
    bias = 'NEUTRAL';
    gateReason = `Blocked: AI setup confidence ${payload.confidence}% is below your ${minConfidence}% threshold.`;
  }

  return {
    ...payload,
    bias,
    proposedBias,
    gateReason,
    entry: gateReason ? 'No trade. Wait for a clearer, verified M1 setup that passes the selected confidence gate.' : payload.entry,
    rawResponse,
  };
};

export const createHistoryItem = (
  signal: TradeSignal,
  responseTimeMs: number,
  minConfidence: number,
): SignalHistoryItem => ({
  ...signal,
  id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  createdAt: new Date().toISOString(),
  responseTimeMs,
  minConfidence,
});
