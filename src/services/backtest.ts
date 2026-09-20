import type { TradeBias, TradeSignal } from '../signalLogic';

export type BacktestMarket = 'FOREX' | 'OTC';
export type BacktestOutcome = 'WIN' | 'LOSS' | 'TIE' | 'NEUTRAL';
export type ActualDirection = 'UP' | 'DOWN' | 'TIE';
export type TimeframeStatus = 'm1' | 'unknown' | 'not_m1';

export interface BacktestCandle {
  timestamp: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ParsedBacktestData {
  candles: BacktestCandle[];
  sourceRows: number;
  rejectedRows: number;
  timeframeStatus: TimeframeStatus;
  medianIntervalSeconds: number | null;
  hasRealTimestamps: boolean;
}

export interface BacktestRow {
  index: number;
  timestamp: number;
  timeLabel: string;
  pair: string;
  market: BacktestMarket;
  bias: TradeBias;
  proposedBias: TradeBias;
  confidence: number;
  confirmationCount: number;
  confirmationScore: number;
  opposingConfirmations: number;
  chartQuality: TradeSignal['chartQuality'];
  inputQualityScore: number;
  inputQualityStatus: TradeSignal['inputQualityStatus'];
  warningCount: number;
  warnings: string[];
  trend: TradeSignal['trend'];
  momentum: TradeSignal['momentum'];
  structure: TradeSignal['structure'];
  candleSignal: TradeSignal['candleSignal'];
  pattern: string;
  gateReason: string;
  decisionClose: number;
  expiryClose: number;
  actualDirection: ActualDirection;
  outcome: BacktestOutcome;
  responseTimeMs: number;
}

export interface BacktestBucket {
  label: string;
  signals: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number | null;
}

export interface BacktestSummary {
  analyzed: number;
  directional: number;
  neutral: number;
  wins: number;
  losses: number;
  ties: number;
  coverage: number;
  winRate: number | null;
  confirm3: BacktestBucket;
  confirm4: BacktestBucket;
  confidenceBuckets: BacktestBucket[];
}

export const COMMON_QUOTEX_FOREX_PAIRS = [
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'AUD/USD',
  'USD/CAD',
  'USD/CHF',
  'EUR/GBP',
  'EUR/JPY',
  'GBP/JPY',
  'AUD/JPY',
  'NZD/USD',
  'EUR/AUD',
  'EUR/CAD',
  'GBP/AUD',
  'GBP/CAD',
  'GBP/CHF',
  'CAD/JPY',
  'CHF/JPY',
  'NZD/JPY',
] as const;

const CHART_WIDTH = 1100;
const CHART_HEIGHT = 620;
export const BACKTEST_WINDOW_CANDLES = 60;
export const BACKTEST_REQUEST_DELAY_MS = 2200;

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function detectDelimiter(header: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = header.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function findHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header));
}

function parseNumber(value: string | undefined): number {
  if (!value) return Number.NaN;
  const normalized = value.trim().replace(/\s/g, '').replace(/_/g, '');
  return Number(normalized);
}

function parseTimestamp(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return numeric * 1000;
  }

  const parsed = Date.parse(trimmed.replace(/\./g, '-'));
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function parseBacktestCsv(text: string): ParsedBacktestData {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) throw new Error('CSV is too short. Include a header and at least 61 M1 candles.');

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = splitCsvLine(lines[0], delimiter);
  const headers = rawHeaders.map(normalizeHeader);

  const openIndex = findHeader(headers, ['open', 'o']);
  const highIndex = findHeader(headers, ['high', 'h']);
  const lowIndex = findHeader(headers, ['low', 'l']);
  const closeIndex = findHeader(headers, ['close', 'c', 'priceclose']);

  if ([openIndex, highIndex, lowIndex, closeIndex].some((index) => index < 0)) {
    throw new Error('CSV must contain Open, High, Low, and Close columns.');
  }

  const timestampIndex = findHeader(headers, ['timestamp', 'datetime', 'dateandtime', 'timeunix', 'unixtime']);
  const dateIndex = findHeader(headers, ['date', 'day']);
  const timeIndex = findHeader(headers, ['time', 'hour']);
  const hasTimeColumn = timestampIndex >= 0 || dateIndex >= 0 || timeIndex >= 0;

  const candles: BacktestCandle[] = [];
  let rejectedRows = 0;
  let realTimestampCount = 0;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = splitCsvLine(lines[lineIndex], delimiter);
    const open = parseNumber(cells[openIndex]);
    const high = parseNumber(cells[highIndex]);
    const low = parseNumber(cells[lowIndex]);
    const close = parseNumber(cells[closeIndex]);

    if (![open, high, low, close].every(Number.isFinite) || high < low) {
      rejectedRows += 1;
      continue;
    }

    let rawTime = '';
    if (timestampIndex >= 0) rawTime = cells[timestampIndex] || '';
    else if (dateIndex >= 0 && timeIndex >= 0) rawTime = `${cells[dateIndex] || ''} ${cells[timeIndex] || ''}`.trim();
    else if (dateIndex >= 0) rawTime = cells[dateIndex] || '';
    else if (timeIndex >= 0) rawTime = cells[timeIndex] || '';

    const parsedTime = rawTime ? parseTimestamp(rawTime) : null;
    if (parsedTime !== null) realTimestampCount += 1;
    const timestamp = parsedTime ?? ((candles.length + 1) * 60_000);

    candles.push({
      timestamp,
      timeLabel: rawTime || `Row ${lineIndex}`,
      open,
      high,
      low,
      close,
    });
  }

  if (candles.length < BACKTEST_WINDOW_CANDLES + 2) {
    throw new Error(`Need at least ${BACKTEST_WINDOW_CANDLES + 2} valid candles. Parsed only ${candles.length}.`);
  }

  const hasRealTimestamps = hasTimeColumn && realTimestampCount >= Math.floor(candles.length * 0.9);
  if (hasRealTimestamps) candles.sort((a, b) => a.timestamp - b.timestamp);

  const intervals: number[] = [];
  if (hasRealTimestamps) {
    for (let index = 1; index < candles.length; index += 1) {
      const seconds = (candles[index].timestamp - candles[index - 1].timestamp) / 1000;
      if (seconds > 0 && seconds < 3600) intervals.push(seconds);
    }
  }

  const medianIntervalSeconds = median(intervals);
  const timeframeStatus: TimeframeStatus = !hasRealTimestamps || medianIntervalSeconds === null
    ? 'unknown'
    : medianIntervalSeconds >= 45 && medianIntervalSeconds <= 75
      ? 'm1'
      : 'not_m1';

  return {
    candles,
    sourceRows: lines.length - 1,
    rejectedRows,
    timeframeStatus,
    medianIntervalSeconds: medianIntervalSeconds === null ? null : Number(medianIntervalSeconds.toFixed(1)),
    hasRealTimestamps,
  };
}

export function buildBacktestIndexes(
  candleCount: number,
  requestedSamples: number,
  windowSize = BACKTEST_WINDOW_CANDLES,
): number[] {
  const first = windowSize - 1;
  const last = candleCount - 2;
  if (last < first) return [];

  const eligible = last - first + 1;
  const target = Math.max(1, Math.min(Math.floor(requestedSamples), eligible));
  if (target >= eligible) return Array.from({ length: eligible }, (_, index) => first + index);

  const indexes = new Set<number>();
  const step = eligible / target;
  for (let sample = 0; sample < target; sample += 1) {
    const index = first + Math.min(eligible - 1, Math.floor((sample + 0.5) * step));
    indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

function priceDecimals(candles: BacktestCandle[]): number {
  const max = Math.max(...candles.map((candle) => candle.high));
  const min = Math.min(...candles.map((candle) => candle.low));
  const span = Math.abs(max - min);
  if (span < 0.01) return 5;
  if (span < 1) return 4;
  if (span < 100) return 3;
  return 2;
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function renderBacktestChart(
  candles: BacktestCandle[],
  pair: string,
  decisionLabel: string,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = CHART_WIDTH;
  canvas.height = CHART_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Browser chart rendering is unavailable.');

  context.fillStyle = '#090d16';
  context.fillRect(0, 0, CHART_WIDTH, CHART_HEIGHT);

  const left = 58;
  const right = 78;
  const top = 62;
  const bottom = 42;
  const plotWidth = CHART_WIDTH - left - right;
  const plotHeight = CHART_HEIGHT - top - bottom;

  context.fillStyle = '#111827';
  context.fillRect(left, top, plotWidth, plotHeight);

  const rawMin = Math.min(...candles.map((candle) => candle.low));
  const rawMax = Math.max(...candles.map((candle) => candle.high));
  const rawSpan = Math.max(rawMax - rawMin, Math.abs(rawMax) * 0.0001, 0.00001);
  const minPrice = rawMin - rawSpan * 0.08;
  const maxPrice = rawMax + rawSpan * 0.08;
  const priceSpan = maxPrice - minPrice;
  const decimals = priceDecimals(candles);

  const yFor = (price: number) => top + ((maxPrice - price) / priceSpan) * plotHeight;

  context.strokeStyle = '#263244';
  context.lineWidth = 1;
  context.fillStyle = '#7c8aa0';
  context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';

  for (let row = 0; row <= 5; row += 1) {
    const y = top + (plotHeight * row) / 5;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(left + plotWidth, y);
    context.stroke();
    const price = maxPrice - (priceSpan * row) / 5;
    context.fillText(price.toFixed(decimals), left + plotWidth + 8, y + 4);
  }

  for (let column = 0; column <= 6; column += 1) {
    const x = left + (plotWidth * column) / 6;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, top + plotHeight);
    context.stroke();
  }

  const slot = plotWidth / candles.length;
  const bodyWidth = Math.max(3, Math.min(10, slot * 0.62));

  candles.forEach((candle, index) => {
    const x = left + slot * index + slot / 2;
    const openY = yFor(candle.open);
    const closeY = yFor(candle.close);
    const highY = yFor(candle.high);
    const lowY = yFor(candle.low);
    const bullish = candle.close >= candle.open;
    const color = bullish ? '#22c55e' : '#ef4444';

    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 1.3;
    context.beginPath();
    context.moveTo(x, highY);
    context.lineTo(x, lowY);
    context.stroke();

    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(2, Math.abs(closeY - openY));
    context.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  });

  context.fillStyle = '#f8fafc';
  context.font = '700 22px system-ui, sans-serif';
  context.fillText(`${pair}  •  M1`, left, 30);

  context.fillStyle = '#94a3b8';
  context.font = '12px system-ui, sans-serif';
  context.fillText('Historical replay • 1-minute candles • decision at right edge', left, 50);
  context.textAlign = 'right';
  context.fillText(decisionLabel, CHART_WIDTH - right, 30);
  context.textAlign = 'left';

  const labelIndexes = [0, Math.floor(candles.length / 3), Math.floor((candles.length * 2) / 3), candles.length - 1];
  context.fillStyle = '#64748b';
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  labelIndexes.forEach((index) => {
    const candle = candles[index];
    const x = left + slot * index + slot / 2;
    context.textAlign = index === 0 ? 'left' : index === candles.length - 1 ? 'right' : 'center';
    context.fillText(formatClock(candle.timestamp) || candle.timeLabel.slice(-8), x, CHART_HEIGHT - 16);
  });
  context.textAlign = 'left';

  return canvas.toDataURL('image/jpeg', 0.94);
}

export function createBacktestRow(args: {
  index: number;
  pair: string;
  market: BacktestMarket;
  decision: BacktestCandle;
  expiry: BacktestCandle;
  signal: TradeSignal;
  responseTimeMs: number;
}): BacktestRow {
  const actualDirection: ActualDirection = args.expiry.close > args.decision.close
    ? 'UP'
    : args.expiry.close < args.decision.close
      ? 'DOWN'
      : 'TIE';

  let outcome: BacktestOutcome = 'NEUTRAL';
  if (args.signal.bias !== 'NEUTRAL') {
    if (actualDirection === 'TIE') outcome = 'TIE';
    else if (
      (args.signal.bias === 'CALL' && actualDirection === 'UP')
      || (args.signal.bias === 'PUT' && actualDirection === 'DOWN')
    ) outcome = 'WIN';
    else outcome = 'LOSS';
  }

  return {
    index: args.index,
    timestamp: args.decision.timestamp,
    timeLabel: args.decision.timeLabel,
    pair: args.pair,
    market: args.market,
    bias: args.signal.bias,
    proposedBias: args.signal.proposedBias,
    confidence: args.signal.confidence,
    confirmationCount: args.signal.confirmationCount,
    confirmationScore: args.signal.confirmationScore,
    opposingConfirmations: args.signal.opposingConfirmations,
    chartQuality: args.signal.chartQuality,
    inputQualityScore: args.signal.inputQualityScore,
    inputQualityStatus: args.signal.inputQualityStatus,
    warningCount: args.signal.warnings.length,
    warnings: [...args.signal.warnings],
    trend: args.signal.trend,
    momentum: args.signal.momentum,
    structure: args.signal.structure,
    candleSignal: args.signal.candleSignal,
    pattern: args.signal.pattern,
    gateReason: args.signal.gateReason || '',
    decisionClose: args.decision.close,
    expiryClose: args.expiry.close,
    actualDirection,
    outcome,
    responseTimeMs: args.responseTimeMs,
  };
}

function bucket(label: string, rows: BacktestRow[]): BacktestBucket {
  const directional = rows.filter((row) => row.bias !== 'NEUTRAL');
  const wins = directional.filter((row) => row.outcome === 'WIN').length;
  const losses = directional.filter((row) => row.outcome === 'LOSS').length;
  const ties = directional.filter((row) => row.outcome === 'TIE').length;
  return {
    label,
    signals: directional.length,
    wins,
    losses,
    ties,
    winRate: wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : null,
  };
}

export function summarizeBacktest(rows: BacktestRow[]): BacktestSummary {
  const directional = rows.filter((row) => row.bias !== 'NEUTRAL');
  const wins = directional.filter((row) => row.outcome === 'WIN').length;
  const losses = directional.filter((row) => row.outcome === 'LOSS').length;
  const ties = directional.filter((row) => row.outcome === 'TIE').length;
  const neutral = rows.length - directional.length;

  const confidenceRanges: Array<[string, number, number]> = [
    ['50–59', 50, 59],
    ['60–69', 60, 69],
    ['70–79', 70, 79],
    ['80–89', 80, 89],
    ['90–100', 90, 100],
  ];

  return {
    analyzed: rows.length,
    directional: directional.length,
    neutral,
    wins,
    losses,
    ties,
    coverage: rows.length > 0 ? Number(((directional.length / rows.length) * 100).toFixed(1)) : 0,
    winRate: wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : null,
    confirm3: bucket('3/4 confirmations', rows.filter((row) => row.confirmationCount === 3)),
    confirm4: bucket('4/4 confirmations', rows.filter((row) => row.confirmationCount === 4)),
    confidenceBuckets: confidenceRanges.map(([label, min, max]) => bucket(
      label,
      rows.filter((row) => row.confidence >= min && row.confidence <= max),
    )),
  };
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportBacktestJson(rows: BacktestRow[], summary: BacktestSummary): void {
  download(
    `quotex-m1-backtest-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), summary, rows }, null, 2),
    'application/json;charset=utf-8',
  );
}

export function exportBacktestCsv(rows: BacktestRow[]): void {
  const headers = [
    'timeLabel', 'pair', 'market', 'bias', 'proposedBias', 'confidence', 'confirmationCount',
    'opposingConfirmations', 'chartQuality', 'inputQualityScore', 'inputQualityStatus', 'warningCount',
    'trend', 'momentum', 'structure', 'candleSignal', 'pattern', 'decisionClose', 'expiryClose',
    'actualDirection', 'outcome', 'gateReason', 'responseTimeMs',
  ];
  const csv = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((key) => csvCell(row[key as keyof BacktestRow])).join(',')),
  ].join('\n');

  download(
    `quotex-m1-backtest-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
    'text/csv;charset=utf-8',
  );
}

export const delay = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});
