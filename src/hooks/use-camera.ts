"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hasStream, setHasStream] = useState(false);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoEl(node);
  }, []);

  useEffect(() => {
    if (!active) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setHasStream(false);
      setReady(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function start() {
      setError(null);
      setReady(false);
      setHasStream(false);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setHasStream(true);
      } catch {
        if (!cancelled) {
          setError("Camera permission is required. Allow the camera and reload.");
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setHasStream(false);
      setReady(false);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !hasStream || ready) return;
    const stream = streamRef.current;
    const video = videoEl ?? videoRef.current;
    if (!stream || !video) return;

    let cancelled = false;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.muted = true;
    video.playsInline = true;

    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    if (video.readyState >= 2) {
      void video.play().then(markReady).catch(() => {
        if (!cancelled) {
          setError("Could not start the camera preview. Tap Allow, then open Enroll again.");
        }
      });
    } else {
      const onReady = () => {
        video.removeEventListener("loadeddata", onReady);
        void video.play().then(markReady).catch(() => undefined);
      };
      video.addEventListener("loadeddata", onReady);
      void video.play().then(markReady).catch(() => undefined);
      return () => {
        cancelled = true;
        video.removeEventListener("loadeddata", onReady);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [active, hasStream, videoEl, ready]);

  return { videoRef, setVideoRef, error, ready };
}
