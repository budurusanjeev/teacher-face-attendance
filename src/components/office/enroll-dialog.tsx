"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { db, type Teacher } from "@/lib/db";
import { createId } from "@/lib/ids";
import {
  averageDescriptor,
  detectFaces,
  evaluateChallenge,
  hasLiveMotion,
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
  const { videoRef, error, ready } = useCamera(open);
  const [samples, setSamples] = useState<number[][]>([]);
  const [hint, setHint] = useState("Align your face, then blink once per sample.");
  const [busy, setBusy] = useState(false);
  const history = useRef<FaceSample[]>([]);

  async function capture() {
    const video = videoRef.current;
    if (!video || !ready) return;
    setBusy(true);
    try {
      await loadFaceModels();
      history.current = [];
      const started = Date.now();
      let descriptor: number[] | null = null;
      while (Date.now() - started < 4000) {
        const faces = await detectFaces(video);
        const q = qualityCheck(video, faces);
        if (q) {
          setHint(qualityMessage(q));
          history.current = [];
          await new Promise((r) => setTimeout(r, 80));
          continue;
        }
        history.current = [...history.current, faces[0]].slice(-30);
        const blink = evaluateChallenge("blink", history.current);
        setHint("Blink once to prove this is a live enrollment.");
        if (blink.passed && hasLiveMotion(history.current)) {
          descriptor = faces[0].descriptor;
          break;
        }
        await new Promise((r) => setTimeout(r, 80));
      }
      if (!descriptor) {
        toast.error("Enrollment sample failed liveness. Try again in better light.");
        return;
      }
      const next = [...samples, descriptor];
      setSamples(next);
      setHint(`Sample ${next.length} of 3 saved.`);
      history.current = [];
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!teacher || samples.length < 3) return;
    const embedding = averageDescriptor(samples);
    const existing = await db.templates.where("teacherId").equals(teacher.id).first();
    if (existing) {
      await db.templates.update(existing.id, {
        embedding,
        sampleCount: samples.length,
        enrolledAt: new Date().toISOString(),
      });
    } else {
      await db.templates.add({
        id: createId("face"),
        teacherId: teacher.id,
        embedding,
        sampleCount: samples.length,
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
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enroll face — {teacher?.fullName}</DialogTitle>
          <DialogDescription>
            Supervised live capture only. Three samples. Each sample requires a blink so a
            printed photo cannot be enrolled.
          </DialogDescription>
        </DialogHeader>
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
        </div>
        <p className="text-sm text-muted-foreground">{error ?? hint}</p>
        <p className="text-sm font-medium">{samples.length} / 3 samples</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void capture()} disabled={busy || !ready || samples.length >= 3}>
            Capture sample
          </Button>
          <Button onClick={() => void save()} disabled={samples.length < 3}>
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
