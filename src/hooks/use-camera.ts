"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoEl(node);
  }, []);

  useEffect(() => {
    if (!active || !videoEl) return;
    let cancelled = false;

    async function start() {
      setError(null);
      setReady(false);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        videoEl.srcObject = stream;
        videoEl.muted = true;
        videoEl.defaultMuted = true;
        videoEl.playsInline = true;
        videoEl.setAttribute("playsinline", "true");
        videoEl.setAttribute("webkit-playsinline", "true");
        await videoEl.play();
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) {
          const name = err instanceof DOMException ? err.name : "";
          if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            setError("Camera is blocked. Click the camera icon in the address bar, choose Allow, then open Enroll again.");
          } else if (name === "NotFoundError") {
            setError("No camera was found on this device.");
          } else {
            setError("Could not start the camera. Close other apps using it, then try Enroll again.");
          }
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoEl.srcObject) videoEl.srcObject = null;
      setReady(false);
    };
  }, [active, videoEl]);

  return { videoRef, setVideoRef, error, ready };
}
