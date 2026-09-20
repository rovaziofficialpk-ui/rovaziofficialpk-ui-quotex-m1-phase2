import { apiFetch } from './apiClient';
export interface AuditArtifact {
  role: string;
  dataUrl: string;
  sha256: string;
  mimeType: string;
  byteLength: number;
  cropRect: { x: number; y: number; width: number; height: number } | null;
  sourceFrameSize: { width: number; height: number } | null;
  sourceFrameSha256: string | null;
  capturedAt: string | null;
  privacyMasked?: boolean;
}

function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('Expected a base64 data URL.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, mimeType: match[1] };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256DataUrl(dataUrl: string): Promise<{ sha256: string; mimeType: string; byteLength: number }> {
  const decoded = dataUrlBytes(dataUrl);
  const stableBuffer = decoded.bytes.buffer.slice(
    decoded.bytes.byteOffset,
    decoded.bytes.byteOffset + decoded.bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', stableBuffer);
  return { sha256: hex(new Uint8Array(digest)), mimeType: decoded.mimeType, byteLength: decoded.bytes.byteLength };
}

export async function imageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error('Could not read audit image dimensions.'));
    image.src = dataUrl;
  });
}

export async function buildAuditArtifact(args: {
  role: string;
  dataUrl: string;
  capturedAt: string | null;
  cropRect: { x: number; y: number; width: number; height: number } | null;
  sourceFrameSize: { width: number; height: number } | null;
  sourceFrameSha256: string | null;
}): Promise<AuditArtifact> {
  const hash = await sha256DataUrl(args.dataUrl);
  return {
    role: args.role,
    dataUrl: args.dataUrl,
    sha256: hash.sha256,
    mimeType: hash.mimeType,
    byteLength: hash.byteLength,
    cropRect: args.cropRect,
    sourceFrameSize: args.sourceFrameSize,
    sourceFrameSha256: args.sourceFrameSha256,
    capturedAt: args.capturedAt,
  };
}

export async function buildPrivacyMaskedSourceArtifact(
  dataUrl: string,
  capturedAt: string | null,
): Promise<AuditArtifact> {
  const originalHash = await sha256DataUrl(dataUrl);
  const dimensions = await imageDimensions(dataUrl);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const target = new Image();
    target.onload = () => resolve(target);
    target.onerror = () => reject(new Error('Could not prepare privacy-masked audit source frame.'));
    target.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Privacy masking canvas is unavailable.');
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

  context.fillStyle = '#000';
  context.fillRect(0, 0, Math.round(dimensions.width * 0.055), dimensions.height);
  context.fillRect(
    Math.round(dimensions.width * 0.78),
    0,
    Math.round(dimensions.width * 0.22),
    Math.round(dimensions.height * 0.125),
  );

  const maskedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const maskedHash = await sha256DataUrl(maskedDataUrl);
  return {
    role: 'masked_source_frame',
    dataUrl: maskedDataUrl,
    sha256: maskedHash.sha256,
    mimeType: maskedHash.mimeType,
    byteLength: maskedHash.byteLength,
    cropRect: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
    sourceFrameSize: dimensions,
    sourceFrameSha256: originalHash.sha256,
    capturedAt,
    privacyMasked: true,
  };
}

export async function buildFullFrameArtifact(
  role: string,
  dataUrl: string,
  capturedAt: string | null,
): Promise<AuditArtifact> {
  const hash = await sha256DataUrl(dataUrl);
  const dimensions = await imageDimensions(dataUrl);
  return {
    role,
    dataUrl,
    sha256: hash.sha256,
    mimeType: hash.mimeType,
    byteLength: hash.byteLength,
    cropRect: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
    sourceFrameSize: dimensions,
    sourceFrameSha256: hash.sha256,
    capturedAt,
  };
}

export async function persistDurableAudit(record: Record<string, unknown>, artifacts: AuditArtifact[]): Promise<{ recordHash: string }> {
  const response = await apiFetch('/api/audit/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record, artifacts }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Durable audit write failed (${response.status}).`);
  }
  return { recordHash: String(data.recordHash || '') };
}
