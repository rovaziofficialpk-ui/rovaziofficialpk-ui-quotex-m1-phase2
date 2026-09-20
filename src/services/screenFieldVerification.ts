import { apiFetch } from './apiClient';
import type { CropResult, DeterministicScreenMetrics, ParsedScreenField, ScreenReasonCode } from './screenPipeline';

export const SCREEN_FIELD_VERIFIER_VERSION = 'screen-fields-v1.1.0';
export const TIMEFRAME_TEMPLATE_VERSION = 'quotex-1m-template-v1';
export const TIMEFRAME_MATCHER_VERSION = 'quotex-1m-matcher-v2';
export const TIMEFRAME_TEMPLATE_THRESHOLD = 0.985;
export const TIMEFRAME_TEMPLATE_CANONICAL_WIDTH = 27;
export const TIMEFRAME_TEMPLATE_CANONICAL_HEIGHT = 29;
export const TIMEFRAME_TEMPLATE_FIXED_SCALES = [0.75, 0.9, 1.0, 1.1, 1.25, 1.5] as const;
export const TIMEFRAME_MIN_TICK_INTERVALS = 3;
export const MINUTES_PER_CANDLE_TOLERANCE = 0.08;
export const OCR_MIN_CONFIDENCE = 70;
export const LAYOUT_VALIDATION_COVERAGE_COMPLETE = false;

interface OcrToken {
  text: string;
  confidence: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface OcrResult {
  rawText: string;
  tokens: OcrToken[];
  engine: string;
  psm: number;
}

export interface TimeAxisVerification {
  readable: boolean;
  rawText: string | null;
  labels: Array<{ text: string; secondsOfDay: number; x: number; confidence: number }>;
  intervalCount: number;
  medianTickSeconds: number | null;
  spanSeconds: number | null;
  candlePitchPx: number | null;
  minutesPerCandle: number | null;
  verifiedM1: boolean;
  mismatch: boolean;
  reasonCode: string | null;
}

export interface PriceAxisVerification {
  readable: boolean;
  rawText: string | null;
  values: number[];
  min: number | null;
  max: number | null;
  reasonCode: string | null;
}

export interface AssetVerification extends ParsedScreenField {
  normalized: string | null;
  configured: string | null;
  matchesConfigured: boolean;
}

export type TimeframeSubReasonCode =
  | 'BADGE_NO_MATCH'
  | 'BADGE_TEMPLATE_UNAVAILABLE'
  | 'AXIS_INSUFFICIENT_INTERVALS'
  | 'AXIS_CANDLE_PITCH_UNAVAILABLE'
  | 'AXIS_PITCH_MISMATCH'
  | 'BADGE_AXIS_DISAGREE';

export interface TimeframeSubReason {
  code: TimeframeSubReasonCode;
  message: string;
  observed: number | string | null;
  expected: number | string | null;
}

export interface TimeframeBadgeMatch {
  score: number | null;
  threshold: number;
  passed: boolean;
  bestScale: number | null;
  bestX: number | null;
  bestY: number | null;
  candidateWidth: number;
  candidateHeight: number;
  canonicalWidth: number;
  canonicalHeight: number;
  templateVersion: string;
  matcherVersion: string;
  fixedScales: number[];
}

export interface TimeframeDiagnostics {
  badge: TimeframeBadgeMatch;
  axis: {
    usableIntervals: number;
    requiredIntervals: number;
    candlePitchPx: number | null;
    minutesPerCandle: number | null;
    expectedMinutesPerCandle: number;
    toleranceMinutes: number;
    verifiedM1: boolean;
  };
  subReasons: TimeframeSubReason[];
  failedCropRoles: Array<'timeframeBadge' | 'timeAxis'>;
}

export interface FieldVerification {
  timeframe: ParsedScreenField;
  timeframeBadgeScore: number | null;
  timeframeDiagnostics: TimeframeDiagnostics;
  timeAxis: TimeAxisVerification;
  priceAxis: PriceAxisVerification;
  asset: AssetVerification;
  reasons: ScreenReasonCode[];
  frameVerified: boolean;
  productionEligible: boolean;
  productionBlockReason: string | null;
}

function cropByRole(crops: CropResult[], role: CropResult['role']): CropResult | null {
  return crops.find((crop) => crop.role === role) || null;
}

async function ocrCrop(crop: CropResult, mode: 'asset' | 'time_axis' | 'price_axis'): Promise<OcrResult> {
  const response = await apiFetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: crop.dataUrl, mode }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || `OCR failed for ${mode}`);
  return {
    rawText: String(data.rawText || ''),
    tokens: Array.isArray(data.tokens) ? data.tokens : [],
    engine: String(data.engine || 'unknown'),
    psm: Number(data.psm || 0),
  };
}

function normalizeAsset(value: string): string | null {
  const upper = value.toUpperCase().replace(/\s+/g, ' ').trim();
  const match = upper.match(/([A-Z]{3})\s*\/\s*([A-Z]{3})(?:\s*\(\s*OTC\s*\))?/);
  if (!match) return null;
  const otc = /\(\s*OTC\s*\)/.test(upper);
  return `${match[1]}/${match[2]}${otc ? ' (OTC)' : ''}`;
}

function parseTimeText(text: string): number | null {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return (hour * 3600) + (minute * 60) + second;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeTimeLabels(tokens: OcrToken[], crop: CropResult): TimeAxisVerification['labels'] {
  return tokens
    .filter((token) => token.confidence >= OCR_MIN_CONFIDENCE)
    .map((token) => {
      const secondsOfDay = parseTimeText(token.text);
      if (secondsOfDay === null) return null;
      const sourceX = crop.rect.x + ((token.left + token.width / 2) / Math.max(1, crop.upscale));
      return { text: token.text, secondsOfDay, x: sourceX, confidence: token.confidence };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((a, b) => a.x - b.x);
}

function adjacentTimeDiffSeconds(a: number, b: number): number {
  let diff = b - a;
  if (diff <= 0) diff += 24 * 3600;
  return diff;
}

export function deriveMinutesPerCandle(
  labels: TimeAxisVerification['labels'],
  candlePitchPx: number | null,
): { intervalCount: number; medianTickSeconds: number | null; minutesPerCandle: number | null } {
  if (!candlePitchPx || candlePitchPx <= 0 || labels.length < TIMEFRAME_MIN_TICK_INTERVALS + 1) {
    return { intervalCount: 0, medianTickSeconds: null, minutesPerCandle: null };
  }
  const tickSeconds: number[] = [];
  const estimates: number[] = [];
  for (let index = 1; index < labels.length; index += 1) {
    const dx = labels[index].x - labels[index - 1].x;
    const dt = adjacentTimeDiffSeconds(labels[index - 1].secondsOfDay, labels[index].secondsOfDay);
    if (dx <= 0 || dt <= 0 || dt > 6 * 3600) continue;
    const candleSteps = dx / candlePitchPx;
    if (candleSteps < 0.5) continue;
    tickSeconds.push(dt);
    estimates.push((dt / 60) / candleSteps);
  }
  return {
    intervalCount: estimates.length,
    medianTickSeconds: median(tickSeconds),
    minutesPerCandle: median(estimates),
  };
}

async function grayImage(
  dataUrl: string,
  width: number,
  height: number,
  smoothing: boolean,
): Promise<Float32Array> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const target = new Image();
    target.onload = () => resolve(target);
    target.onerror = () => reject(new Error('Could not load timeframe image.'));
    target.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Template matching canvas unavailable.');
  context.imageSmoothingEnabled = smoothing;
  context.imageSmoothingQuality = smoothing ? 'high' : 'low';
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const values = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    values[p] = (data[i] * 0.2126) + (data[i + 1] * 0.7152) + (data[i + 2] * 0.0722);
  }
  return values;
}

function normalizedCorrelationAt(
  candidate: Float32Array,
  candidateWidth: number,
  startX: number,
  startY: number,
  template: Float32Array,
  templateWidth: number,
  templateHeight: number,
): number {
  const n = templateWidth * templateHeight;
  if (n <= 1) return -1;
  let meanA = 0;
  let meanB = 0;
  for (let y = 0; y < templateHeight; y += 1) {
    for (let x = 0; x < templateWidth; x += 1) {
      meanA += candidate[((startY + y) * candidateWidth) + startX + x];
      meanB += template[(y * templateWidth) + x];
    }
  }
  meanA /= n;
  meanB /= n;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let y = 0; y < templateHeight; y += 1) {
    for (let x = 0; x < templateWidth; x += 1) {
      const a = candidate[((startY + y) * candidateWidth) + startX + x] - meanA;
      const b = template[(y * templateWidth) + x] - meanB;
      numerator += a * b;
      denomA += a * a;
      denomB += b * b;
    }
  }
  const denominator = Math.sqrt(denomA * denomB);
  return denominator > 0 ? numerator / denominator : -1;
}

async function timeframeBadgeMatch(crop: CropResult | null): Promise<TimeframeBadgeMatch> {
  const base: TimeframeBadgeMatch = {
    score: null,
    threshold: TIMEFRAME_TEMPLATE_THRESHOLD,
    passed: false,
    bestScale: null,
    bestX: null,
    bestY: null,
    candidateWidth: crop?.rect.width ?? 0,
    candidateHeight: crop?.rect.height ?? 0,
    canonicalWidth: TIMEFRAME_TEMPLATE_CANONICAL_WIDTH,
    canonicalHeight: TIMEFRAME_TEMPLATE_CANONICAL_HEIGHT,
    templateVersion: TIMEFRAME_TEMPLATE_VERSION,
    matcherVersion: TIMEFRAME_MATCHER_VERSION,
    fixedScales: [...TIMEFRAME_TEMPLATE_FIXED_SCALES],
  };
  if (!crop) return base;

  try {
    const templateResponse = await fetch('/templates/quotex-1m-v1.png', { cache: 'force-cache' });
    if (!templateResponse.ok) return base;
    const blob = await templateResponse.blob();
    const templateUrl = URL.createObjectURL(blob);
    try {
      // crop.dataUrl is a 3x nearest-neighbor audit crop. Reduce it back to the
      // source-pixel rectangle before matching so capture resolution does not
      // silently change the detector's geometry.
      const candidateWidth = Math.max(1, crop.rect.width);
      const candidateHeight = Math.max(1, crop.rect.height);
      const candidate = await grayImage(crop.dataUrl, candidateWidth, candidateHeight, false);

      let bestScore = -1;
      let bestScale: number | null = null;
      let bestX: number | null = null;
      let bestY: number | null = null;

      for (const scale of TIMEFRAME_TEMPLATE_FIXED_SCALES) {
        const width = Math.max(1, Math.round(TIMEFRAME_TEMPLATE_CANONICAL_WIDTH * scale));
        const height = Math.max(1, Math.round(TIMEFRAME_TEMPLATE_CANONICAL_HEIGHT * scale));
        if (width > candidateWidth || height > candidateHeight) continue;
        const template = await grayImage(templateUrl, width, height, scale !== 1);
        for (let y = 0; y <= candidateHeight - height; y += 1) {
          for (let x = 0; x <= candidateWidth - width; x += 1) {
            const score = normalizedCorrelationAt(candidate, candidateWidth, x, y, template, width, height);
            if (score > bestScore) {
              bestScore = score;
              bestScale = scale;
              bestX = x;
              bestY = y;
            }
          }
        }
      }

      const score = bestScale === null ? null : Number(bestScore.toFixed(4));
      return {
        ...base,
        score,
        passed: score !== null && score >= TIMEFRAME_TEMPLATE_THRESHOLD,
        bestScale,
        bestX,
        bestY,
        candidateWidth,
        candidateHeight,
      };
    } finally {
      URL.revokeObjectURL(templateUrl);
    }
  } catch {
    return base;
  }
}

export function parsePriceAxis(tokens: OcrToken[], rawText: string): PriceAxisVerification {
  const values = tokens
    .filter((token) => token.confidence >= OCR_MIN_CONFIDENCE && /^\d+\.\d{3,6}$/.test(token.text))
    .map((token) => Number(token.text))
    .filter(Number.isFinite);
  const unique = Array.from(new Set(values));
  if (unique.length < 4) {
    return { readable: false, rawText: rawText || null, values: unique, min: null, max: null, reasonCode: 'INSUFFICIENT_PRICE_LABELS' };
  }
  return {
    readable: true,
    rawText: rawText || null,
    values: unique,
    min: Math.min(...unique),
    max: Math.max(...unique),
    reasonCode: null,
  };
}

export async function verifyStructuredScreenFields(args: {
  crops: CropResult[];
  metrics: DeterministicScreenMetrics;
  configuredAsset: string | null;
}): Promise<FieldVerification> {
  const timeframeCrop = cropByRole(args.crops, 'timeframeBadge');
  const timeAxisCrop = cropByRole(args.crops, 'timeAxis');
  const priceAxisCrop = cropByRole(args.crops, 'priceAxis');
  const assetCrop = cropByRole(args.crops, 'assetLabel');

  const reasons: ScreenReasonCode[] = [];
  const badgeMatch = await timeframeBadgeMatch(timeframeCrop);
  const badgeScore = badgeMatch.score;
  const badgeSaysM1 = badgeMatch.passed;

  let timeAxis: TimeAxisVerification = {
    readable: false,
    rawText: null,
    labels: [],
    intervalCount: 0,
    medianTickSeconds: null,
    spanSeconds: null,
    candlePitchPx: args.metrics.candlePitchPx,
    minutesPerCandle: null,
    verifiedM1: false,
    mismatch: false,
    reasonCode: 'TIME_AXIS_OCR_FAILED',
  };
  if (timeAxisCrop) {
    try {
      const ocr = await ocrCrop(timeAxisCrop, 'time_axis');
      const labels = normalizeTimeLabels(ocr.tokens, timeAxisCrop);
      const derived = deriveMinutesPerCandle(labels, args.metrics.candlePitchPx);
      const enough = derived.intervalCount >= TIMEFRAME_MIN_TICK_INTERVALS;
      const minutes = derived.minutesPerCandle;
      const verifiedM1 = enough && minutes !== null && Math.abs(minutes - 1) <= MINUTES_PER_CANDLE_TOLERANCE;
      const mismatch = enough && minutes !== null && Math.abs(minutes - 1) > MINUTES_PER_CANDLE_TOLERANCE;
      timeAxis = {
        readable: labels.length >= TIMEFRAME_MIN_TICK_INTERVALS + 1,
        rawText: ocr.rawText || null,
        labels,
        intervalCount: derived.intervalCount,
        medianTickSeconds: derived.medianTickSeconds,
        spanSeconds: labels.length >= 2
          ? adjacentTimeDiffSeconds(labels[0].secondsOfDay, labels[labels.length - 1].secondsOfDay)
          : null,
        candlePitchPx: args.metrics.candlePitchPx,
        minutesPerCandle: minutes === null ? null : Number(minutes.toFixed(3)),
        verifiedM1,
        mismatch,
        reasonCode: verifiedM1 ? null : mismatch ? 'TIMEFRAME_MISMATCH' : 'TIME_AXIS_UNREADABLE',
      };
    } catch {
      // Fail closed.
    }
  }

  const timeframeVerified = badgeSaysM1 && timeAxis.verifiedM1;
  const timeframeMismatch = timeAxis.mismatch;
  const timeframeSubReasons: TimeframeSubReason[] = [];
  if (badgeMatch.score === null) {
    timeframeSubReasons.push({
      code: 'BADGE_TEMPLATE_UNAVAILABLE',
      message: '1m badge template could not be evaluated.',
      observed: null,
      expected: `score >= ${TIMEFRAME_TEMPLATE_THRESHOLD}`,
    });
  } else if (!badgeSaysM1) {
    timeframeSubReasons.push({
      code: 'BADGE_NO_MATCH',
      message: `1m badge score ${badgeMatch.score.toFixed(4)} < frozen threshold ${TIMEFRAME_TEMPLATE_THRESHOLD.toFixed(4)}.`,
      observed: badgeMatch.score,
      expected: TIMEFRAME_TEMPLATE_THRESHOLD,
    });
  }

  if (!args.metrics.candlePitchPx || args.metrics.candlePitchPx <= 0) {
    timeframeSubReasons.push({
      code: 'AXIS_CANDLE_PITCH_UNAVAILABLE',
      message: 'Candle pitch could not be measured from the plot area.',
      observed: args.metrics.candlePitchPx,
      expected: 'positive candle pitch',
    });
  } else if (timeAxis.intervalCount < TIMEFRAME_MIN_TICK_INTERVALS) {
    timeframeSubReasons.push({
      code: 'AXIS_INSUFFICIENT_INTERVALS',
      message: `Time axis produced ${timeAxis.intervalCount} usable intervals; at least ${TIMEFRAME_MIN_TICK_INTERVALS} are required.`,
      observed: timeAxis.intervalCount,
      expected: TIMEFRAME_MIN_TICK_INTERVALS,
    });
  } else if (!timeAxis.verifiedM1) {
    timeframeSubReasons.push({
      code: 'AXIS_PITCH_MISMATCH',
      message: `Derived minutes/candle ${timeAxis.minutesPerCandle ?? 'null'} is outside 1 ± ${MINUTES_PER_CANDLE_TOLERANCE}.`,
      observed: timeAxis.minutesPerCandle,
      expected: `1 ± ${MINUTES_PER_CANDLE_TOLERANCE}`,
    });
  }

  if (badgeSaysM1 !== timeAxis.verifiedM1) {
    timeframeSubReasons.push({
      code: 'BADGE_AXIS_DISAGREE',
      message: `Badge check=${badgeSaysM1 ? 'PASS' : 'FAIL'} while axis/candle-pitch check=${timeAxis.verifiedM1 ? 'PASS' : 'FAIL'}.`,
      observed: `badge=${badgeSaysM1};axis=${timeAxis.verifiedM1}`,
      expected: 'badge=true AND axis=true',
    });
  }

  const timeframeDiagnostics: TimeframeDiagnostics = {
    badge: badgeMatch,
    axis: {
      usableIntervals: timeAxis.intervalCount,
      requiredIntervals: TIMEFRAME_MIN_TICK_INTERVALS,
      candlePitchPx: timeAxis.candlePitchPx,
      minutesPerCandle: timeAxis.minutesPerCandle,
      expectedMinutesPerCandle: 1,
      toleranceMinutes: MINUTES_PER_CANDLE_TOLERANCE,
      verifiedM1: timeAxis.verifiedM1,
    },
    subReasons: timeframeSubReasons,
    failedCropRoles: [
      ...(!badgeSaysM1 ? ['timeframeBadge' as const] : []),
      ...(!timeAxis.verifiedM1 ? ['timeAxis' as const] : []),
    ],
  };

  const timeframe: ParsedScreenField = {
    rawText: timeAxis.rawText,
    parsedValue: timeframeVerified ? 'M1' : null,
    confidence: timeframeVerified ? 'high' : 'unverified',
    reasonCode: timeframeVerified ? null : timeframeMismatch ? 'TIMEFRAME_MISMATCH' : 'TIMEFRAME_UNVERIFIED',
  };
  if (!timeframeVerified) reasons.push(timeframeMismatch ? 'TIMEFRAME_MISMATCH' : 'TIMEFRAME_UNVERIFIED');

  let asset: AssetVerification = {
    rawText: null,
    parsedValue: null,
    confidence: 'unverified',
    reasonCode: 'ASSET_UNVERIFIED',
    normalized: null,
    configured: args.configuredAsset,
    matchesConfigured: false,
  };
  if (assetCrop) {
    try {
      const ocr = await ocrCrop(assetCrop, 'asset');
      const normalized = normalizeAsset(ocr.rawText);
      const configured = args.configuredAsset ? normalizeAsset(args.configuredAsset) : null;
      const matchesConfigured = Boolean(normalized && configured && normalized === configured);
      asset = {
        rawText: ocr.rawText || null,
        parsedValue: normalized,
        confidence: normalized ? 'high' : 'unverified',
        reasonCode: !normalized || !configured ? 'ASSET_UNVERIFIED' : matchesConfigured ? null : 'ASSET_MISMATCH',
        normalized,
        configured,
        matchesConfigured,
      };
    } catch {
      // Fail closed.
    }
  }
  if (!asset.matchesConfigured) reasons.push(asset.reasonCode === 'ASSET_MISMATCH' ? 'ASSET_MISMATCH' : 'ASSET_UNVERIFIED');

  let priceAxis: PriceAxisVerification = { readable: false, rawText: null, values: [], min: null, max: null, reasonCode: 'PRICE_AXIS_UNREADABLE' };
  if (priceAxisCrop) {
    try {
      const ocr = await ocrCrop(priceAxisCrop, 'price_axis');
      priceAxis = parsePriceAxis(ocr.tokens, ocr.rawText);
    } catch {
      // Fail closed.
    }
  }
  if (!priceAxis.readable) reasons.push('PRICE_AXIS_UNREADABLE');
  if (!timeAxis.readable) reasons.push('TIME_AXIS_UNREADABLE');

  const frameVerified = reasons.length === 0;
  return {
    timeframe,
    timeframeBadgeScore: badgeScore,
    timeframeDiagnostics,
    timeAxis,
    priceAxis,
    asset,
    reasons: Array.from(new Set(reasons)),
    frameVerified,
    productionEligible: frameVerified && LAYOUT_VALIDATION_COVERAGE_COMPLETE,
    productionBlockReason: frameVerified && !LAYOUT_VALIDATION_COVERAGE_COMPLETE
      ? 'LAYOUT_VALIDATION_INCOMPLETE'
      : frameVerified
        ? null
        : reasons[0] || 'TIMEFRAME_UNVERIFIED',
  };
}
