"use client";

import {
  db,
  ensureDefaults,
  type AttendanceSession,
  type AttemptResult,
  type DayStatus,
  type SchoolSettings,
  type Teacher,
} from "@/lib/db";
import { createId } from "@/lib/ids";
import { isPastEndOfDay, schoolDate, todayKey } from "@/lib/time";
import { distanceMeters, type GeoFix } from "@/lib/geo";

export type TodayRow = {
  teacher: Teacher;
  session: AttendanceSession | null;
  status: DayStatus;
};

export async function logAttempt(
  result: AttemptResult,
  reason?: string,
  teacherId?: string,
) {
  await db.attempts.add({
    id: createId("att"),
    at: new Date().toISOString(),
    result,
    reason,
    teacherId,
  });
}

export function sessionStatus(
  session: AttendanceSession | null,
  settings: SchoolSettings,
  now = new Date(),
): DayStatus {
  if (!session) return "Not in";
  if (session.logoutAt) return "Left";
  if (isPastEndOfDay(settings.timezone, settings.endOfDay, now)) {
    return "Missing checkout";
  }
  return "In";
}

export async function todayRows(): Promise<{
  settings: SchoolSettings;
  rows: TodayRow[];
}> {
  const settings = await ensureDefaults();
  const day = todayKey(settings.timezone);
  const [teachers, sessions] = await Promise.all([
    db.teachers.toArray(),
    db.sessions.toArray(),
  ]);
  const todaySessions = sessions.filter(
    (s) => schoolDate(s.loginAt, settings.timezone) === day,
  );
  const byTeacher = new Map<string, AttendanceSession>();
  for (const s of todaySessions) {
    const prev = byTeacher.get(s.teacherId);
    if (!prev || s.loginAt > prev.loginAt) byTeacher.set(s.teacherId, s);
  }
  const rows = teachers
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .filter((t) => t.active)
    .map((teacher) => {
      const session = byTeacher.get(teacher.id) ?? null;
      return { teacher, session, status: sessionStatus(session, settings) };
    });
  return { settings, rows };
}

export async function openSessionFor(teacherId: string) {
  return db.sessions.filter((s) => s.teacherId === teacherId && s.logoutAt === null).first();
}

export async function teacherHistory(
  teacherId: string,
  fromDay: string,
  toDay: string,
) {
  const settings = await ensureDefaults();
  const sessions = await db.sessions.where("teacherId").equals(teacherId).sortBy("loginAt");
  return sessions
    .filter((s) => {
      const d = schoolDate(s.loginAt, settings.timezone);
      return d >= fromDay && d <= toDay;
    })
    .reverse();
}

function assertGeo(settings: SchoolSettings, geo: GeoFix | null): string | null {
  if (!settings.requireGps) return null;
  if (!geo) return "Location is required on this kiosk.";
  if (geo.accuracy > 150) return "GPS is too inaccurate. Stand near a window and try again.";
  if (
    settings.geofenceLat != null &&
    settings.geofenceLng != null &&
    settings.geofenceRadiusMeters != null
  ) {
    const meters = distanceMeters(
      { lat: geo.lat, lng: geo.lng },
      { lat: settings.geofenceLat, lng: settings.geofenceLng },
    );
    if (meters > settings.geofenceRadiusMeters) {
      return "You are outside the school fence. Clock-in is only allowed on campus.";
    }
  }
  return null;
}

export type ClockResult =
  | { ok: true; action: "check-in" | "check-out"; teacher: Teacher; at: string }
  | { ok: false; reason: string; attempt: AttemptResult };

export async function clockMatchedTeacher(
  teacherId: string,
  geo: GeoFix | null,
): Promise<ClockResult> {
  const settings = await ensureDefaults();
  const teacher = await db.teachers.get(teacherId);
  if (!teacher || !teacher.active) {
    await logAttempt("no_match", "Unknown or inactive teacher");
    return { ok: false, reason: "Not recognized — see the office.", attempt: "no_match" };
  }
  if (teacher.faceStatus !== "enrolled") {
    await logAttempt("no_match", "Face not enrolled", teacher.id);
    return { ok: false, reason: "Face is not enrolled. See the office.", attempt: "no_match" };
  }

  const geoError = assertGeo(settings, geo);
  if (geoError) {
    await logAttempt("gps_fail", geoError, teacher.id);
    return { ok: false, reason: geoError, attempt: "gps_fail" };
  }

  const open = await openSessionFor(teacher.id);
  const now = new Date();
  const iso = now.toISOString();

  if (!open) {
    await db.sessions.add({
      id: createId("ses"),
      teacherId: teacher.id,
      loginAt: iso,
      logoutAt: null,
      loginLat: geo?.lat ?? null,
      loginLng: geo?.lng ?? null,
      logoutLat: null,
      logoutLng: null,
      source: "kiosk",
      notes: null,
    });
    await logAttempt("matched", "check-in", teacher.id);
    return { ok: true, action: "check-in", teacher, at: iso };
  }

  await db.sessions.update(open.id, {
    logoutAt: iso,
    logoutLat: geo?.lat ?? null,
    logoutLng: geo?.lng ?? null,
  });
  await logAttempt("matched", "check-out", teacher.id);
  return { ok: true, action: "check-out", teacher, at: iso };
}
