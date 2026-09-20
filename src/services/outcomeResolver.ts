import { apiFetch } from './apiClient';
import type { CropResult } from './screenPipeline';
import type { Stage3CVerification } from './screenStage3C';

export const OUTCOME_RESOLVER_VERSION = 'stage11-v1.0.0';
export const SETTLEMENT_RULE_VERSION = 'quotex-fixed-time-rules-2.4-5.3-5.5-v1';
export const SETTLEMENT_RULE_STATUS = 'DOCUMENTED_VERIFIED' as const;
export const SCREEN_RESOLVER_VALIDATION_STATUS = 'PENDING_30_MANUAL_DEMO_TRADES' as const;
export const REQUIRED_DEMO_TRADES = 30;
export const CURRENT_PRICE_AXIS_RESIDUAL_FRACTION_MAX = 0.20;
export const REQUIRED_EXPIRY_SECONDS = 60;
const OCR_MIN_CONFIDENCE = 70;

export type ResolverDirection = 'CALL' | 'PUT';
export type ResolverOutcome = 'WIN' | 'LOSS' | 'TIE' | null;
export type ManualPlatformOutcome = 'WIN' | 'LOSS' | 'TIE';

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
}

export interface CurrentPriceReading {
  price: number | null;
  rawText: string | null;
  ocrConfidence: number | null;
  axisPredictedPrice: number | null;
  axisResidual: number | null;
  allowedResidual: number | null;
  crossCheckPassed: boolean;
  confidence: number | null;
  reasonCode:
    | 'CURRENT_PRICE_TAG_UNREADABLE'
    | 'CURRENT_PRICE_TAG_AMBIGUOUS'
    | 'CURRENT_PRICE_AXIS_FIT_UNAVAILABLE'
    | 'CURRENT_PRICE_CROSSCHECK_FAILED'
    | null;
}

export interface ExpiryReading {
  rawText: string | null;
  expirySeconds: number | null;
  verifiedOneMinute: boolean;
  confidence: number | null;
  reasonCode: 'EXPIRY_UNREADABLE' | 'EXPIRY_NOT_60_SECONDS' | null;
}

export interface ResolverSnapshot {
  capturedAt: string;
  platformClockUtc: string | null;
  asset: string | null;
  price: CurrentPriceReading;
  expiry: ExpiryReading;
  payoutDecimal: number | null;
  payoutPercent: number | null;
  payoutConfidence: number | null;
  breakevenWinRate: number | null;
  payoutReason: string | null;
  frameReasons: string[];
  priceAxisR2: number | null;
  sourceFrameSha256: string | null;
}

export interface OutcomeResolverTrade {
  tradeId: string;
  direction: ResolverDirection;
  armedAt: string;
  dueAt: string;
  entry: ResolverSnapshot;
  expiry: ResolverSnapshot | null;
  resolverOutcome: ResolverOutcome;
  resolverNullReason: string | null;
  unitReturn: number | null;
  platformOutcome: ManualPlatformOutcome | null;
  agreement: boolean | null;
  settlementRuleVersion: string;
  settlementRuleStatus: typeof SETTLEMENT_RULE_STATUS;
  screenValidationStatus: typeof SCREEN_RESOLVER_VALIDATION_STATUS;
}

export interface OutcomeResolverSummary {
  totalArmed: number;
  expired: number;
  resolverKnown: number;
  resolverNull: number;
  resolverNullRate: number | null;
  manuallyLabeled: number;
  agreementEligible: number;
  agreements: number;
  agreementRate: number | null;
  knownReturnCount: number;
  meanUnitReturnKnown: number | null;
  fullSampleExpectancy: number | null;
  validationTarget: number;
  validationComplete: boolean;
  selectionBiasWarning: string | null;
}

export type OutcomeEvent =
  | { eventId: string; tradeId: string; eventType: 'ARMED'; recordedAt: string; payload: { direction: ResolverDirection; dueAt: string; entry: ResolverSnapshot } }
  | { eventId: string; tradeId: string; eventType: 'EXPIRED'; recordedAt: string; payload: { expiry: ResolverSnapshot; resolverOutcome: ResolverOutcome; resolverNullReason: string | null; unitReturn: number | null } }
  | { eventId: string; tradeId: string; eventType: 'MANUAL_OUTCOME'; recordedAt: string; payload: { platformOutcome: ManualPlatformOutcome } };

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cropByRole(crops: CropResult[], role: CropResult['role']): CropResult | null {
  return crops.find((crop) => crop.role === role) || null;
}

async function ocr(crop: CropResult, mode: 'price_axis' | 'trade_fields'): Promise<OcrResult> {
  const response = await apiFetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: crop.dataUrl, mode }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'OCR failed.');
  return {
    rawText: String(data.rawText || ''),
    tokens: Array.isArray(data.tokens) ? data.tokens : [],
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fitPriceAxis(labels: Stage3CVerification['priceAxis']['labels']): {
  slope: number;
  intercept: number;
  medianStep: number;
} | null {
  if (labels.length < 5) return null;
  const meanY = labels.reduce((sum, label) => sum + label.y, 0) / labels.length;
  const meanPrice = labels.reduce((sum, label) => sum + label.value, 0) / labels.length;
  let covariance = 0;
  let varianceY = 0;
  for (const label of labels) {
    covariance += (label.y - meanY) * (label.value - meanPrice);
    varianceY += (label.y - meanY) ** 2;
  }
  if (varianceY <= 0) return null;
  const slope = covariance / varianceY;
  const intercept = meanPrice - (slope * meanY);
  const steps = labels.slice(1).map((label, index) => Math.abs(label.value - labels[index].value)).filter((value) => value > 0);
  const medianStep = median(steps);
  if (medianStep === null) return null;
  return { slope, intercept, medianStep };
}

export async function readCurrentPrice(
  crops: CropResult[],
  verification: Stage3CVerification,
): Promise<CurrentPriceReading> {
  const crop = cropByRole(crops, 'priceAxis');
  const band = verification.priceAxis.occlusionBand;
  const fit = fitPriceAxis(verification.priceAxis.labels);
  if (!crop || !band || !fit || !verification.priceAxis.readable) {
    return {
      price: null, rawText: null, ocrConfidence: null, axisPredictedPrice: null,
      axisResidual: null, allowedResidual: null, crossCheckPassed: false,
      confidence: null, reasonCode: 'CURRENT_PRICE_AXIS_FIT_UNAVAILABLE',
    };
  }

  try {
    const result = await ocr(crop, 'price_axis');
    const candidates = result.tokens
      .filter((token) => token.confidence >= OCR_MIN_CONFIDENCE)
      .map((token) => {
        const text = token.text.trim();
        if (!/^\d+\.\d{3,6}$/.test(text)) return null;
        const y = token.top + (token.height / 2);
        if (y < band.top || y > band.bottom) return null;
        const value = Number(text);
        return Number.isFinite(value) ? { value, y, confidence: token.confidence, text } : null;
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    if (!candidates.length) {
      return {
        price: null, rawText: result.rawText || null, ocrConfidence: null, axisPredictedPrice: null,
        axisResidual: null, allowedResidual: Number((fit.medianStep * CURRENT_PRICE_AXIS_RESIDUAL_FRACTION_MAX).toPrecision(8)),
        crossCheckPassed: false, confidence: null, reasonCode: 'CURRENT_PRICE_TAG_UNREADABLE',
      };
    }
    if (candidates.length !== 1) {
      return {
        price: null, rawText: result.rawText || null, ocrConfidence: null, axisPredictedPrice: null,
        axisResidual: null, allowedResidual: Number((fit.medianStep * CURRENT_PRICE_AXIS_RESIDUAL_FRACTION_MAX).toPrecision(8)),
        crossCheckPassed: false, confidence: null, reasonCode: 'CURRENT_PRICE_TAG_AMBIGUOUS',
      };
    }

    const candidate = candidates[0];
    const predicted = (fit.slope * candidate.y) + fit.intercept;
    const residual = Math.abs(candidate.value - predicted);
    const allowed = fit.medianStep * CURRENT_PRICE_AXIS_RESIDUAL_FRACTION_MAX;
    const passed = residual <= allowed;
    const geometryConfidence = allowed > 0 ? Math.max(0, 100 * (1 - (residual / allowed))) : 0;

    return {
      price: passed ? candidate.value : null,
      rawText: candidate.text,
      ocrConfidence: Number(candidate.confidence.toFixed(2)),
      axisPredictedPrice: Number(predicted.toPrecision(8)),
      axisResidual: Number(residual.toPrecision(8)),
      allowedResidual: Number(allowed.toPrecision(8)),
      crossCheckPassed: passed,
      confidence: passed ? Number(Math.min(candidate.confidence, geometryConfidence).toFixed(2)) : null,
      reasonCode: passed ? null : 'CURRENT_PRICE_CROSSCHECK_FAILED',
    };
  } catch {
    return {
      price: null, rawText: null, ocrConfidence: null, axisPredictedPrice: null,
      axisResidual: null, allowedResidual: null, crossCheckPassed: false,
      confidence: null, reasonCode: 'CURRENT_PRICE_TAG_UNREADABLE',
    };
  }
}

function parseDurationToken(text: string): number | null {
  const match = text.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  return (hours * 3600) + (minutes * 60) + seconds;
}

export async function readExpiryDuration(crops: CropResult[]): Promise<ExpiryReading> {
  const crop = cropByRole(crops, 'payoutExpiryPanel');
  if (!crop) return { rawText: null, expirySeconds: null, verifiedOneMinute: false, confidence: null, reasonCode: 'EXPIRY_UNREADABLE' };
  try {
    const result = await ocr(crop, 'trade_fields');
    const candidates = result.tokens
      .filter((token) => token.confidence >= OCR_MIN_CONFIDENCE)
      .map((token) => {
        const seconds = parseDurationToken(token.text);
        return seconds === null ? null : { seconds, confidence: token.confidence, text: token.text.trim() };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    const oneMinute = candidates.filter((candidate) => candidate.seconds === REQUIRED_EXPIRY_SECONDS);
    if (oneMinute.length === 1) {
      return {
        rawText: oneMinute[0].text,
        expirySeconds: oneMinute[0].seconds,
        verifiedOneMinute: true,
        confidence: Number(oneMinute[0].confidence.toFixed(2)),
        reasonCode: null,
      };
    }

    if (candidates.length === 1) {
      return {
        rawText: candidates[0].text,
        expirySeconds: candidates[0].seconds,
        verifiedOneMinute: false,
        confidence: Number(candidates[0].confidence.toFixed(2)),
        reasonCode: 'EXPIRY_NOT_60_SECONDS',
      };
    }
    return { rawText: result.rawText || null, expirySeconds: null, verifiedOneMinute: false, confidence: null, reasonCode: 'EXPIRY_UNREADABLE' };
  } catch {
    return { rawText: null, expirySeconds: null, verifiedOneMinute: false, confidence: null, reasonCode: 'EXPIRY_UNREADABLE' };
  }
}

export async function buildResolverSnapshot(args: {
  crops: CropResult[];
  verification: Stage3CVerification;
  capturedAt: string;
  sourceFrameSha256: string | null;
}): Promise<ResolverSnapshot> {
  const [price, expiry] = await Promise.all([
    readCurrentPrice(args.crops, args.verification),
    readExpiryDuration(args.crops),
  ]);
  return {
    capturedAt: args.capturedAt,
    platformClockUtc: args.verification.platformClock.parsedText,
    asset: typeof args.verification.asset.parsedValue === 'string' ? args.verification.asset.parsedValue : null,
    price,
    expiry,
    payoutDecimal: args.verification.payout.payoutDecimal,
    payoutPercent: args.verification.payout.payoutPercent,
    payoutConfidence: args.verification.payout.confidence,
    breakevenWinRate: args.verification.payout.breakevenWinRate,
    payoutReason: args.verification.payout.reasonCode,
    frameReasons: args.verification.reasons,
    priceAxisR2: args.verification.priceAxis.r2,
    sourceFrameSha256: args.sourceFrameSha256,
  };
}

export function resolveOutcome(args: {
  direction: ResolverDirection;
  entry: ResolverSnapshot;
  expiry: ResolverSnapshot;
}): { outcome: ResolverOutcome; nullReason: string | null; unitReturn: number | null } {
  if (!args.entry.expiry.verifiedOneMinute) return { outcome: null, nullReason: args.entry.expiry.reasonCode || 'ONE_MINUTE_EXPIRY_UNVERIFIED', unitReturn: null };
  if (args.entry.price.price === null) return { outcome: null, nullReason: args.entry.price.reasonCode || 'ENTRY_PRICE_UNREADABLE', unitReturn: null };
  if (args.expiry.price.price === null) return { outcome: null, nullReason: args.expiry.price.reasonCode || 'EXPIRY_PRICE_UNREADABLE', unitReturn: null };
  if (args.entry.payoutDecimal === null) return { outcome: null, nullReason: args.entry.payoutReason || 'PAYOUT_UNREADABLE', unitReturn: null };

  const entry = args.entry.price.price;
  const expiry = args.expiry.price.price;
  let outcome: Exclude<ResolverOutcome, null>;
  if (expiry === entry) outcome = 'TIE';
  else if (args.direction === 'CALL') outcome = expiry > entry ? 'WIN' : 'LOSS';
  else outcome = expiry < entry ? 'WIN' : 'LOSS';

  const unitReturn = outcome === 'WIN' ? args.entry.payoutDecimal : outcome === 'LOSS' ? -1 : 0;
  return { outcome, nullReason: null, unitReturn: Number(unitReturn.toFixed(6)) };
}

export async function appendOutcomeEvent(event: OutcomeEvent): Promise<void> {
  const response = await apiFetch('/api/outcomes/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'Could not persist outcome event.');
}

export async function loadOutcomeEvents(): Promise<OutcomeEvent[]> {
  const response = await apiFetch('/api/outcomes/events', { method: 'GET', cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'Could not load outcome events.');
  return Array.isArray(data.events) ? data.events : [];
}

export function foldOutcomeTrades(events: OutcomeEvent[]): OutcomeResolverTrade[] {
  const map = new Map<string, OutcomeResolverTrade>();
  for (const event of events) {
    if (event.eventType === 'ARMED') {
      map.set(event.tradeId, {
        tradeId: event.tradeId,
        direction: event.payload.direction,
        armedAt: event.recordedAt,
        dueAt: event.payload.dueAt,
        entry: event.payload.entry,
        expiry: null,
        resolverOutcome: null,
        resolverNullReason: null,
        unitReturn: null,
        platformOutcome: null,
        agreement: null,
        settlementRuleVersion: SETTLEMENT_RULE_VERSION,
        settlementRuleStatus: SETTLEMENT_RULE_STATUS,
        screenValidationStatus: SCREEN_RESOLVER_VALIDATION_STATUS,
      });
      continue;
    }
    const trade = map.get(event.tradeId);
    if (!trade) continue;
    if (event.eventType === 'EXPIRED') {
      trade.expiry = event.payload.expiry;
      trade.resolverOutcome = event.payload.resolverOutcome;
      trade.resolverNullReason = event.payload.resolverNullReason;
      trade.unitReturn = event.payload.unitReturn;
    } else if (event.eventType === 'MANUAL_OUTCOME') {
      trade.platformOutcome = event.payload.platformOutcome;
    }
    trade.agreement = trade.platformOutcome && trade.resolverOutcome
      ? trade.platformOutcome === trade.resolverOutcome
      : null;
  }
  return [...map.values()].sort((a, b) => b.armedAt.localeCompare(a.armedAt));
}

export function summarizeOutcomeTrades(trades: OutcomeResolverTrade[]): OutcomeResolverSummary {
  const expired = trades.filter((trade) => trade.expiry !== null);
  const known = expired.filter((trade) => trade.resolverOutcome !== null);
  const resolverNull = expired.length - known.length;
  const manuallyLabeled = trades.filter((trade) => trade.platformOutcome !== null);
  const agreementEligible = manuallyLabeled.filter((trade) => trade.resolverOutcome !== null);
  const agreements = agreementEligible.filter((trade) => trade.agreement === true).length;
  const knownReturns = expired.map((trade) => trade.unitReturn).filter((value): value is number => value !== null && Number.isFinite(value));
  const meanKnown = knownReturns.length
    ? knownReturns.reduce((sum, value) => sum + value, 0) / knownReturns.length
    : null;
  const nullRate = expired.length ? resolverNull / expired.length : null;

  return {
    totalArmed: trades.length,
    expired: expired.length,
    resolverKnown: known.length,
    resolverNull,
    resolverNullRate: nullRate === null ? null : Number((nullRate * 100).toFixed(2)),
    manuallyLabeled: manuallyLabeled.length,
    agreementEligible: agreementEligible.length,
    agreements,
    agreementRate: agreementEligible.length ? Number(((agreements / agreementEligible.length) * 100).toFixed(2)) : null,
    knownReturnCount: knownReturns.length,
    meanUnitReturnKnown: meanKnown === null ? null : Number(meanKnown.toFixed(6)),
    fullSampleExpectancy: expired.length > 0 && resolverNull === 0 && knownReturns.length === expired.length
      ? Number((knownReturns.reduce((sum, value) => sum + value, 0) / expired.length).toFixed(6))
      : null,
    validationTarget: REQUIRED_DEMO_TRADES,
    validationComplete: manuallyLabeled.length >= REQUIRED_DEMO_TRADES,
    selectionBiasWarning: resolverNull > 0
      ? 'Resolver metrics condition on readable outcomes. If unreadable frames correlate with volatility, overlays, latency, or other market states, the resolved subset may be selection-biased.'
      : null,
  };
}

export function makeArmedEvent(direction: ResolverDirection, entry: ResolverSnapshot): Extract<OutcomeEvent, { eventType: 'ARMED' }> {
  const tradeId = newId();
  const dueAt = new Date(Date.parse(entry.capturedAt) + (REQUIRED_EXPIRY_SECONDS * 1000)).toISOString();
  return { eventId: newId(), tradeId, eventType: 'ARMED', recordedAt: new Date().toISOString(), payload: { direction, dueAt, entry } };
}

export function makeExpiredEvent(tradeId: string, direction: ResolverDirection, entry: ResolverSnapshot, expiry: ResolverSnapshot): Extract<OutcomeEvent, { eventType: 'EXPIRED' }> {
  const resolved = resolveOutcome({ direction, entry, expiry });
  return {
    eventId: newId(),
    tradeId,
    eventType: 'EXPIRED',
    recordedAt: new Date().toISOString(),
    payload: { expiry, resolverOutcome: resolved.outcome, resolverNullReason: resolved.nullReason, unitReturn: resolved.unitReturn },
  };
}

export function makeManualOutcomeEvent(tradeId: string, platformOutcome: ManualPlatformOutcome): Extract<OutcomeEvent, { eventType: 'MANUAL_OUTCOME' }> {
  return { eventId: newId(), tradeId, eventType: 'MANUAL_OUTCOME', recordedAt: new Date().toISOString(), payload: { platformOutcome } };
}
