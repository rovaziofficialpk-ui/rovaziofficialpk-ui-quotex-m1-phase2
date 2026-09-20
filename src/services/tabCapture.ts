export interface LiveTabInfo {
  label: string;
  displaySurface: string;
}

export interface CapturedLiveFrame {
  dataUrl: string;
  capturedAt: string;
  captureMs: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

const MAX_CAPTURE_WIDTH = 2048;

export function isLiveTabCaptureSupported(): boolean {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

export async function requestLiveTabShare(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error('Live tab capture requires HTTPS or localhost.');
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('This browser does not support live tab capture. Use a current Chromium-based browser such as Chrome or Edge.');
  }

  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 5, max: 10 },
    },
    audio: false,
  });
}

export function getLiveTabInfo(stream: MediaStream): LiveTabInfo {
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings() as MediaTrackSettings & { displaySurface?: string };
  return {
    label: track?.label?.trim() || 'Shared browser tab',
    displaySurface: settings?.displaySurface || 'browser',
  };
}

export function stopLiveTabShare(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function isLiveTabStreamActive(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0];
  return Boolean(track && track.readyState === 'live' && track.enabled);
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The shared tab did not provide a video frame in time. Try sharing the tab again.'));
    }, 5000);

    const onReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error('Could not read video frames from the shared tab.'));
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
  });
}

export async function captureLiveTabFrameDetailed(stream: MediaStream): Promise<CapturedLiveFrame> {
  const captureStartedAt = performance.now();
  if (!isLiveTabStreamActive(stream)) {
    throw new Error('Live tab sharing has stopped. Click “Add Live Tab” and select the chart tab again.');
  }

  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await video.play();
    await waitForVideoReady(video);
    await new Promise((resolve) => window.setTimeout(resolve, 120));

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      throw new Error('The shared tab has no capturable frame yet. Try again in a moment.');
    }

    const scale = Math.min(1, MAX_CAPTURE_WIDTH / sourceWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Browser screenshot capture is unavailable.');

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const capturedAt = new Date().toISOString();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    return {
      dataUrl,
      capturedAt,
      captureMs: Math.round(performance.now() - captureStartedAt),
      sourceWidth,
      sourceHeight,
      outputWidth: canvas.width,
      outputHeight: canvas.height,
    };
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

export function humanizeTabCaptureError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Tab sharing was cancelled or blocked. Click “Add Live Tab” and choose the chart tab in the browser picker.';
    if (error.name === 'NotFoundError') return 'No shareable browser tab or window was available.';
    if (error.name === 'InvalidStateError') return 'The browser requires tab sharing to be started directly from a button click. Try “Add Live Tab” again.';
    if (error.name === 'AbortError') return 'The tab-sharing request was cancelled.';
  }
  return error instanceof Error ? error.message : 'Could not start live tab sharing.';
}


export async function captureLiveTabFrame(stream: MediaStream): Promise<string> {
  return (await captureLiveTabFrameDetailed(stream)).dataUrl;
}
