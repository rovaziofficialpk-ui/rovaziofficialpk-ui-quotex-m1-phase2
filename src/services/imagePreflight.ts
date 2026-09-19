export type PreflightStatus = 'pass' | 'warn' | 'block';

export interface ImagePreflightResult {
  status: PreflightStatus;
  score: number;
  width: number;
  height: number;
  aspectRatio: number;
  brightness: number;
  contrast: number;
  edgeDensity: number;
  warnings: string[];
}

const SAMPLE_WIDTH = 320;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not inspect this image. Try another screenshot.'));
    image.src = dataUrl;
  });
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export async function analyzeImagePreflight(dataUrl: string): Promise<ImagePreflightResult> {
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const aspectRatio = width / Math.max(height, 1);

  const canvas = document.createElement('canvas');
  const scale = Math.min(1, SAMPLE_WIDTH / Math.max(width, 1));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Browser image inspection is unavailable.');

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const sampleCount = canvas.width * canvas.height;
  const luminance = new Float32Array(sampleCount);

  let sum = 0;
  let dark = 0;
  let bright = 0;

  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    const value = (pixels[index] * 0.2126) + (pixels[index + 1] * 0.7152) + (pixels[index + 2] * 0.0722);
    luminance[pixel] = value;
    sum += value;
    if (value < 12) dark += 1;
    if (value > 245) bright += 1;
  }

  const brightness = sum / Math.max(sampleCount, 1);
  let variance = 0;
  let edges = 0;
  let edgePairs = 0;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width) + x;
      const delta = luminance[index] - brightness;
      variance += delta * delta;

      if (x + 1 < canvas.width) {
        edgePairs += 1;
        if (Math.abs(luminance[index] - luminance[index + 1]) > 20) edges += 1;
      }
      if (y + 1 < canvas.height) {
        edgePairs += 1;
        if (Math.abs(luminance[index] - luminance[index + canvas.width]) > 20) edges += 1;
      }
    }
  }

  const contrast = Math.sqrt(variance / Math.max(sampleCount, 1));
  const edgeDensity = edges / Math.max(edgePairs, 1);
  const darkRatio = dark / Math.max(sampleCount, 1);
  const brightRatio = bright / Math.max(sampleCount, 1);

  let score = 0;
  if (width >= 900 && height >= 500) score += 30;
  else if (width >= 640 && height >= 360) score += 24;
  else if (width >= 480 && height >= 270) score += 14;
  else score += 4;

  if (contrast >= 42) score += 28;
  else if (contrast >= 28) score += 23;
  else if (contrast >= 16) score += 14;
  else score += 4;

  if (edgeDensity >= 0.055 && edgeDensity <= 0.48) score += 25;
  else if (edgeDensity >= 0.025 && edgeDensity <= 0.58) score += 18;
  else if (edgeDensity >= 0.01) score += 10;
  else score += 2;

  if (darkRatio < 0.72 && brightRatio < 0.72) score += 12;
  else if (darkRatio < 0.88 && brightRatio < 0.88) score += 6;

  if (aspectRatio >= 0.45 && aspectRatio <= 3.6) score += 5;
  else score += 2;

  score = clamp(Math.round(score), 0, 100);

  const warnings: string[] = [];
  if (width < 640 || height < 360) warnings.push(`Low screenshot resolution (${width}×${height}); labels or candles may be hard to verify.`);
  if (contrast < 18) warnings.push('Low visual contrast; candle bodies and levels may be difficult to distinguish.');
  if (edgeDensity < 0.02) warnings.push('Very little visual detail was detected; the screenshot may be blurred, blank, or heavily cropped.');
  if (darkRatio > 0.88) warnings.push('Most of the image is near-black; make sure the chart itself is visible.');
  if (brightRatio > 0.88) warnings.push('Most of the image is near-white; chart detail may be washed out.');
  if (aspectRatio < 0.4 || aspectRatio > 4.2) warnings.push('Unusual crop/aspect ratio; include more recent price action and chart labels if possible.');

  const severe =
    width < 420 ||
    height < 240 ||
    contrast < 7 ||
    (edgeDensity < 0.006 && contrast < 12) ||
    darkRatio > 0.96 ||
    brightRatio > 0.96;

  const status: PreflightStatus = severe ? 'block' : score >= 68 ? 'pass' : 'warn';

  return {
    status,
    score,
    width,
    height,
    aspectRatio: Number(aspectRatio.toFixed(2)),
    brightness: Number(brightness.toFixed(1)),
    contrast: Number(contrast.toFixed(1)),
    edgeDensity: Number(edgeDensity.toFixed(3)),
    warnings: warnings.slice(0, 4),
  };
}
