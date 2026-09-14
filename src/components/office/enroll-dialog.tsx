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
  DialogFooter,
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
  const [hint, setHint] = useState("Allow the camera, then look into the oval and blink.");
  const [modelsReady, setModelsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const history = useRef<FaceSample[]>([]);
  const cooldownUntil = useRef(0);
  const samplesRef = useRef<number[][]>([]);

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

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  useEffect(() => {
    if (!open) {
      setSamples([]);
      setModelsReady(false);
      history.current = [];
      setHint("Allow the camera, then look into the oval and blink.");
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
          setHint(qualityMessage(q));
        } else if (Date.now() < cooldownUntil.current) {
          setHint(`Sample ${samplesRef.current.length} of ${NEEDED} saved. Blink again.`);
        } else {
          history.current = [...history.current, faces[0]].slice(-40);
          const blink = evaluateChallenge("blink", history.current);
          setHint(
            `Sample ${samplesRef.current.length + 1} of ${NEEDED}: look at the camera and blink once.`,
          );
          if (blink.passed) {
            const next = [...samplesRef.current, faces[0].descriptor];
            samplesRef.current = next;
            setSamples(next);
            history.current = [];
            cooldownUntil.current = Date.now() + 900;
            if (next.length >= NEEDED) {
              setHint("Three samples captured. Saving…");
              void persistRef.current(next);
            } else {
              setHint(`Sample ${next.length} of ${NEEDED} saved. Blink again.`);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Face capture failed.";
        setHint(message);
      }
      if (running) window.setTimeout(() => void tick(), 90);
    };

    void tick();
    return () => {
      running = false;
    };
  }, [open, ready, modelsReady, error, videoRef]);

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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" keepMounted>
        <DialogHeader>
          <DialogTitle>Enroll face — {teacher?.fullName}</DialogTitle>
          <DialogDescription>
            Live camera only. Blink clearly three times. A printed photo cannot be enrolled.
          </DialogDescription>
        </DialogHeader>
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-black">
          <video
            ref={setVideoRef}
            data-enroll-video
            className="h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[58%] w-[70%] rounded-[50%] border-2 border-emerald-300/80" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{status}</p>
        <p className="text-sm font-medium">
          {samples.length} / {NEEDED} samples
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={samples.length < NEEDED || saving}>
            {saving ? "Saving…" : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
