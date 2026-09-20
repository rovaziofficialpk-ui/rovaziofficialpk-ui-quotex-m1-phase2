import type { TradeSignal } from '../signalLogic';

export const SCREEN_PIPELINE_VERSION = 'screen-input-v1.0.0';
export const INPUT_PIPELINE_CONFIG_VERSION = 'input-pipeline-v1.1.0';
export const LAYOUT_PROFILE_VERSION = 'quotex-desktop-observed-v1.0.0';

export type ScreenReasonCode =
  | 'LAYOUT_NOT_FOUND'
  | 'LETTERBOX_DETECTED'
  | 'PLOT_AREA_TOO_SMALL'
  | 'CANDLE_COUNT_OUT_OF_RANGE'
  | 'NEWEST_CANDLE_NOT_VISIBLE'
  | 'CURRENT_PRICE_MARKER_MISSING'
  | 'PRICE_AXIS_UNREADABLE'
  | 'TIME_AXIS_UNREADABLE'
  | 'TIMEFRAME_UNVERIFIED'
  | 'TIMEFRAME_MISMATCH'
  | 'ASSET_UNVERIFIED'
  | 'ASSET_MISMATCH';

export type CropRole =
  | 'primary'
  | 'plotArea'
  | 'zoomedNewest'
  | 'priceAxis'
  | 'timeAxis'
  | 'assetLabel'
  | 'tradePanel'
  | 'payoutExpiryPanel';

export interface RelativeRect { x: number; y: number; w: number; h: number }
export interface PixelRect { x: number; y: number; width: number; height: number }

export interface CropResult {
  role: CropRole;
  dataUrl: string;
  rect: PixelRect;
  upscale: number;
  interpolation: string;
}

export interface MissingCrop {
  role: 'timeframeLabel';
  reasonCode: 'TIMEFRAME_LABEL_NOT_VISIBLE_IN_CALIBRATION';
}

export interface DeterministicScreenMetrics {
  width: number;
  height: number;
  aspectRatio: number;
  plotCombinedCandleColorRatio: number;
  rightPanelGreenRatio: number;
  rightPanelRedRatio: number;
  currentPriceBlueRatio: number;
  horizontalMarkerRowRatio: number;
  outerNearBlackRatio: number;
  candleCount: number;
  lastCandleXFraction: number | null;
}

export interface ParsedScreenField {
  rawText: string | null;
  parsedValue: string | number | null;
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  reasonCode: string | null;
}

export interface DeterministicScreenResult {
  safeForAi: boolean;
  reasonCode: ScreenReasonCode | null;
  reasons: ScreenReasonCode[];
  layoutFound: boolean;
  metrics: DeterministicScreenMetrics;
  crops: CropResult[];
  missingCrops: MissingCrop[];
  timeframe: ParsedScreenField;
  asset: ParsedScreenField;
  priceAxis: { readable: boolean; min: number | null; max: number | null; reasonCode: string | null };
  timeAxis: { readable: boolean; spanSeconds: number | null; reasonCode: string | null };
  newestCandleVisible: boolean;
  currentPriceMarkerPresent: boolean;
  letterboxDetected: boolean;
}

const PROFILE = {
  aspectMin: 2.15,
  aspectMax: 2.26,
  minWidth: 700,
  minHeight: 300,
  regions: {
    primary: { x: 0.04755435, y: 0.12874251, w: 0.83967391, h: 0.87125749 },
    plotArea: { x: 0.04755435, y: 0.12874251, w: 0.76766304, h: 0.76946108 },
    zoomedNewest: { x: 0.38, y: 0.12874251, w: 0.43521739, h: 0.76946108 },
    priceAxis: { x: 0.81521739, y: 0.12874251, w: 0.07201087, h: 0.76946108 },
    timeAxis: { x: 0.04755435, y: 0.89820359, w: 0.83967391, h: 0.10179641 },
    assetLabel: { x: 0.05978261, y: 0.05389222, w: 0.16304348, h: 0.09580838 },
    tradePanel: { x: 0.88722826, y: 0.05389222, w: 0.11277174, h: 0.94610778 },
    payoutExpiryPanel: { x: 0.88722826, y: 0.05389222, w: 0.11277174, h: 0.43413174 },
  } satisfies Record<CropRole, RelativeRect>,
  minCandles: 12,
  maxCandles: 80,
  minCandleColorRatio: 0.015,
  minRightGreen: 0.015,
  minRightRed: 0.015,
  minPriceBlue: 0.005,
  minMarkerRow: 0.15,
  maxNearBlackEdge: 0.35,
} as const;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the captured source frame.'));
    image.src = dataUrl;
  });
}

function toPixelRect(rect: RelativeRect, width: number, height: number): PixelRect {
  const x = Math.max(0, Math.round(rect.x * width));
  const y = Math.max(0, Math.round(rect.y * height));
  const right = Math.min(width, Math.round((rect.x + rect.w) * width));
  const bottom = Math.min(height, Math.round((rect.y + rect.h) * height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function imageDataFor(context: CanvasRenderingContext2D, rect: PixelRect): ImageData {
  return context.getImageData(rect.x, rect.y, rect.width, rect.height);
}

function channelRatios(data: ImageData): { green: number; red: number; blue: number } {
  let green = 0;
  let red = 0;
  let blue = 0;
  const total = Math.max(1, data.width * data.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const r = data.data[i];
    const g = data.data[i + 1];
    const b = data.data[i + 2];
    if (g > 90 && g > r * 1.25 && g > b * 1.15) green += 1;
    if (r > 100 && r > g * 1.15 && r > b * 1.15) red += 1;
    if (b > 120 && g > 70 && b > r * 1.25 && b > g * 1.05) blue += 1;
  }
  return { green: green / total, red: red / total, blue: blue / total };
}

function horizontalMarkerRatio(data: ImageData): number {
  let best = 0;
  for (let y = 0; y < data.height; y += 1) {
    let matches = 0;
    for (let x = 0; x < data.width; x += 1) {
      const i = ((y * data.width) + x) * 4;
      const r = data.data[i];
      const g = data.data[i + 1];
      const b = data.data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const mean = (r + g + b) / 3;
      if (max - min < 18 && mean > 65) matches += 1;
    }
    best = Math.max(best, matches / Math.max(1, data.width));
  }
  return best;
}

function outerNearBlackRatio(data: ImageData): number {
  const bandX = Math.max(1, Math.round(data.width * 0.02));
  const bandY = Math.max(1, Math.round(data.height * 0.02));
  let total = 0;
  let black = 0;
  for (let y = 0; y < data.height; y += 1) {
    for (let x = 0; x < data.width; x += 1) {
      if (!(x < bandX || x >= data.width - bandX || y < bandY || y >= data.height - bandY)) continue;
      const i = ((y * data.width) + x) * 4;
      const lum = (data.data[i] * 0.2126) + (data.data[i + 1] * 0.7152) + (data.data[i + 2] * 0.0722);
      total += 1;
      if (lum < 6) black += 1;
    }
  }
  return black / Math.max(1, total);
}

function candleColumnGroups(data: ImageData): { count: number; lastXFraction: number | null } {
  const minimumPixelsPerColumn = Math.max(5, Math.round(data.height * 0.015));
  const active = new Array<boolean>(data.width).fill(false);
  for (let x = 0; x < data.width; x += 1) {
    let count = 0;
    for (let y = 0; y < data.height; y += 1) {
      const i = ((y * data.width) + x) * 4;
      const r = data.data[i];
      const g = data.data[i + 1];
      const b = data.data[i + 2];
      const isGreen = g > 90 && g > r * 1.25 && g > b * 1.15;
      const isRed = r > 100 && r > g * 1.15 && r > b * 1.15;
      if (isGreen || isRed) count += 1;
    }
    active[x] = count >= minimumPixelsPerColumn;
  }

  const ignoreLeft = Math.round(data.width * 0.05);
  for (let x = 0; x < ignoreLeft; x += 1) active[x] = false;

  const minimumRun = Math.max(3, Math.round(data.width * 0.005));
  const groups: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  for (let x = 0; x <= data.width; x += 1) {
    const on = x < data.width ? active[x] : false;
    if (on && start === null) start = x;
    if (!on && start !== null) {
      if (x - start >= minimumRun) groups.push({ start, end: x });
      start = null;
    }
  }
  const last = groups.length ? groups[groups.length - 1] : undefined;
  return {
    count: groups.length,
    lastXFraction: last ? ((last.start + last.end) / 2) / data.width : null,
  };
}

function cropImage(image: HTMLImageElement, role: CropRole, rect: PixelRect): CropResult {
  const small = !['primary', 'plotArea', 'zoomedNewest'].includes(role);
  const upscale = small ? 3 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = rect.width * upscale;
  canvas.height = rect.height * upscale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Browser crop rendering is unavailable.');
  context.imageSmoothingEnabled = !small;
  context.imageSmoothingQuality = small ? 'low' : 'high';
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return {
    role,
    dataUrl: canvas.toDataURL(small ? 'image/png' : 'image/jpeg', small ? undefined : 0.95),
    rect,
    upscale,
    interpolation: small ? 'nearest-neighbor' : 'high-quality-bilinear',
  };
}

export function decideDeterministicScreenGate(args: {
  metrics: DeterministicScreenMetrics;
  configuredTimeframe: string;
  parsedTimeframe: string | null;
  configuredAsset: string | null;
  parsedAsset: string | null;
  priceAxisReadable: boolean;
  timeAxisReadable: boolean;
}): { safeForAi: boolean; reasonCode: ScreenReasonCode | null; reasons: ScreenReasonCode[] } {
  const { metrics } = args;
  const reasons: ScreenReasonCode[] = [];
  const layoutFound =
    metrics.width >= PROFILE.minWidth
    && metrics.height >= PROFILE.minHeight
    && metrics.aspectRatio >= PROFILE.aspectMin
    && metrics.aspectRatio <= PROFILE.aspectMax
    && metrics.plotCombinedCandleColorRatio >= PROFILE.minCandleColorRatio
    && metrics.rightPanelGreenRatio >= PROFILE.minRightGreen
    && metrics.rightPanelRedRatio >= PROFILE.minRightRed;

  if (!layoutFound) reasons.push('LAYOUT_NOT_FOUND');
  if (metrics.outerNearBlackRatio > PROFILE.maxNearBlackEdge) reasons.push('LETTERBOX_DETECTED');
  if (metrics.candleCount < PROFILE.minCandles || metrics.candleCount > PROFILE.maxCandles) reasons.push('CANDLE_COUNT_OUT_OF_RANGE');
  if (metrics.lastCandleXFraction === null || metrics.lastCandleXFraction < 0.45 || metrics.lastCandleXFraction > 0.80) reasons.push('NEWEST_CANDLE_NOT_VISIBLE');
  if (metrics.currentPriceBlueRatio < PROFILE.minPriceBlue || metrics.horizontalMarkerRowRatio < PROFILE.minMarkerRow) reasons.push('CURRENT_PRICE_MARKER_MISSING');
  if (!args.priceAxisReadable) reasons.push('PRICE_AXIS_UNREADABLE');
  if (!args.timeAxisReadable) reasons.push('TIME_AXIS_UNREADABLE');

  if (!args.parsedTimeframe) reasons.push('TIMEFRAME_UNVERIFIED');
  else if (args.parsedTimeframe !== args.configuredTimeframe) reasons.push('TIMEFRAME_MISMATCH');

  if (!args.configuredAsset || !args.parsedAsset) reasons.push('ASSET_UNVERIFIED');
  else if (args.parsedAsset !== args.configuredAsset) reasons.push('ASSET_MISMATCH');

  return { safeForAi: reasons.length === 0, reasonCode: reasons[0] || null, reasons };
}

export async function inspectAndCropSingleFrame(sourceDataUrl: string, configuredAsset: string | null): Promise<DeterministicScreenResult> {
  const image = await loadImage(sourceDataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const aspectRatio = width / Math.max(1, height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Browser deterministic screen inspection is unavailable.');
  context.drawImage(image, 0, 0, width, height);

  const rects = Object.fromEntries(
    Object.entries(PROFILE.regions).map(([role, relative]) => [role, toPixelRect(relative, width, height)]),
  ) as Record<CropRole, PixelRect>;

  const plotData = imageDataFor(context, rects.plotArea);
  const rightData = imageDataFor(context, rects.tradePanel);
  const priceData = imageDataFor(context, rects.priceAxis);
  const fullData = context.getImageData(0, 0, width, height);
  const plotColors = channelRatios(plotData);
  const rightColors = channelRatios(rightData);
  const priceColors = channelRatios(priceData);
  const candleGroups = candleColumnGroups(plotData);

  const metrics: DeterministicScreenMetrics = {
    width,
    height,
    aspectRatio: Number(aspectRatio.toFixed(4)),
    plotCombinedCandleColorRatio: Number((plotColors.green + plotColors.red).toFixed(4)),
    rightPanelGreenRatio: Number(rightColors.green.toFixed(4)),
    rightPanelRedRatio: Number(rightColors.red.toFixed(4)),
    currentPriceBlueRatio: Number(priceColors.blue.toFixed(4)),
    horizontalMarkerRowRatio: Number(horizontalMarkerRatio(plotData).toFixed(4)),
    outerNearBlackRatio: Number(outerNearBlackRatio(fullData).toFixed(4)),
    candleCount: candleGroups.count,
    lastCandleXFraction: candleGroups.lastXFraction === null ? null : Number(candleGroups.lastXFraction.toFixed(3)),
  };

  const timeframe: ParsedScreenField = {
    rawText: null,
    parsedValue: null,
    confidence: 'unverified',
    reasonCode: 'NO_EXPLICIT_TIMEFRAME_LABEL_VISIBLE_IN_CALIBRATION',
  };
  const asset: ParsedScreenField = {
    rawText: null,
    parsedValue: null,
    confidence: 'unverified',
    reasonCode: configuredAsset ? 'DETERMINISTIC_ASSET_READER_NOT_CALIBRATED' : 'CONFIGURED_ASSET_MISSING',
  };
  const priceAxis = { readable: false, min: null, max: null, reasonCode: 'DETERMINISTIC_OCR_NOT_CALIBRATED' };
  const timeAxis = { readable: false, spanSeconds: null, reasonCode: 'DETERMINISTIC_OCR_NOT_CALIBRATED' };

  const gate = decideDeterministicScreenGate({
    metrics,
    configuredTimeframe: 'M1',
    parsedTimeframe: null,
    configuredAsset,
    parsedAsset: null,
    priceAxisReadable: false,
    timeAxisReadable: false,
  });

  return {
    safeForAi: gate.safeForAi,
    reasonCode: gate.reasonCode,
    reasons: gate.reasons,
    layoutFound: !gate.reasons.includes('LAYOUT_NOT_FOUND'),
    metrics,
    crops: (Object.keys(PROFILE.regions) as CropRole[]).map((role) => cropImage(image, role, rects[role])),
    missingCrops: [{ role: 'timeframeLabel', reasonCode: 'TIMEFRAME_LABEL_NOT_VISIBLE_IN_CALIBRATION' }],
    timeframe,
    asset,
    priceAxis,
    timeAxis,
    newestCandleVisible: !gate.reasons.includes('NEWEST_CANDLE_NOT_VISIBLE'),
    currentPriceMarkerPresent: !gate.reasons.includes('CURRENT_PRICE_MARKER_MISSING'),
    letterboxDetected: gate.reasons.includes('LETTERBOX_DETECTED'),
  };
}

export function createDeterministicNeutralSignal(result: DeterministicScreenResult): TradeSignal {
  const reason = result.reasonCode || 'LAYOUT_NOT_FOUND';
  return {
    pair: 'Unknown Asset',
    bias: 'NEUTRAL',
    proposedBias: 'NEUTRAL',
    confidence: 0,
    pattern: `Deterministic input reject: ${reason}`,
    entry: 'No directional output. Deterministic input verification failed before the AI call.',
    chartQuality: 'poor',
    timeframe: 'unknown',
    trend: 'unclear',
    momentum: 'unclear',
    structure: 'unclear',
    candleSignal: 'none',
    supportResistance: 'Not evaluated because deterministic input verification failed.',
    evidence: [],
    contextAlignment: 'not_provided',
    contextNotes: 'No AI call was made.',
    warnings: result.reasons,
    confirmationScore: 0,
    confirmationCount: 0,
    opposingConfirmations: 0,
    inputQualityScore: 0,
    inputQualityStatus: 'block',
    contextImagesUsed: 0,
    gateReason: `${reason}: deterministic screen verification failed. AI was not called.`,
  };
}
