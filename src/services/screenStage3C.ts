import { apiFetch } from './apiClient';
import {
  TIMEFRAME_TEMPLATE_THRESHOLD,
  verifyStructuredScreenFields,
  type FieldVerification,
} from './screenFieldVerification';
import type {
  CropResult,
  DeterministicScreenMetrics,
  ParsedScreenField,
  ScreenReasonCode,
} from './screenPipeline';

export const STAGE3C_VERIFIER_VERSION = 'stage3c-v1.1.0';
export const CHARTTYPE_CANDLE_TEMPLATE_VERSION = 'quotex-candlestick-v1';
export const CHARTTYPE_CANDLE_THRESHOLD = 0.92;
export const PRICE_AXIS_MIN_LABELS = 5;
export const PRICE_AXIS_R2_MIN = 0.995;
export const PRICE_AXIS_PIXEL_SPACING_CV_MAX = 0.25;
export const PRICE_AXIS_STEP_CV_MAX = 0.10;
export const CLOCK_STALE_TOLERANCE_SECONDS = 5;
export const OCR_MIN_CONFIDENCE = 70;
export const STAGE3C_VALIDATION_COVERAGE_COMPLETE = false;

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

export interface ChartTypeVerification {
  detected: 'candlestick' | 'line' | 'bars' | 'heikin_ashi' | 'unknown';
  candlestickScore: number | null;
  mismatchTemplate: string | null;
  mismatchScore: number | null;
  verified: boolean;
  mismatch: boolean;
  reasonCode: 'CHARTTYPE_UNVERIFIED' | 'CHARTTYPE_MISMATCH' | null;
}

export interface PriceAxisFit {
  readable: boolean;
  rawText: string | null;
  values: number[];
  labels: Array<{ text: string; value: number; y: number; confidence: number }>;
  rejected: Array<{ text: string; confidence: number; reason: string }>;
  min: number | null;
  max: number | null;
  monotonic: boolean;
  r2: number | null;
  pixelSpacingCv: number | null;
  priceStepCv: number | null;
  occlusionBand: { top: number; bottom: number } | null;
  reasonCode: 'PRICE_AXIS_UNREADABLE' | 'PRICE_AXIS_NONLINEAR' | null;
}

export interface PlatformClockVerification {
  rawText: string | null;
  parsedText: string | null;
  utcSecondsOfDay: number | null;
  confidence: number | null;
  serverUtc: string | null;
  serverDeltaSeconds: number | null;
  secondsIntoCandle: number | null;
  stale: boolean;
  frozen: boolean;
  reasonCode: 'CLOCK_UNREADABLE' | 'CLOCK_STALE' | 'CLOCK_FROZEN' | null;
}

export interface PayoutVerification {
  rawText: string | null;
  payoutPercent: number | null;
  payoutDecimal: number | null;
  breakevenWinRate: number | null;
  confidence: number | null;
  reasonCode: 'PAYOUT_UNREADABLE' | null;
}

export interface FieldLegibility {
  asset: ConfidenceSummary;
  payout: ConfidenceSummary;
  timeAxis: ConfidenceSummary;
  priceAxis: ConfidenceSummary;
  platformClock: ConfidenceSummary;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ConfidenceSummary {
  count: number;
  mean: number | null;
  min: number | null;
}

export interface Stage3CVerification extends FieldVerification {
  chartType: ChartTypeVerification;
  platformClock: PlatformClockVerification;
  payout: PayoutVerification;
  priceAxis: PriceAxisFit;
  legibility: FieldLegibility;
  timeframeDisagreement: boolean;
  reasons: ScreenReasonCode[];
  frameVerified: boolean;
  productionEligible: boolean;
  productionBlockReason: string | null;
}

function cropByRole(crops: CropResult[], role: CropResult['role']): CropResult | null {
  return crops.find((crop) => crop.role === role) || null;
}

async function ocrCrop(crop: CropResult, mode: 'asset_payout' | 'clock' | 'price_axis'): Promise<OcrResult> {
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

function confidenceSummary(values: number[]): ConfidenceSummary {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!valid.length) return { count: 0, mean: null, min: null };
  return {
    count: valid.length,
    mean: Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2)),
    min: Number(Math.min(...valid).toFixed(2)),
  };
}

function normalizeAsset(value: string): string | null {
  const upper = value.toUpperCase().replace(/\s+/g, ' ').trim();
  const match = upper.match(/([A-Z]{3})\s*\/\s*([A-Z]{3})(?:\s*\(\s*OTC\s*\))?/);
  if (!match) return null;
  const otc = /\(\s*OTC\s*\)/.test(upper);
  return `${match[1]}/${match[2]}${otc ? ' (OTC)' : ''}`;
}

function parsePayout(ocr: OcrResult): PayoutVerification {
  const candidates = ocr.tokens
    .filter((token) => token.confidence >= OCR_MIN_CONFIDENCE)
    .map((token) => {
      const match = token.text.trim().match(/^(\d{1,3})%$/);
      if (!match) return null;
      const percent = Number(match[1]);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
      return { percent, confidence: token.confidence };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (candidates.length !== 1) {
    return {
      rawText: ocr.rawText || null,
      payoutPercent: null,
      payoutDecimal: null,
      breakevenWinRate: null,
      confidence: null,
      reasonCode: 'PAYOUT_UNREADABLE',
    };
  }
  const payoutDecimal = candidates[0].percent / 100;
  return {
    rawText: ocr.rawText || null,
    payoutPercent: candidates[0].percent,
    payoutDecimal,
    breakevenWinRate: Number((1 / (1 + payoutDecimal)).toFixed(6)),
    confidence: Number(candidates[0].confidence.toFixed(2)),
    reasonCode: null,
  };
}

function parseClockCandidate(ocr: OcrResult): { text: string; seconds: number; confidence: number } | null {
  const utcToken = ocr.tokens.find((token) => /^UTC$/i.test(token.text.trim()) && token.confidence >= OCR_MIN_CONFIDENCE);
  if (!utcToken) return null;

  const candidates = ocr.tokens
    .filter((token) => token.confidence >= OCR_MIN_CONFIDENCE)
    .map((token) => {
      const raw = token.text.trim();
      let hour: number;
      let minute: number;
      let second: number;
      const colon = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
      if (colon) {
        hour = Number(colon[1]);
        minute = Number(colon[2]);
        second = Number(colon[3]);
      } else if (/^\d{6}$/.test(raw)) {
        hour = Number(raw.slice(0, 2));
        minute = Number(raw.slice(2, 4));
        second = Number(raw.slice(4, 6));
      } else {
        return null;
      }
      if (hour > 23 || minute > 59 || second > 59) return null;
      return {
        text: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')} UTC`,
        seconds: (hour * 3600) + (minute * 60) + second,
        confidence: Math.min(token.confidence, utcToken.confidence),
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  return candidates.length === 1 ? candidates[0] : null;
}

function circularSecondsDifference(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, (24 * 3600) - raw);
}

async function serverUtcNow(): Promise<{ unixMs: number; iso: string }> {
  const started = performance.now();
  const response = await apiFetch('/api/time', { method: 'GET', cache: 'no-store' });
  const data = await response.json().catch(() => null);
  const rtt = Math.max(0, performance.now() - started);
  if (!response.ok || !data?.ok || !Number.isFinite(Number(data.serverUnixMs))) {
    throw new Error(data?.error || 'SERVER_TIME_UNAVAILABLE');
  }
  const unixMs = Number(data.serverUnixMs) + (rtt / 2);
  return { unixMs, iso: new Date(unixMs).toISOString() };
}

async function verifyPlatformClock(
  crop: CropResult | null,
  previousClock: { secondsOfDay: number; observedClientMs: number } | null,
): Promise<PlatformClockVerification> {
  if (!crop) {
    return {
      rawText: null,
      parsedText: null,
      utcSecondsOfDay: null,
      confidence: null,
      serverUtc: null,
      serverDeltaSeconds: null,
      secondsIntoCandle: null,
      stale: false,
      frozen: false,
      reasonCode: 'CLOCK_UNREADABLE',
    };
  }
  try {
    const ocr = await ocrCrop(crop, 'clock');
    const parsed = parseClockCandidate(ocr);
    if (!parsed) {
      return {
        rawText: ocr.rawText || null,
        parsedText: null,
        utcSecondsOfDay: null,
        confidence: null,
        serverUtc: null,
        serverDeltaSeconds: null,
        secondsIntoCandle: null,
        stale: false,
        frozen: false,
        reasonCode: 'CLOCK_UNREADABLE',
      };
    }

    const server = await serverUtcNow();
    const serverDate = new Date(server.unixMs);
    const serverSeconds = (serverDate.getUTCHours() * 3600) + (serverDate.getUTCMinutes() * 60) + serverDate.getUTCSeconds();
    const delta = circularSecondsDifference(parsed.seconds, serverSeconds);
    const stale = delta > CLOCK_STALE_TOLERANCE_SECONDS;
    const now = Date.now();
    const frozen = Boolean(
      previousClock
      && previousClock.secondsOfDay === parsed.seconds
      && now - previousClock.observedClientMs > 1500,
    );

    return {
      rawText: ocr.rawText || null,
      parsedText: parsed.text,
      utcSecondsOfDay: parsed.seconds,
      confidence: Number(parsed.confidence.toFixed(2)),
      serverUtc: server.iso,
      serverDeltaSeconds: Number(delta.toFixed(2)),
      secondsIntoCandle: parsed.seconds % 60,
      stale,
      frozen,
      reasonCode: frozen ? 'CLOCK_FROZEN' : stale ? 'CLOCK_STALE' : null,
    };
  } catch {
    return {
      rawText: null,
      parsedText: null,
      utcSecondsOfDay: null,
      confidence: null,
      serverUtc: null,
      serverDeltaSeconds: null,
      secondsIntoCandle: null,
      stale: false,
      frozen: false,
      reasonCode: 'CLOCK_UNREADABLE',
    };
  }
}

async function loadGray(dataUrl: string, width: number, height: number): Promise<Float32Array> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const target = new Image();
    target.onload = () => resolve(target);
    target.onerror = () => reject(new Error('Could not load chart-type image.'));
    target.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Chart-type canvas unavailable.');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    gray[p] = (pixels[i] * 0.2126) + (pixels[i + 1] * 0.7152) + (pixels[i + 2] * 0.0722);
  }
  return gray;
}

function normalizedCorrelation(
  candidate: Float32Array,
  candidateWidth: number,
  x0: number,
  y0: number,
  template: Float32Array,
  templateWidth: number,
  templateHeight: number,
): number {
  const n = templateWidth * templateHeight;
  let meanA = 0;
  let meanB = 0;
  for (let y = 0; y < templateHeight; y += 1) {
    for (let x = 0; x < templateWidth; x += 1) {
      meanA += candidate[((y0 + y) * candidateWidth) + x0 + x];
      meanB += template[(y * templateWidth) + x];
    }
  }
  meanA /= n;
  meanB /= n;
  let numerator = 0;
  let normA = 0;
  let normB = 0;
  for (let y = 0; y < templateHeight; y += 1) {
    for (let x = 0; x < templateWidth; x += 1) {
      const a = candidate[((y0 + y) * candidateWidth) + x0 + x] - meanA;
      const b = template[(y * templateWidth) + x] - meanB;
      numerator += a * b;
      normA += a * a;
      normB += b * b;
    }
  }
  if (normA <= 0 || normB <= 0) return -1;
  return numerator / Math.sqrt(normA * normB);
}

async function bestTemplateScore(candidateUrl: string, templateUrl: string): Promise<number | null> {
  try {
    const response = await fetch(templateUrl, { cache: 'force-cache' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const localUrl = URL.createObjectURL(blob);
    try {
      const candidateWidth = 72;
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const target = new Image();
        target.onload = () => resolve(target);
        target.onerror = () => reject(new Error('Candidate load failed.'));
        target.src = candidateUrl;
      });
      const candidateHeight = Math.max(80, Math.round(candidateWidth * (image.naturalHeight / Math.max(1, image.naturalWidth))));
      const candidate = await loadGray(candidateUrl, candidateWidth, candidateHeight);
      let best = -1;

      for (const size of [14, 16, 18, 20, 22]) {
        const template = await loadGray(localUrl, size, size);
        for (let y = 0; y <= candidateHeight - size; y += 2) {
          for (let x = 0; x <= candidateWidth - size; x += 2) {
            best = Math.max(best, normalizedCorrelation(candidate, candidateWidth, x, y, template, size, size));
          }
        }
      }
      return Number(best.toFixed(4));
    } finally {
      URL.revokeObjectURL(localUrl);
    }
  } catch {
    return null;
  }
}

async function verifyChartType(crop: CropResult | null): Promise<ChartTypeVerification> {
  if (!crop) {
    return {
      detected: 'unknown',
      candlestickScore: null,
      mismatchTemplate: null,
      mismatchScore: null,
      verified: false,
      mismatch: false,
      reasonCode: 'CHARTTYPE_UNVERIFIED',
    };
  }

  const candleScore = await bestTemplateScore(crop.dataUrl, '/templates/quotex-candlestick-v1.png');
  if (candleScore !== null && candleScore >= CHARTTYPE_CANDLE_THRESHOLD) {
    return {
      detected: 'candlestick',
      candlestickScore: candleScore,
      mismatchTemplate: null,
      mismatchScore: null,
      verified: true,
      mismatch: false,
      reasonCode: null,
    };
  }

  const knownMismatches: Array<{ type: 'line' | 'bars' | 'heikin_ashi'; url: string }> = [
    { type: 'line', url: '/templates/quotex-line-v1.png' },
    { type: 'bars', url: '/templates/quotex-bars-v1.png' },
    { type: 'heikin_ashi', url: '/templates/quotex-heikin-ashi-v1.png' },
  ];
  for (const mismatch of knownMismatches) {
    const score = await bestTemplateScore(crop.dataUrl, mismatch.url);
    if (score !== null && score >= CHARTTYPE_CANDLE_THRESHOLD) {
      return {
        detected: mismatch.type,
        candlestickScore: candleScore,
        mismatchTemplate: mismatch.type,
        mismatchScore: score,
        verified: false,
        mismatch: true,
        reasonCode: 'CHARTTYPE_MISMATCH',
      };
    }
  }

  return {
    detected: 'unknown',
    candlestickScore: candleScore,
    mismatchTemplate: null,
    mismatchScore: null,
    verified: false,
    mismatch: false,
    reasonCode: 'CHARTTYPE_UNVERIFIED',
  };
}

async function blueOcclusionBand(crop: CropResult): Promise<{ top: number; bottom: number } | null> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const target = new Image();
      target.onload = () => resolve(target);
      target.onerror = () => reject(new Error('Price-axis crop could not load.'));
      target.src = crop.dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rows: number[] = [];
    for (let y = 0; y < canvas.height; y += 1) {
      let blue = 0;
      for (let x = 0; x < canvas.width; x += 1) {
        const index = ((y * canvas.width) + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        if (b > 120 && g > 70 && b > r * 1.2 && b > g * 1.03) blue += 1;
      }
      if (blue / Math.max(1, canvas.width) >= 0.08) rows.push(y);
    }
    if (!rows.length) return null;
    return { top: Math.max(0, Math.min(...rows) - 3), bottom: Math.min(canvas.height - 1, Math.max(...rows) + 3) };
  } catch {
    return null;
  }
}

function coefficientOfVariation(values: number[]): number | null {
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function linearFitR2(points: Array<{ y: number; value: number }>): number | null {
  if (points.length < 2) return null;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const meanV = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  let cov = 0;
  let varY = 0;
  for (const point of points) {
    cov += (point.y - meanY) * (point.value - meanV);
    varY += (point.y - meanY) ** 2;
  }
  if (varY === 0) return null;
  const slope = cov / varY;
  const intercept = meanV - (slope * meanY);
  let ssRes = 0;
  let ssTot = 0;
  for (const point of points) {
    const predicted = intercept + (slope * point.y);
    ssRes += (point.value - predicted) ** 2;
    ssTot += (point.value - meanV) ** 2;
  }
  if (ssTot === 0) return null;
  return 1 - (ssRes / ssTot);
}

async function verifyPriceAxis(crop: CropResult | null): Promise<PriceAxisFit> {
  if (!crop) {
    return {
      readable: false,
      rawText: null,
      values: [],
      labels: [],
      rejected: [],
      min: null,
      max: null,
      monotonic: false,
      r2: null,
      pixelSpacingCv: null,
      priceStepCv: null,
      occlusionBand: null,
      reasonCode: 'PRICE_AXIS_UNREADABLE',
    };
  }
  try {
    const [ocr, band] = await Promise.all([ocrCrop(crop, 'price_axis'), blueOcclusionBand(crop)]);
    const labels: PriceAxisFit['labels'] = [];
    const rejected: PriceAxisFit['rejected'] = [];

    for (const token of ocr.tokens) {
      const text = token.text.trim();
      if (!/^\d+\.\d{3,6}$/.test(text)) {
        if (text) rejected.push({ text, confidence: token.confidence, reason: 'NON_PRICE_TOKEN' });
        continue;
      }
      if (token.confidence < OCR_MIN_CONFIDENCE) {
        rejected.push({ text, confidence: token.confidence, reason: 'LOW_OCR_CONFIDENCE' });
        continue;
      }
      const centerY = token.top + (token.height / 2);
      if (band && centerY >= band.top && centerY <= band.bottom) {
        rejected.push({ text, confidence: token.confidence, reason: 'OCCLUDED_BY_CURRENT_PRICE_TAG' });
        continue;
      }
      const value = Number(text);
      if (!Number.isFinite(value)) {
        rejected.push({ text, confidence: token.confidence, reason: 'PARSE_FAILED' });
        continue;
      }
      labels.push({ text, value, y: centerY, confidence: token.confidence });
    }

    labels.sort((a, b) => a.y - b.y);
    const unique: PriceAxisFit['labels'] = [];
    for (const label of labels) {
      if (!unique.some((existing) => Math.abs(existing.value - label.value) < 1e-9)) unique.push(label);
    }

    const values = unique.map((label) => label.value);
    const monotonic = unique.every((label, index) => index === 0 || label.value < unique[index - 1].value);
    const pixelSteps = unique.slice(1).map((label, index) => label.y - unique[index].y);
    const priceSteps = unique.slice(1).map((label, index) => unique[index].value - label.value);
    const pixelSpacingCv = coefficientOfVariation(pixelSteps);
    const priceStepCv = coefficientOfVariation(priceSteps);
    const r2 = linearFitR2(unique);

    if (unique.length < PRICE_AXIS_MIN_LABELS) {
      return {
        readable: false,
        rawText: ocr.rawText || null,
        values,
        labels: unique,
        rejected,
        min: null,
        max: null,
        monotonic,
        r2,
        pixelSpacingCv,
        priceStepCv,
        occlusionBand: band,
        reasonCode: 'PRICE_AXIS_UNREADABLE',
      };
    }

    const linear = monotonic
      && r2 !== null && r2 >= PRICE_AXIS_R2_MIN
      && pixelSpacingCv !== null && pixelSpacingCv <= PRICE_AXIS_PIXEL_SPACING_CV_MAX
      && priceStepCv !== null && priceStepCv <= PRICE_AXIS_STEP_CV_MAX;

    return {
      readable: linear,
      rawText: ocr.rawText || null,
      values,
      labels: unique,
      rejected,
      min: Math.min(...values),
      max: Math.max(...values),
      monotonic,
      r2: r2 === null ? null : Number(r2.toFixed(6)),
      pixelSpacingCv: pixelSpacingCv === null ? null : Number(pixelSpacingCv.toFixed(4)),
      priceStepCv: priceStepCv === null ? null : Number(priceStepCv.toFixed(4)),
      occlusionBand: band,
      reasonCode: linear ? null : 'PRICE_AXIS_NONLINEAR',
    };
  } catch {
    return {
      readable: false,
      rawText: null,
      values: [],
      labels: [],
      rejected: [],
      min: null,
      max: null,
      monotonic: false,
      r2: null,
      pixelSpacingCv: null,
      priceStepCv: null,
      occlusionBand: null,
      reasonCode: 'PRICE_AXIS_UNREADABLE',
    };
  }
}

export async function verifyStage3CFrame(args: {
  crops: CropResult[];
  metrics: DeterministicScreenMetrics;
  configuredAsset: string | null;
  previousClock?: { secondsOfDay: number; observedClientMs: number } | null;
}): Promise<Stage3CVerification> {
  const base = await verifyStructuredScreenFields({
    crops: args.crops,
    metrics: args.metrics,
    configuredAsset: args.configuredAsset,
  });

  const chartTypeCrop = cropByRole(args.crops, 'chartTypeToolbar');
  const clockCrop = cropByRole(args.crops, 'platformClock');
  const assetCrop = cropByRole(args.crops, 'assetLabel');
  const priceCrop = cropByRole(args.crops, 'priceAxis');

  const [chartType, platformClock, assetPayoutOcr, priceAxis] = await Promise.all([
    verifyChartType(chartTypeCrop),
    verifyPlatformClock(clockCrop, args.previousClock || null),
    assetCrop ? ocrCrop(assetCrop, 'asset_payout').catch(() => null) : Promise.resolve(null),
    verifyPriceAxis(priceCrop),
  ]);

  const payout = assetPayoutOcr ? parsePayout(assetPayoutOcr) : {
    rawText: null,
    payoutPercent: null,
    payoutDecimal: null,
    breakevenWinRate: null,
    confidence: null,
    reasonCode: 'PAYOUT_UNREADABLE' as const,
  };

  const assetNormalized = assetPayoutOcr ? normalizeAsset(assetPayoutOcr.rawText) : null;
  const configured = args.configuredAsset ? normalizeAsset(args.configuredAsset) : null;
  const assetTokenConfidences = assetPayoutOcr
    ? assetPayoutOcr.tokens
      .filter((token) => token.confidence >= 0 && /[A-Z]{3}\/[A-Z]{3}|OTC/i.test(token.text))
      .map((token) => token.confidence)
    : [];
  const payoutConfidences = payout.confidence === null ? [] : [payout.confidence];

  const timeframeBadgePass = base.timeframeBadgeScore !== null && base.timeframeBadgeScore >= TIMEFRAME_TEMPLATE_THRESHOLD;
  const timeframeAxisPass = base.timeAxis.verifiedM1;
  const timeframeDisagreement = timeframeBadgePass !== timeframeAxisPass;

  const reasons = [...base.reasons];
  if (!chartType.verified) reasons.push(chartType.mismatch ? 'CHARTTYPE_MISMATCH' : 'CHARTTYPE_UNVERIFIED');
  if (!priceAxis.readable) reasons.push(priceAxis.reasonCode === 'PRICE_AXIS_NONLINEAR' ? 'PRICE_AXIS_NONLINEAR' : 'PRICE_AXIS_UNREADABLE');
  if (platformClock.reasonCode) reasons.push(platformClock.reasonCode);

  if (assetNormalized && configured && assetNormalized !== configured && !reasons.includes('ASSET_MISMATCH')) {
    reasons.push('ASSET_MISMATCH');
  }

  const legibility: FieldLegibility = {
    asset: confidenceSummary(assetTokenConfidences),
    payout: confidenceSummary(payoutConfidences),
    timeAxis: confidenceSummary(base.timeAxis.labels.map((label) => label.confidence)),
    priceAxis: confidenceSummary(priceAxis.labels.map((label) => label.confidence)),
    platformClock: confidenceSummary(platformClock.confidence === null ? [] : [platformClock.confidence]),
    sourceWidth: args.metrics.width,
    sourceHeight: args.metrics.height,
  };

  const uniqueReasons = Array.from(new Set(reasons));
  const frameVerified = uniqueReasons.length === 0;
  return {
    ...base,
    chartType,
    platformClock,
    payout,
    priceAxis,
    legibility,
    timeframeDisagreement,
    reasons: uniqueReasons,
    frameVerified,
    productionEligible: frameVerified && STAGE3C_VALIDATION_COVERAGE_COMPLETE,
    productionBlockReason: frameVerified && !STAGE3C_VALIDATION_COVERAGE_COMPLETE
      ? 'LAYOUT_VALIDATION_INCOMPLETE'
      : frameVerified
        ? null
        : uniqueReasons[0] || 'TIMEFRAME_UNVERIFIED',
  };
}
