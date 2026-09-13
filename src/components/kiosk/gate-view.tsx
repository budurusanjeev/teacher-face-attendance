"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, ShieldAlert } from "lucide-react";
import { clockMatchedTeacher, logAttempt } from "@/lib/attendance";
import { db, ensureDefaults, type SchoolSettings } from "@/lib/db";
import {
  challengeCopy,
  detectFaces,
  evaluateChallenge,
  hasLiveMotion,
  loadFaceModels,
  qualityCheck,
  qualityMessage,
  randomChallenge,
  matchTeacher,
  type Challenge,
  type FaceSample,
} from "@/lib/face/engine";
import { readGps } from "@/lib/geo";
import { isLocked, lockRemainingMs, registerFail, registerSuccess } from "@/lib/lockout";
import { formatTime } from "@/lib/time";
import { useCamera } from "@/hooks/use-camera";
type Phase =
  | "boot"
  | "idle"
  | "scanning"
  | "challenge"
  | "matching"
  | "success"
  | "fail"
  | "locked";

type SuccessState = {
  name: string;
  action: "check-in" | "check-out";
  at: string;
};

export function GateView() {
  const { videoRef, error: cameraError, ready } = useCamera(true);
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("boot");
  const [hint, setHint] = useState("Loading on-device face models…");
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [lockMs, setLockMs] = useState(0);
  const [clock, setClock] = useState("");
  const busy = useRef(false);
  const history = useRef<FaceSample[]>([]);
  const challenge = useRef<Challenge>("blink");
  const challengeUntil = useRef(0);

  const refreshLock = useCallback(() => {
    const remaining = lockRemainingMs();
    if (remaining > 0) {
      setPhase("locked");
      setLockMs(remaining);
      setHint("Too many failed attempts. Wait before trying again.");
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const s = await ensureDefaults();
      if (cancelled) return;
      setSettings(s);
      try {
        await loadFaceModels();
        if (cancelled) return;
        setModelsReady(true);
        if (!refreshLock()) {
          setPhase("idle");
          setHint("Stand here to check in or out.");
        }
      } catch {
        setHint("Could not load local face models from this tablet.");
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refreshLock]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!settings) return;
      setClock(formatTime(new Date().toISOString(), settings.timezone));
      if (phase === "locked") {
        const remaining = lockRemainingMs();
        setLockMs(remaining);
        if (remaining <= 0) {
          setPhase("idle");
          setHint("Stand here to check in or out.");
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [settings, phase]);

  const fail = useCallback(
    async (
      reason: string,
      attempt: Parameters<typeof logAttempt>[0],
      opts?: { countLock?: boolean; alreadyLogged?: boolean },
    ) => {
      if (!opts?.alreadyLogged) {
        await logAttempt(attempt, reason);
      }
      const shouldLock =
        opts?.countLock !== false &&
        (attempt === "liveness_fail" || attempt === "no_match" || attempt === "quality_fail");
      if (shouldLock) {
        const { locked, remainingMs } = registerFail();
        if (locked) {
          setPhase("locked");
          setLockMs(remainingMs);
          setHint("Too many failed attempts. The kiosk is paused.");
          busy.current = false;
          return;
        }
      }
      setPhase("fail");
      setHint(reason);
      window.setTimeout(() => {
        if (isLocked()) return;
        setPhase("idle");
        setHint("Stand here to check in or out.");
        history.current = [];
        busy.current = false;
      }, 2800);
    },
    [],
  );

  useEffect(() => {
    if (!ready || !modelsReady || !settings) return;
    if (phase === "boot" || phase === "success" || phase === "fail" || phase === "locked") return;
    if (cameraError) return;

    let raf = 0;
    let running = true;

    const tick = async () => {
      if (!running) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || busy.current) {
        raf = requestAnimationFrame(() => void tick());
        return;
      }

      try {
        const faces = await detectFaces(video);
        const q = qualityCheck(video, faces);

        if (phase === "idle" || phase === "scanning") {
          if (q) {
            setPhase("scanning");
            setHint(qualityMessage(q));
            history.current = [];
          } else {
            history.current = [...history.current, faces[0]].slice(-24);
            if (history.current.length >= 8 && hasLiveMotion(history.current)) {
              busy.current = true;
              challenge.current = randomChallenge();
              challengeUntil.current = Date.now() + 4500;
              history.current = [faces[0]];
              setPhase("challenge");
              setHint(challengeCopy(challenge.current));
              busy.current = false;
            } else {
              setPhase("scanning");
              setHint("Hold still in the oval. Checking that you are live…");
            }
          }
        } else if (phase === "challenge") {
          if (Date.now() > challengeUntil.current) {
            busy.current = true;
            await fail("Live face required. Challenge timed out.", "liveness_fail");
            busy.current = false;
          } else if (q) {
            setHint(qualityMessage(q));
          } else {
            history.current = [...history.current, faces[0]].slice(-40);
            const result = evaluateChallenge(challenge.current, history.current);
            setHint(`${challengeCopy(challenge.current)} ${result.progress.hint}`);
            if (result.passed && hasLiveMotion(history.current)) {
              busy.current = true;
              setPhase("matching");
              setHint("Matching against the local staff list…");
              const templates = await db.templates.toArray();
              const teachers = await db.teachers.toArray();
              const enrolled = templates.filter((t) => {
                const teacher = teachers.find((x) => x.id === t.teacherId);
                return teacher?.active && teacher.faceStatus === "enrolled";
              });
              const hit = matchTeacher(faces[0].descriptor, enrolled);
              if (!hit) {
                await fail("Not recognized — see the office.", "no_match");
                busy.current = false;
              } else {
                let geo = null;
                if (settings.requireGps) {
                  try {
                    geo = await readGps();
                  } catch (e) {
                    await fail(
                      e instanceof Error ? e.message : "Location is required.",
                      "gps_fail",
                    );
                    busy.current = false;
                    raf = requestAnimationFrame(() => void tick());
                    return;
                  }
                }
                const clocked = await clockMatchedTeacher(hit.teacherId, geo);
                if (!clocked.ok) {
                  await fail(clocked.reason, clocked.attempt, {
                    alreadyLogged: true,
                    countLock: false,
                  });
                } else {
                  registerSuccess();
                  setSuccess({
                    name: clocked.teacher.fullName,
                    action: clocked.action,
                    at: clocked.at,
                  });
                  setPhase("success");
                  setHint(
                    clocked.action === "check-in"
                      ? "Checked in. Have a good day."
                      : "Checked out. See you tomorrow.",
                  );
                  window.setTimeout(() => {
                    setSuccess(null);
                    setPhase("idle");
                    setHint("Stand here to check in or out.");
                    history.current = [];
                    busy.current = false;
                  }, 3200);
                }
              }
            }
          }
        }
      } catch {
        /* frame skip */
      }

      if (running) raf = requestAnimationFrame(() => void tick());
    };

    raf = requestAnimationFrame(() => void tick());
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [ready, modelsReady, settings, phase, cameraError, videoRef, fail]);

  const enrolledHint = settings
    ? `${settings.name}`
    : "School staff kiosk";

  return (
    <div className="relative flex min-h-full flex-1 flex-col bg-[#0b1f17] text-emerald-50">
      <header className="flex items-start justify-between px-5 py-4 sm:px-8">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-emerald-300/80 uppercase">
            Staff attendance kiosk
          </p>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {enrolledHint}
          </h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl font-medium tabular-nums">{clock || "--:--"}</p>
          <p className="text-xs text-emerald-200/70">On-device match · no cloud face API</p>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-4 pb-24">
        <div className="relative aspect-[3/4] w-full max-w-md overflow-hidden rounded-[2rem] bg-black shadow-[0_0_0_1px_rgba(16,185,129,0.25)] sm:aspect-[4/5]">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[58%] w-[70%] rounded-[50%] border-2 border-emerald-300/80 shadow-[0_0_0_9999px_rgba(11,31,23,0.45)]" />
          </div>
          {phase === "success" && success ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-950/85 px-6 text-center">
              <p className="text-sm tracking-wide text-emerald-200 uppercase">
                {success.action === "check-in" ? "Checked in" : "Checked out"}
              </p>
              <p className="mt-2 text-3xl font-semibold">{success.name}</p>
              <p className="mt-2 font-mono text-xl">
                {settings ? formatTime(success.at, settings.timezone) : ""}
              </p>
            </div>
          ) : null}
          {phase === "fail" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/80 px-6 text-center">
              <ShieldAlert className="mb-3 size-10 text-red-200" />
              <p className="text-lg font-medium">{hint}</p>
            </div>
          ) : null}
          {phase === "locked" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-amber-950/85 px-6 text-center">
              <p className="text-lg font-medium">Kiosk locked</p>
              <p className="mt-2 font-mono text-3xl">{Math.ceil(lockMs / 1000)}s</p>
            </div>
          ) : null}
        </div>

        <p className="mt-6 max-w-lg text-center text-lg leading-snug text-emerald-50/95">
          {cameraError ?? hint}
        </p>

        {phase === "idle" || phase === "scanning" ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-emerald-200/70">
            <Camera className="size-4" />
            Remove masks. One person. Live camera only.
          </p>
        ) : null}

        {phase === "challenge" ? (
          <p className="mt-3 rounded-full bg-amber-300 px-4 py-2 text-sm font-semibold text-amber-950">
            Anti-spoof check in progress
          </p>
        ) : null}
      </main>

      <footer className="absolute right-4 bottom-4 left-4 flex items-center justify-between text-xs text-emerald-200/50">
        <span>Faces stay on this tablet. Photos are not used for matching.</span>
        <Link
          href="/office"
          className="rounded-md px-2 py-1 text-emerald-200/80 hover:bg-emerald-900/40 hover:text-white"
        >
          Office
        </Link>
      </footer>
    </div>
  );
}
