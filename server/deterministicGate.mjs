import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

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
    timeframeBadge: { x: 0.07472826, y: 0.88922156, w: 0.03668478, h: 0.08682635 },
    chartTypeToolbar: { x: 0.045, y: 0.70, w: 0.10, h: 0.295 },
    platformClock: { x: 0.06, y: 0.14, w: 0.20, h: 0.065 },
    tradePanel: { x: 0.88722826, y: 0.05389222, w: 0.11277174, h: 0.94610778 },
    payoutExpiryPanel: { x: 0.88722826, y: 0.05389222, w: 0.11277174, h: 0.43413174 },
  },
  minCandles: 12,
  maxCandles: 80,
  minCandleColorRatio: 0.015,
  minRightGreen: 0.015,
  minRightRed: 0.015,
  minPriceBlue: 0.005,
  minMarkerRow: 0.15,
  maxNearBlackEdge: 0.35,
};

const OCR_MIN_CONFIDENCE = 70;
const TIMEFRAME_TEMPLATE_THRESHOLD = 0.985;
const TIMEFRAME_SCALES = [0.75, 0.9, 1, 1.1, 1.25, 1.5];
const TIMEFRAME_CANONICAL = { width: 27, height: 29 };
const TIMEFRAME_MIN_INTERVALS = 3;
const MINUTES_PER_CANDLE_TOLERANCE = 0.08;
const CHARTTYPE_THRESHOLD = 0.92;
const PRICE_AXIS_MIN_LABELS = 5;
const PRICE_AXIS_R2_MIN = 0.995;
const PRICE_AXIS_PIXEL_SPACING_CV_MAX = 0.25;
const PRICE_AXIS_STEP_CV_MAX = 0.10;
const CLOCK_STALE_TOLERANCE_SECONDS = 5;
const VALIDATION_COVERAGE_COMPLETE = false;

let previousClockObservation = null;

function toPixelRect(relative, width, height) {
  const x = Math.max(0, Math.round(relative.x * width));
  const y = Math.max(0, Math.round(relative.y * height));
  const right = Math.min(width, Math.round((relative.x + relative.w) * width));
  const bottom = Math.min(height, Math.round((relative.y + relative.h) * height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function channelRatios(raw, width, height, channels) {
  let green = 0;
  let red = 0;
  let blue = 0;
  const total = Math.max(1, width * height);
  for (let p = 0; p < total; p += 1) {
    const i = p * channels;
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    if (g > 90 && g > r * 1.25 && g > b * 1.15) green += 1;
    if (r > 100 && r > g * 1.15 && r > b * 1.15) red += 1;
    if (b > 120 && g > 70 && b > r * 1.25 && b > g * 1.05) blue += 1;
  }
  return { green: green / total, red: red / total, blue: blue / total };
}

function horizontalMarkerRatio(raw, width, height, channels) {
  let best = 0;
  for (let y = 0; y < height; y += 1) {
    let matches = 0;
    for (let x = 0; x < width; x += 1) {
      const i = ((y * width) + x) * channels;
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const mean = (r + g + b) / 3;
      if (max - min < 18 && mean > 65) matches += 1;
    }
    best = Math.max(best, matches / Math.max(1, width));
  }
  return best;
}

function outerNearBlackRatio(raw, width, height, channels) {
  const bandX = Math.max(1, Math.round(width * 0.02));
  const bandY = Math.max(1, Math.round(height * 0.02));
  let total = 0;
  let black = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!(x < bandX || x >= width - bandX || y < bandY || y >= height - bandY)) continue;
      const i = ((y * width) + x) * channels;
      const lum = raw[i] * 0.2126 + raw[i + 1] * 0.7152 + raw[i + 2] * 0.0722;
      total += 1;
      if (lum < 6) black += 1;
    }
  }
  return black / Math.max(1, total);
}

function candleColumnGroups(raw, width, height, channels) {
  const minimumPixelsPerColumn = Math.max(5, Math.round(height * 0.015));
  const active = new Array(width).fill(false);
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      const i = ((y * width) + x) * channels;
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];
      const isGreen = g > 90 && g > r * 1.25 && g > b * 1.15;
      const isRed = r > 100 && r > g * 1.15 && r > b * 1.15;
      if (isGreen || isRed) count += 1;
    }
    active[x] = count >= minimumPixelsPerColumn;
  }
  const ignoreLeft = Math.round(width * 0.05);
  for (let x = 0; x < ignoreLeft; x += 1) active[x] = false;
  const minimumRun = Math.max(3, Math.round(width * 0.005));
  const groups = [];
  let start = null;
  for (let x = 0; x <= width; x += 1) {
    const on = x < width ? active[x] : false;
    if (on && start === null) start = x;
    if (!on && start !== null) {
      if (x - start >= minimumRun) groups.push({ start, end: x });
      start = null;
    }
  }
  const centers = groups.map((group) => (group.start + group.end) / 2);
  const diffs = centers.slice(1).map((center, index) => center - centers[index]).filter((value) => value > 1);
  const roughPitch = median(diffs);
  const stable = roughPitch === null ? [] : diffs.filter((value) => value >= roughPitch * 0.65 && value <= roughPitch * 1.35);
  const pitchPx = median(stable.length ? stable : diffs);
  const last = groups.length ? groups[groups.length - 1] : null;
  return {
    count: groups.length,
    centers,
    pitchPx,
    lastXFraction: last ? ((last.start + last.end) / 2) / width : null,
  };
}

async function rawImage(imageBytes, rect = null, resize = null, nearest = false) {
  let pipeline = sharp(imageBytes).removeAlpha().toColourspace('srgb');
  if (rect) pipeline = pipeline.extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });
  if (resize) pipeline = pipeline.resize(resize.width, resize.height, { kernel: nearest ? sharp.kernel.nearest : sharp.kernel.cubic });
  return pipeline.raw().toBuffer({ resolveWithObject: true });
}

async function cropPng(imageBytes, rect, upscale = 3) {
  let pipeline = sharp(imageBytes).extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });
  if (upscale !== 1) {
    pipeline = pipeline.resize(rect.width * upscale, rect.height * upscale, { kernel: sharp.kernel.nearest });
  }
  return pipeline.png().toBuffer();
}

function parseTimeText(text) {
  const trimmed = String(text || '').trim();
  let hour;
  let minute;
  let second = 0;
  const colon = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
    second = colon[3] ? Number(colon[3]) : 0;
  } else if (/^\d{4}$/.test(trimmed)) {
    hour = Number(trimmed.slice(0, 2));
    minute = Number(trimmed.slice(2, 4));
  } else if (/^\d{6}$/.test(trimmed)) {
    hour = Number(trimmed.slice(0, 2));
    minute = Number(trimmed.slice(2, 4));
    second = Number(trimmed.slice(4, 6));
  } else {
    return null;
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return hour * 3600 + minute * 60 + second;
}

function adjacentTimeDiffSeconds(a, b) {
  let diff = b - a;
  if (diff <= 0) diff += 24 * 3600;
  return diff;
}

function deriveMinutesPerCandle(labels, candlePitchPx) {
  if (!candlePitchPx || candlePitchPx <= 0 || labels.length < TIMEFRAME_MIN_INTERVALS + 1) {
    return { intervalCount: 0, medianTickSeconds: null, minutesPerCandle: null };
  }
  const tickSeconds = [];
  const estimates = [];
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

function normalizeAsset(value) {
  const upper = String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const match = upper.match(/([A-Z]{3})\s*\/\s*([A-Z]{3})(?:\s*\(\s*OTC\s*\))?/);
  if (!match) return null;
  const otc = /\(\s*OTC\s*\)/.test(upper);
  return match[1] + '/' + match[2] + (otc ? ' (OTC)' : '');
}

function coefficientOfVariation(values) {
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function linearFitR2(points) {
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
  const intercept = meanV - slope * meanY;
  let ssRes = 0;
  let ssTot = 0;
  for (const point of points) {
    const predicted = intercept + slope * point.y;
    ssRes += (point.value - predicted) ** 2;
    ssTot += (point.value - meanV) ** 2;
  }
  if (ssTot === 0) return null;
  return 1 - ssRes / ssTot;
}

function normalizedCorrelation(candidate, candidateWidth, x0, y0, template, templateWidth, templateHeight) {
  const n = templateWidth * templateHeight;
  if (n <= 1) return -1;
  let meanA = 0;
  let meanB = 0;
  for (let y = 0; y < templateHeight; y += 1) {
    for (let x = 0; x < templateWidth; x += 1) {
      meanA += candidate[((y0 + y) * candidateWidth) + x0 + x];
      meanB += template[y * templateWidth + x];
    }
  }
  meanA /= n;
  meanB /= n;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let y = 0; y < templateHeight; y += 1) {
    for (let x = 0; x < templateWidth; x += 1) {
      const a = candidate[((y0 + y) * candidateWidth) + x0 + x] - meanA;
      const b = template[y * templateWidth + x] - meanB;
      numerator += a * b;
      denomA += a * a;
      denomB += b * b;
    }
  }
  const denominator = Math.sqrt(denomA * denomB);
  return denominator > 0 ? numerator / denominator : -1;
}

async function grayBufferFromBytes(bytes, width, height, nearest = false) {
  const result = await sharp(bytes)
    .resize(width, height, { kernel: nearest ? sharp.kernel.nearest : sharp.kernel.cubic })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Float32Array(result.data);
}

async function timeframeBadgeMatch(imageBytes, rect, templatesDir) {
  const candidateCrop = await cropPng(imageBytes, rect, 1);
  const candidate = await grayBufferFromBytes(candidateCrop, rect.width, rect.height, true);
  let templateBytes;
  try {
    templateBytes = await fs.readFile(path.join(templatesDir, 'quotex-1m-v1.png'));
  } catch {
    return { score: null, passed: false, bestScale: null, bestX: null, bestY: null };
  }
  let best = -1;
  let bestScale = null;
  let bestX = null;
  let bestY = null;
  for (const scale of TIMEFRAME_SCALES) {
    const width = Math.max(1, Math.round(TIMEFRAME_CANONICAL.width * scale));
    const height = Math.max(1, Math.round(TIMEFRAME_CANONICAL.height * scale));
    if (width > rect.width || height > rect.height) continue;
    const template = await grayBufferFromBytes(templateBytes, width, height, scale === 1);
    for (let y = 0; y <= rect.height - height; y += 1) {
      for (let x = 0; x <= rect.width - width; x += 1) {
        const score = normalizedCorrelation(candidate, rect.width, x, y, template, width, height);
        if (score > best) {
          best = score;
          bestScale = scale;
          bestX = x;
          bestY = y;
        }
      }
    }
  }
  const score = bestScale === null ? null : Number(best.toFixed(4));
  return { score, passed: score !== null && score >= TIMEFRAME_TEMPLATE_THRESHOLD, bestScale, bestX, bestY };
}

async function bestTemplateScore(imageBytes, rect, templatePath) {
  let template;
  try {
    template = await fs.readFile(templatePath);
  } catch {
    return null;
  }
  const candidateCrop = await cropPng(imageBytes, rect, 3);
  const meta = await sharp(candidateCrop).metadata();
  const candidateWidth = 72;
  const candidateHeight = Math.max(80, Math.round(candidateWidth * ((meta.height || 1) / Math.max(1, meta.width || 1))));
  const candidate = await grayBufferFromBytes(candidateCrop, candidateWidth, candidateHeight, false);
  let best = -1;
  for (const size of [14, 16, 18, 20, 22]) {
    const templateGray = await grayBufferFromBytes(template, size, size, false);
    for (let y = 0; y <= candidateHeight - size; y += 2) {
      for (let x = 0; x <= candidateWidth - size; x += 2) {
        best = Math.max(best, normalizedCorrelation(candidate, candidateWidth, x, y, templateGray, size, size));
      }
    }
  }
  return Number(best.toFixed(4));
}

async function verifyChartType(imageBytes, rect, templatesDir) {
  const candleScore = await bestTemplateScore(imageBytes, rect, path.join(templatesDir, 'quotex-candlestick-v1.png'));
  if (candleScore !== null && candleScore >= CHARTTYPE_THRESHOLD) {
    return { verified: true, mismatch: false, detected: 'candlestick', candlestickScore: candleScore, reasonCode: null };
  }
  for (const type of ['line', 'bars', 'heikin-ashi']) {
    const score = await bestTemplateScore(imageBytes, rect, path.join(templatesDir, 'quotex-' + type + '-v1.png'));
    if (score !== null && score >= CHARTTYPE_THRESHOLD) {
      return { verified: false, mismatch: true, detected: type.replace('-', '_'), candlestickScore: candleScore, mismatchScore: score, reasonCode: 'CHARTTYPE_MISMATCH' };
    }
  }
  return { verified: false, mismatch: false, detected: 'unknown', candlestickScore: candleScore, reasonCode: 'CHARTTYPE_UNVERIFIED' };
}

function parseClockCandidate(ocr) {
  const utc = ocr.tokens.find((token) => /^UTC$/i.test(String(token.text).trim()) && token.confidence >= OCR_MIN_CONFIDENCE);
  if (!utc) return null;
  const candidates = [];
  for (const token of ocr.tokens) {
    if (token.confidence < OCR_MIN_CONFIDENCE) continue;
    const raw = String(token.text).trim();
    let hour;
    let minute;
    let second;
    const colon = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (colon) {
      hour = Number(colon[1]); minute = Number(colon[2]); second = Number(colon[3]);
    } else if (/^\d{6}$/.test(raw)) {
      hour = Number(raw.slice(0, 2)); minute = Number(raw.slice(2, 4)); second = Number(raw.slice(4, 6));
    } else {
      continue;
    }
    if (hour > 23 || minute > 59 || second > 59) continue;
    candidates.push({
      seconds: hour * 3600 + minute * 60 + second,
      confidence: Math.min(token.confidence, utc.confidence),
      text: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':' + String(second).padStart(2, '0') + ' UTC',
    });
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function circularSecondsDifference(a, b) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 24 * 3600 - raw);
}

async function verifyClock(imageBytes, rect, runOcr) {
  const png = await cropPng(imageBytes, rect, 3);
  const ocr = await runOcr(png, 'clock');
  const parsed = parseClockCandidate(ocr);
  if (!parsed) return { reasonCode: 'CLOCK_UNREADABLE', rawText: ocr.rawText || null, stale: false, frozen: false };
  const now = new Date();
  const serverSeconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const delta = circularSecondsDifference(parsed.seconds, serverSeconds);
  const observedMs = Date.now();
  const frozen = Boolean(previousClockObservation && previousClockObservation.seconds === parsed.seconds && observedMs - previousClockObservation.observedMs > 1500);
  previousClockObservation = { seconds: parsed.seconds, observedMs };
  const stale = delta > CLOCK_STALE_TOLERANCE_SECONDS;
  return {
    reasonCode: frozen ? 'CLOCK_FROZEN' : stale ? 'CLOCK_STALE' : null,
    rawText: ocr.rawText || null,
    parsedText: parsed.text,
    serverDeltaSeconds: Number(delta.toFixed(2)),
    stale,
    frozen,
    secondsIntoCandle: parsed.seconds % 60,
    confidence: Number(parsed.confidence.toFixed(2)),
  };
}

function blueOcclusionBand(raw, width, height, channels) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let blue = 0;
    for (let x = 0; x < width; x += 1) {
      const i = ((y * width) + x) * channels;
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];
      if (b > 120 && g > 70 && b > r * 1.2 && b > g * 1.03) blue += 1;
    }
    if (blue / Math.max(1, width) >= 0.08) rows.push(y);
  }
  if (!rows.length) return null;
  return { top: Math.max(0, Math.min(...rows) - 3), bottom: Math.min(height - 1, Math.max(...rows) + 3) };
}

async function verifyPriceAxis(imageBytes, rect, runOcr) {
  const png = await cropPng(imageBytes, rect, 3);
  const raw = await rawImage(png);
  const band = blueOcclusionBand(raw.data, raw.info.width, raw.info.height, raw.info.channels);
  const ocr = await runOcr(png, 'price_axis');
  const labels = [];
  const rejected = [];
  for (const token of ocr.tokens) {
    const text = String(token.text).trim();
    if (!/^\d+\.\d{3,6}$/.test(text)) {
      if (text) rejected.push({ text, confidence: token.confidence, reason: 'NON_PRICE_TOKEN' });
      continue;
    }
    if (token.confidence < OCR_MIN_CONFIDENCE) {
      rejected.push({ text, confidence: token.confidence, reason: 'LOW_OCR_CONFIDENCE' });
      continue;
    }
    const centerY = token.top + token.height / 2;
    if (band && centerY >= band.top && centerY <= band.bottom) {
      rejected.push({ text, confidence: token.confidence, reason: 'OCCLUDED_BY_CURRENT_PRICE_TAG' });
      continue;
    }
    const value = Number(text);
    if (!Number.isFinite(value)) continue;
    labels.push({ text, value, y: centerY, confidence: token.confidence });
  }
  labels.sort((a, b) => a.y - b.y);
  const unique = [];
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
  const linear = unique.length >= PRICE_AXIS_MIN_LABELS
    && monotonic
    && r2 !== null && r2 >= PRICE_AXIS_R2_MIN
    && pixelSpacingCv !== null && pixelSpacingCv <= PRICE_AXIS_PIXEL_SPACING_CV_MAX
    && priceStepCv !== null && priceStepCv <= PRICE_AXIS_STEP_CV_MAX;
  return {
    readable: linear,
    rawText: ocr.rawText || null,
    labels: unique,
    rejected,
    r2: r2 === null ? null : Number(r2.toFixed(6)),
    pixelSpacingCv: pixelSpacingCv === null ? null : Number(pixelSpacingCv.toFixed(4)),
    priceStepCv: priceStepCv === null ? null : Number(priceStepCv.toFixed(4)),
    occlusionBand: band,
    reasonCode: unique.length < PRICE_AXIS_MIN_LABELS ? 'PRICE_AXIS_UNREADABLE' : linear ? null : 'PRICE_AXIS_NONLINEAR',
  };
}

async function serverPreflight(imageBytes, width, height) {
  const sampleWidth = Math.min(width, 320);
  const sampleHeight = Math.max(1, Math.round(height * (sampleWidth / width)));
  const sampled = await rawImage(imageBytes, null, { width: sampleWidth, height: sampleHeight });
  const raw = sampled.data;
  const channels = sampled.info.channels;
  const count = sampleWidth * sampleHeight;
  const luminance = new Float32Array(count);
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let p = 0; p < count; p += 1) {
    const i = p * channels;
    const value = raw[i] * 0.2126 + raw[i + 1] * 0.7152 + raw[i + 2] * 0.0722;
    luminance[p] = value;
    sum += value;
    if (value < 12) dark += 1;
    if (value > 245) bright += 1;
  }
  const brightness = sum / Math.max(count, 1);
  let variance = 0;
  let edges = 0;
  let edgePairs = 0;
  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const index = y * sampleWidth + x;
      const delta = luminance[index] - brightness;
      variance += delta * delta;
      if (x + 1 < sampleWidth) {
        edgePairs += 1;
        if (Math.abs(luminance[index] - luminance[index + 1]) > 20) edges += 1;
      }
      if (y + 1 < sampleHeight) {
        edgePairs += 1;
        if (Math.abs(luminance[index] - luminance[index + sampleWidth]) > 20) edges += 1;
      }
    }
  }
  const contrast = Math.sqrt(variance / Math.max(count, 1));
  const edgeDensity = edges / Math.max(edgePairs, 1);
  const darkRatio = dark / Math.max(count, 1);
  const brightRatio = bright / Math.max(count, 1);
  const severe = width < 420 || height < 240 || contrast < 7 || (edgeDensity < 0.006 && contrast < 12) || darkRatio > 0.96 || brightRatio > 0.96;
  return { status: severe ? 'block' : 'pass_or_warn', brightness, contrast, edgeDensity, darkRatio, brightRatio };
}

export async function verifyNativeFrame(args) {
  const { imageBytes, configuredAsset, runOcr, templatesDir } = args;
  const meta = await sharp(imageBytes).metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!width || !height) {
    return { eligibleForModel: false, blockReason: 'INVALID_NATIVE_FRAME', reasons: ['INVALID_NATIVE_FRAME'] };
  }

  const rects = Object.fromEntries(Object.entries(PROFILE.regions).map(([role, relative]) => [role, toPixelRect(relative, width, height)]));
  const [full, plot, right, price] = await Promise.all([
    rawImage(imageBytes),
    rawImage(imageBytes, rects.plotArea),
    rawImage(imageBytes, rects.tradePanel),
    rawImage(imageBytes, rects.priceAxis),
  ]);
  const plotColors = channelRatios(plot.data, plot.info.width, plot.info.height, plot.info.channels);
  const rightColors = channelRatios(right.data, right.info.width, right.info.height, right.info.channels);
  const priceColors = channelRatios(price.data, price.info.width, price.info.height, price.info.channels);
  const candleGroups = candleColumnGroups(plot.data, plot.info.width, plot.info.height, plot.info.channels);
  const metrics = {
    width,
    height,
    aspectRatio: Number((width / Math.max(1, height)).toFixed(4)),
    plotCombinedCandleColorRatio: Number((plotColors.green + plotColors.red).toFixed(4)),
    rightPanelGreenRatio: Number(rightColors.green.toFixed(4)),
    rightPanelRedRatio: Number(rightColors.red.toFixed(4)),
    currentPriceBlueRatio: Number(priceColors.blue.toFixed(4)),
    horizontalMarkerRowRatio: Number(horizontalMarkerRatio(plot.data, plot.info.width, plot.info.height, plot.info.channels).toFixed(4)),
    outerNearBlackRatio: Number(outerNearBlackRatio(full.data, full.info.width, full.info.height, full.info.channels).toFixed(4)),
    candleCount: candleGroups.count,
    candlePitchPx: candleGroups.pitchPx === null ? null : Number(candleGroups.pitchPx.toFixed(3)),
    lastCandleXFraction: candleGroups.lastXFraction === null ? null : Number(candleGroups.lastXFraction.toFixed(3)),
  };

  const structuralReasons = [];
  const layoutFound =
    width >= PROFILE.minWidth
    && height >= PROFILE.minHeight
    && metrics.aspectRatio >= PROFILE.aspectMin
    && metrics.aspectRatio <= PROFILE.aspectMax
    && metrics.plotCombinedCandleColorRatio >= PROFILE.minCandleColorRatio
    && metrics.rightPanelGreenRatio >= PROFILE.minRightGreen
    && metrics.rightPanelRedRatio >= PROFILE.minRightRed;
  if (!layoutFound) structuralReasons.push('LAYOUT_NOT_FOUND');
  if (metrics.outerNearBlackRatio > PROFILE.maxNearBlackEdge) structuralReasons.push('LETTERBOX_DETECTED');
  if (metrics.candleCount < PROFILE.minCandles || metrics.candleCount > PROFILE.maxCandles) structuralReasons.push('CANDLE_COUNT_OUT_OF_RANGE');
  if (metrics.lastCandleXFraction === null || metrics.lastCandleXFraction < 0.45 || metrics.lastCandleXFraction > 0.80) structuralReasons.push('NEWEST_CANDLE_NOT_VISIBLE');
  if (metrics.currentPriceBlueRatio < PROFILE.minPriceBlue || metrics.horizontalMarkerRowRatio < PROFILE.minMarkerRow) structuralReasons.push('CURRENT_PRICE_MARKER_MISSING');

  const preflight = await serverPreflight(imageBytes, width, height);
  if (preflight.status === 'block') structuralReasons.push('PREFLIGHT_BLOCK');

  if (structuralReasons.length) {
    return {
      eligibleForModel: false,
      blockReason: structuralReasons[0],
      reasons: structuralReasons,
      layoutFound,
      metrics,
      rects,
      preflight,
      serverVerifierVersion: 'server-deterministic-v1.0.0',
      coverageComplete: VALIDATION_COVERAGE_COMPLETE,
    };
  }

  if (typeof runOcr !== 'function') {
    return {
      eligibleForModel: false,
      blockReason: 'OCR_ENGINE_NOT_AVAILABLE',
      reasons: ['OCR_ENGINE_NOT_AVAILABLE'],
      layoutFound,
      metrics,
      rects,
      preflight,
      serverVerifierVersion: 'server-deterministic-v1.0.0',
      coverageComplete: VALIDATION_COVERAGE_COMPLETE,
    };
  }

  const [badge, timeAxisOcr, assetOcr, priceAxis, chartType, clock] = await Promise.all([
    timeframeBadgeMatch(imageBytes, rects.timeframeBadge, templatesDir),
    cropPng(imageBytes, rects.timeAxis, 3).then((png) => runOcr(png, 'time_axis')),
    cropPng(imageBytes, rects.assetLabel, 3).then((png) => runOcr(png, 'asset_payout')),
    verifyPriceAxis(imageBytes, rects.priceAxis, runOcr),
    verifyChartType(imageBytes, rects.chartTypeToolbar, templatesDir),
    verifyClock(imageBytes, rects.platformClock, runOcr),
  ]);

  const labels = timeAxisOcr.tokens
    .filter((token) => token.confidence >= OCR_MIN_CONFIDENCE)
    .map((token) => {
      const secondsOfDay = parseTimeText(token.text);
      if (secondsOfDay === null) return null;
      return {
        text: token.text,
        secondsOfDay,
        x: rects.timeAxis.x + ((token.left + token.width / 2) / 3),
        confidence: token.confidence,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);

  const derived = deriveMinutesPerCandle(labels, metrics.candlePitchPx);
  const enoughIntervals = derived.intervalCount >= TIMEFRAME_MIN_INTERVALS;
  const minutes = derived.minutesPerCandle;
  const axisM1 = enoughIntervals && minutes !== null && Math.abs(minutes - 1) <= MINUTES_PER_CANDLE_TOLERANCE;
  const axisMismatch = enoughIntervals && minutes !== null && Math.abs(minutes - 1) > MINUTES_PER_CANDLE_TOLERANCE;
  const timeframePass = badge.passed && axisM1;

  const configured = normalizeAsset(configuredAsset);
  const parsedAsset = normalizeAsset(assetOcr.rawText);
  const assetPass = Boolean(configured && parsedAsset && configured === parsedAsset);

  const payoutCandidates = assetOcr.tokens
    .filter((token) => token.confidence >= OCR_MIN_CONFIDENCE)
    .map((token) => String(token.text).trim().match(/^(\d{1,3})%$/))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value <= 100);
  const payout = payoutCandidates.length === 1 ? payoutCandidates[0] : null;

  const reasons = [];
  if (!badge.passed || !axisM1) reasons.push(axisMismatch ? 'TIMEFRAME_MISMATCH' : 'TIMEFRAME_UNVERIFIED');
  if (!assetPass) reasons.push(configured && parsedAsset ? 'ASSET_MISMATCH' : 'ASSET_UNVERIFIED');
  if (!priceAxis.readable) reasons.push(priceAxis.reasonCode || 'PRICE_AXIS_UNREADABLE');
  if (!chartType.verified) reasons.push(chartType.mismatch ? 'CHARTTYPE_MISMATCH' : 'CHARTTYPE_UNVERIFIED');
  if (clock.reasonCode) reasons.push(clock.reasonCode);

  const uniqueReasons = [...new Set(reasons)];
  const frameVerified = uniqueReasons.length === 0;
  const eligibleForModel = frameVerified && VALIDATION_COVERAGE_COMPLETE;
  const blockReason = frameVerified && !VALIDATION_COVERAGE_COMPLETE
    ? 'LAYOUT_VALIDATION_INCOMPLETE'
    : uniqueReasons[0] || null;

  return {
    eligibleForModel,
    blockReason,
    reasons: uniqueReasons,
    frameVerified,
    layoutFound,
    metrics,
    rects,
    preflight,
    timeframe: {
      badge,
      axis: {
        rawText: timeAxisOcr.rawText || null,
        labels,
        intervalCount: derived.intervalCount,
        medianTickSeconds: derived.medianTickSeconds,
        minutesPerCandle: minutes === null ? null : Number(minutes.toFixed(3)),
        verifiedM1: axisM1,
      },
      passed: timeframePass,
      threshold: TIMEFRAME_TEMPLATE_THRESHOLD,
      requiredIntervals: TIMEFRAME_MIN_INTERVALS,
      tolerance: MINUTES_PER_CANDLE_TOLERANCE,
    },
    asset: { configured, parsed: parsedAsset, passed: assetPass, rawText: assetOcr.rawText || null },
    priceAxis,
    chartType,
    clock,
    payout: {
      percent: payout,
      breakevenWinRate: payout === null ? null : Number((1 / (1 + payout / 100)).toFixed(6)),
      reasonCode: payout === null ? 'PAYOUT_UNREADABLE' : null,
    },
    serverVerifierVersion: 'server-deterministic-v1.0.0',
    coverageComplete: VALIDATION_COVERAGE_COMPLETE,
  };
}
