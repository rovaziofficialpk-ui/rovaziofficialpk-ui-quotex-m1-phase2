export interface AutoFrameFingerprint {
  luminance: Uint8Array;
  edges: Uint8Array;
}

export interface AutoFrameChange {
  score: number;
  meanDifference: number;
  changedPixels: number;
  edgeDifference: number;
}

export const AUTO_CAPTURE_INTERVAL_SECONDS = 5;
export const AUTO_AI_COOLDOWN_MS = 15_000;
export const AUTO_MIN_CHANGE_SCORE = 2.5;
export const AUTO_MAX_CONSECUTIVE_ERRORS = 3;

const SAMPLE_WIDTH = 96;
const SAMPLE_HEIGHT = 54;
const EDGE_THRESHOLD = 18;
const PIXEL_CHANGE_THRESHOLD = 14;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not inspect the captured live frame.'));
    image.src = dataUrl;
  });
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export async function buildAutoFrameFingerprint(dataUrl: string): Promise<AutoFrameFingerprint> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Browser frame comparison is unavailable.');

  // Slightly crop the outer edge so browser/site chrome and tiny corner timers have less weight.
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropX = Math.round(sourceWidth * 0.025);
  const cropY = Math.round(sourceHeight * 0.025);
  const cropWidth = Math.max(1, sourceWidth - (cropX * 2));
  const cropHeight = Math.max(1, sourceHeight - (cropY * 2));

  context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
  const luminance = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
  const edges = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);

  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    luminance[pixel] = Math.round(
      (pixels[index] * 0.2126)
      + (pixels[index + 1] * 0.7152)
      + (pixels[index + 2] * 0.0722),
    );
  }

  for (let y = 0; y < SAMPLE_HEIGHT; y += 1) {
    for (let x = 0; x < SAMPLE_WIDTH; x += 1) {
      const index = (y * SAMPLE_WIDTH) + x;
      const right = x + 1 < SAMPLE_WIDTH ? luminance[index + 1] : luminance[index];
      const down = y + 1 < SAMPLE_HEIGHT ? luminance[index + SAMPLE_WIDTH] : luminance[index];
      const gradient = Math.abs(luminance[index] - right) + Math.abs(luminance[index] - down);
      edges[index] = gradient >= EDGE_THRESHOLD ? 1 : 0;
    }
  }

  return { luminance, edges };
}

export function compareAutoFrames(previous: AutoFrameFingerprint, current: AutoFrameFingerprint): AutoFrameChange {
  const length = Math.min(previous.luminance.length, current.luminance.length);
  if (!length) return { score: 100, meanDifference: 100, changedPixels: 100, edgeDifference: 100 };

  let absoluteDifference = 0;
  let changed = 0;
  let edgeMismatch = 0;

  for (let index = 0; index < length; index += 1) {
    const delta = Math.abs(previous.luminance[index] - current.luminance[index]);
    absoluteDifference += delta;
    if (delta >= PIXEL_CHANGE_THRESHOLD) changed += 1;
    if (previous.edges[index] !== current.edges[index]) edgeMismatch += 1;
  }

  const meanDifference = (absoluteDifference / length / 255) * 100;
  const changedPixels = (changed / length) * 100;
  const edgeDifference = (edgeMismatch / length) * 100;

  // Weighted for chart monitoring: small text/countdown changes stay low, while candle/structure movement accumulates.
  const score = clamp(
    (meanDifference * 2.2)
    + (changedPixels * 0.55)
    + (edgeDifference * 0.35),
    0,
    100,
  );

  return {
    score: Number(score.toFixed(2)),
    meanDifference: Number(meanDifference.toFixed(2)),
    changedPixels: Number(changedPixels.toFixed(2)),
    edgeDifference: Number(edgeDifference.toFixed(2)),
  };
}
