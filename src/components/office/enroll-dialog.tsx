"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { db, type Teacher } from "@/lib/db";
import { createId } from "@/lib/ids";
import {
  averageDescriptor,
  detectFaces,
  evaluateChallenge,
  loadFaceModels,
  qualityCheck,
  qualityMessage,
  type FaceSample,
} from "@/lib/face/engine";
import { useCamera } from "@/hooks/use-camera";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const NEEDED = 3;

export function EnrollDialog({
  teacher,
  open,
  onOpenChange,
  onDone,
}: {
  teacher: Teacher | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { videoRef, setVideoRef, error, ready } = useCamera(open);
  const [samples, setSamples] = useState<number[][]>([]);
  const [hint, setHint] = useState("Allow the camera, then look into the oval.");
  const [modelsReady, setModelsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [faceOk, setFaceOk] = useState(false);
  const history = useRef<FaceSample[]>([]);
  const cooldownUntil = useRef(0);
  const samplesRef = useRef<number[][]>([]);
  const latestDescriptor = useRef<number[] | null>(null);

  const persistRef = useRef<(list: number[][]) => Promise<void>>(async () => undefined);

  persistRef.current = async (list: number[][]) => {
    if (!teacher || list.length < NEEDED || saving) return;
    setSaving(true);
    try {
      const embedding = averageDescriptor(list);
      const existing = await db.templates.where("teacherId").equals(teacher.id).first();
      if (existing) {
        await db.templates.update(existing.id, {
          embedding,
          sampleCount: list.length,
          enrolledAt: new Date().toISOString(),
        });
      } else {
        await db.templates.add({
          id: createId("face"),
          teacherId: teacher.id,
          embedding,
          sampleCount: list.length,
          enrolledAt: new Date().toISOString(),
        });
      }
      await db.teachers.update(teacher.id, { faceStatus: "enrolled" });
      await db.audits.add({
        id: createId("aud"),
        at: new Date().toISOString(),
        action: "face_reenroll",
        entityType: "teacher",
        entityId: teacher.id,
        reason: "Supervised kiosk enrollment",
      });
      toast.success(`${teacher.fullName} is enrolled on this tablet.`);
      onDone();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the face template.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  function addSample(descriptor: number[]) {
    if (samplesRef.current.length >= NEEDED) return;
    const next = [...samplesRef.current, descriptor];
    samplesRef.current = next;
    setSamples(next);
    history.current = [];
    cooldownUntil.current = Date.now() + 700;
    toast.success(`Sample ${next.length} of ${NEEDED} saved.`);
    if (next.length >= NEEDED) {
      setHint("Three samples captured. Click Save template.");
    } else {
      setHint(`Sample ${next.length} of ${NEEDED} saved. Capture the next one.`);
    }
  }

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  useEffect(() => {
    if (!open) {
      setSamples([]);
      setModelsReady(false);
      setFaceOk(false);
      latestDescriptor.current = null;
      history.current = [];
      setHint("Allow the camera, then look into the oval.");
      return;
    }
    let cancelled = false;
    void loadFaceModels()
      .then(() => {
        if (!cancelled) setModelsReady(true);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (!cancelled) setHint(`Could not load face models. ${message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !ready || !modelsReady || error) return;
    let running = true;

    const tick = async () => {
      if (!running) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        window.setTimeout(() => void tick(), 120);
        return;
      }
      if (samplesRef.current.length >= NEEDED) {
        window.setTimeout(() => void tick(), 400);
        return;
      }
      try {
        const faces = await detectFaces(video);
        const q = qualityCheck(video, faces);
        if (q) {
          history.current = [];
          latestDescriptor.current = null;
          setFaceOk(false);
          setHint(qualityMessage(q));
        } else if (Date.now() < cooldownUntil.current) {
          setFaceOk(true);
          latestDescriptor.current = faces[0].descriptor;
          setHint(`Sample ${samplesRef.current.length} of ${NEEDED} saved. Capture again.`);
        } else {
          latestDescriptor.current = faces[0].descriptor;
          setFaceOk(true);
          history.current = [...history.current, faces[0]].slice(-40);
          const blink = evaluateChallenge("blink", history.current);
          const held = history.current.length >= 12;
          setHint(
            `Face ready for sample ${samplesRef.current.length + 1} of ${NEEDED}. Blink, or click Capture sample.`,
          );
          if (blink.passed || held) {
            addSample(faces[0].descriptor);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Face capture failed.";
        setHint(message);
        setFaceOk(false);
      }
      if (running) window.setTimeout(() => void tick(), 90);
    };

    void tick();
    return () => {
      running = false;
    };
  }, [open, ready, modelsReady, error, videoRef]);

  function captureNow() {
    if (samplesRef.current.length >= NEEDED) return;
    if (!latestDescriptor.current) {
      toast.error("No face in the oval yet. Sit closer and look at the camera.");
      return;
    }
    addSample(latestDescriptor.current);
  }

  async function save() {
    await persistRef.current(samples);
  }

  const status = error
    ? error
    : !ready
      ? "Starting camera…"
      : !modelsReady
        ? "Loading on-device face models…"
        : hint;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90dvh] w-[min(100%,28rem)] flex-col gap-3 overflow-hidden p-4 sm:max-w-md"
        keepMounted={false}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>Enroll face — {teacher?.fullName}</DialogTitle>
          <DialogDescription>
            Look into the upright oval, then capture three samples and save.
          </DialogDescription>
        </DialogHeader>
        <div className="relative mx-auto aspect-[3/4] h-[min(48dvh,320px)] shrink-0 overflow-hidden rounded-xl bg-black">
          <video
            ref={setVideoRef}
            data-enroll-video
            className="h-full w-full scale-x-[-1] object-cover"
            playsInline
            muted
            autoPlay
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[78%] w-[58%] rounded-[50%] border-2 border-emerald-300/90" />
          </div>
          {!ready ? (
            <div className="absolute inset-x-3 bottom-3 rounded-md bg-black/70 px-2 py-1 text-center text-xs text-white">
              {error ?? "Waiting for camera… allow access if the browser asks."}
            </div>
          ) : null}
        </div>
        <p className="shrink-0 text-sm text-muted-foreground">{status}</p>
        <p className="shrink-0 text-sm font-medium">
          {samples.length} / {NEEDED} samples
        </p>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={captureNow}
            disabled={!faceOk || samples.length >= NEEDED || saving}
          >
            Capture sample
          </Button>
          <Button onClick={() => void save()} disabled={samples.length < NEEDED || saving}>
            {saving ? "Saving…" : "Save template"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
