'use client';
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

const SCAN_EVERY_MS = 120;
const MAX_WIDTH = 640;     // frames are shrunk before decoding: plenty for a QR and much lighter on the phone
const SAME_CODE_GAP_MS = 3000; // the same code held in front of the camera is reported once per 3 seconds

/**
 * Opens the camera and calls `onScan` with the text of every QR code it sees. Mounting it starts the camera,
 * unmounting it stops it. Needs HTTPS (or localhost) and the camera permission.
 */
export default function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { onScanRef.current = onScan; });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | null = null;
    let lastText = '';
    let lastAt = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function tick() {
      if (stopped) return;
      const video = videoRef.current;
      if (ctx && video && video.readyState >= 2 && video.videoWidth) {
        const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
        if (found?.data) {
          const now = Date.now();
          if (found.data !== lastText || now - lastAt > SAME_CODE_GAP_MS) {
            lastText = found.data;
            lastAt = now;
            onScanRef.current(found.data);
          }
        }
      }
      timer = setTimeout(tick, SCAN_EVERY_MS);
    }

    async function start() {
      await Promise.resolve(); // keep any state update below out of the effect's synchronous part
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador no permite usar la cámara. Cargá el código a mano.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        if (!stopped) setError('No se pudo abrir la cámara. Revisá el permiso del navegador, o cargá el código a mano.');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true'); // iOS: stay inline instead of going full screen
      await video.play().catch(() => {});
      tick();
    }

    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl bg-black aspect-square max-w-sm mx-auto">
      <video ref={videoRef} muted playsInline className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-8 border-2 border-white/70 rounded-2xl pointer-events-none" />
      {error && (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-300 bg-black/80">{error}</p>
      )}
    </div>
  );
}
