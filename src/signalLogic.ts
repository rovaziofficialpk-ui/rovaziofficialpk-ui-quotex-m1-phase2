export type TradeBias = 'CALL' | 'PUT' | 'NEUTRAL';
export type ChartQuality = 'clear' | 'usable' | 'poor';
export type ChartTimeframe = 'M1' | 'other' | 'unknown';
export type EvidenceDirection = 'bullish' | 'bearish' | 'neutral' | 'unclear';
export type CandleSignal = 'bullish' | 'bearish' | 'indecision' | 'none';
export type ContextAlignment = 'aligned' | 'mixed' | 'conflicting' | 'not_provided';
export type InputQualityStatus = 'pass' | 'warn' | 'block';

export interface ModelSignalPayload {
  pair: string;
  bias: TradeBias;
  confidence: number;
  pattern: string;
  entry: string;
  chartQuality: ChartQuality;
  timeframe: ChartTimeframe;
  trend: EvidenceDirection;
  momentum: EvidenceDirection;
  structure: EvidenceDirection;
  candleSignal: CandleSignal;
  supportResistance: string;
  evidence: string[];
  contextAlignment: ContextAlignment;
  contextNotes: string;
  warnings: string[];
}

export interface TradeSignal extends ModelSignalPayload {
  proposedBias: TradeBias;
  confirmationScore: number;
  confirmationCount: number;
  opposingConfirmations: number;
  inputQualityScore: number;
  inputQualityStatus: InputQualityStatus;
  contextImagesUsed: number;
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
    trend: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'unclear'] },
    momentum: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'unclear'] },
    structure: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'unclear'] },
    candleSignal: { type: 'string', enum: ['bullish', 'bearish', 'indecision', 'none'] },
    supportResistance: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    contextAlignment: { type: 'string', enum: ['aligned', 'mixed', 'conflicting', 'not_provided'] },
    contextNotes: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'pair', 'bias', 'confidence', 'pattern', 'entry', 'chartQuality', 'timeframe',
    'trend', 'momentum', 'structure', 'candleSignal', 'supportResistance', 'evidence',
    'contextAlignment', 'contextNotes', 'warnings',
  ],
  additionalProperties: false,
};

const isTradeBias = (value: unknown): value is TradeBias =>
  value === 'CALL' || value === 'PUT' || value === 'NEUTRAL';

const EVIDENCE_DIRECTIONS: EvidenceDirection[] = ['bullish', 'bearish', 'neutral', 'unclear'];
const CANDLE_SIGNALS: CandleSignal[] = ['bullish', 'bearish', 'indecision', 'none'];
const CONTEXT_ALIGNMENTS: ContextAlignment[] = ['aligned', 'mixed', 'conflicting', 'not_provided'];

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

  if (
    typeof data.pair !== 'string' ||
    !isTradeBias(data.bias) ||
    !Number.isFinite(confidence) ||
    typeof data.pattern !== 'string' ||
    typeof data.entry !== 'string' ||
    !['clear', 'usable', 'poor'].includes(String(data.chartQuality)) ||
    !['M1', 'other', 'unknown'].includes(String(data.timeframe)) ||
    !EVIDENCE_DIRECTIONS.includes(data.trend as EvidenceDirection) ||
    !EVIDENCE_DIRECTIONS.includes(data.momentum as EvidenceDirection) ||
    !EVIDENCE_DIRECTIONS.includes(data.structure as EvidenceDirection) ||
    !CANDLE_SIGNALS.includes(data.candleSignal as CandleSignal) ||
    typeof data.supportResistance !== 'string' ||
    !Array.isArray(data.evidence) ||
    !data.evidence.every((item) => typeof item === 'string') ||
    !CONTEXT_ALIGNMENTS.includes(data.contextAlignment as ContextAlignment) ||
    typeof data.contextNotes !== 'string' ||
    !Array.isArray(data.warnings) ||
    !data.warnings.every((warning) => typeof warning === 'string')
  ) {
    throw new Error('AI response failed Phase 3 validation. Please re-analyze the chart.');
  }

  return {
    pair: data.pair.trim() || 'Unknown Asset',
    bias: data.bias,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    pattern: data.pattern.trim() || 'No clear pattern',
    entry: data.entry.trim() || 'No trade. Wait for a clearer setup.',
    chartQuality: data.chartQuality as ChartQuality,
    timeframe: data.timeframe as ChartTimeframe,
    trend: data.trend as EvidenceDirection,
    momentum: data.momentum as EvidenceDirection,
    structure: data.structure as EvidenceDirection,
    candleSignal: data.candleSignal as CandleSignal,
    supportResistance: data.supportResistance.trim() || 'No reliable level identified.',
    evidence: (data.evidence as string[]).map((item) => item.trim()).filter(Boolean).slice(0, 6),
    contextAlignment: data.contextAlignment as ContextAlignment,
    contextNotes: data.contextNotes.trim(),
    warnings: (data.warnings as string[]).map((warning) => warning.trim()).filter(Boolean).slice(0, 6),
  };
};

function confirmationStats(payload: ModelSignalPayload): { score: number; aligned: number; opposing: number } {
  if (payload.bias === 'NEUTRAL') return { score: 0, aligned: 0, opposing: 0 };

  const desired = payload.bias === 'CALL' ? 'bullish' : 'bearish';
  const opposite = payload.bias === 'CALL' ? 'bearish' : 'bullish';
  const directional = [payload.trend, payload.momentum, payload.structure];

  let aligned = directional.filter((value) => value === desired).length;
  let opposing = directional.filter((value) => value === opposite).length;

  if (payload.candleSignal === desired) aligned += 1;
  if (payload.candleSignal === opposite) opposing += 1;

  return { score: aligned * 25, aligned, opposing };
}

export const applySignalGate = (
  payload: ModelSignalPayload,
  minConfidence: number,
  rawResponse: string,
  inputQuality: { score: number; status: InputQualityStatus },
  contextImagesUsed: number,
): TradeSignal => {
  const proposedBias = payload.bias;
  const confirmations = confirmationStats(payload);
  let bias: TradeBias = payload.bias;
  let gateReason: string | undefined;

  if (inputQuality.status === 'block') {
    bias = 'NEUTRAL';
    gateReason = 'Blocked: local screenshot preflight found the image too weak to analyze safely.';
  } else if (payload.chartQuality === 'poor') {
    bias = 'NEUTRAL';
    gateReason = 'Blocked: AI chart-quality check marked the screenshot as poor.';
  } else if (payload.timeframe !== 'M1') {
    bias = 'NEUTRAL';
    gateReason = payload.timeframe === 'other'
      ? 'Blocked: the primary uploaded chart does not appear to be M1.'
      : 'Blocked: the primary chart timeframe could not be verified as M1.';
  } else if (payload.bias !== 'NEUTRAL' && payload.confidence < minConfidence) {
    bias = 'NEUTRAL';
    gateReason = `Blocked: AI setup confidence ${payload.confidence}% is below your ${minConfidence}% threshold.`;
  } else if (payload.bias !== 'NEUTRAL' && confirmations.aligned < 3) {
    bias = 'NEUTRAL';
    gateReason = `Blocked: only ${confirmations.aligned}/4 independent evidence checks align with the proposed ${payload.bias} direction.`;
  } else if (payload.bias !== 'NEUTRAL' && confirmations.opposing > 1) {
    bias = 'NEUTRAL';
    gateReason = `Blocked: ${confirmations.opposing}/4 evidence checks actively oppose the proposed ${payload.bias} direction.`;
  } else if (contextImagesUsed > 0 && payload.bias !== 'NEUTRAL' && payload.contextAlignment === 'conflicting') {
    bias = 'NEUTRAL';
    gateReason = 'Blocked: the optional higher-timeframe context conflicts with the proposed M1 direction.';
  }

  return {
    ...payload,
    bias,
    proposedBias,
    confirmationScore: confirmations.score,
    confirmationCount: confirmations.aligned,
    opposingConfirmations: confirmations.opposing,
    inputQualityScore: inputQuality.score,
    inputQualityStatus: inputQuality.status,
    contextImagesUsed,
    gateReason,
    entry: gateReason
      ? 'No directional signal. Wait for a clearer, verified M1 setup with stronger independent confirmation.'
      : payload.entry,
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
