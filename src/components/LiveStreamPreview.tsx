import { useEffect, useRef } from 'react';

interface LiveStreamPreviewProps {
  stream: MediaStream;
  className?: string;
}

export function LiveStreamPreview({ stream, className = '' }: LiveStreamPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.srcObject = stream;
    void video.play().catch(() => undefined);

    return () => {
      if (video.srcObject === stream) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      aria-label="Live shared chart preview"
      className={className}
    />
  );
}
