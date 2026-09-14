"use client";

import Dexie, { type EntityTable } from "dexie";
import { hashPin } from "@/lib/pin";

export type FaceStatus = "pending" | "enrolled";
export type SessionSource = "kiosk" | "manual";
export type AttemptResult =
  | "matched"
  | "no_match"
  | "liveness_fail"
  | "quality_fail"
  | "outside_hours"
  | "locked"
  | "gps_fail";

export type DayStatus = "Not in" | "In" | "Left" | "Missing checkout";

export interface Teacher {
  id: string;
  fullName: string;
  employeeId: string;
  department: string;
  phone?: string;
  faceStatus: FaceStatus;
  active: boolean;
  createdAt: string;
}

export interface FaceTemplate {
  id: string;
  teacherId: string;
  embedding: number[];
  sampleCount: number;
  enrolledAt: string;
}

export interface AttendanceSession {
  id: string;
  teacherId: string;
  loginAt: string;
  logoutAt: string | null;
  loginLat: number | null;
  loginLng: number | null;
  logoutLat: number | null;
  logoutLng: number | null;
  source: SessionSource;
  notes: string | null;
}

export interface AttemptLog {
  id: string;
  at: string;
  result: AttemptResult;
  teacherId?: string;
  reason?: string;
}

export interface AuditLog {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  beforeJson?: string;
  afterJson?: string;
}

export interface SchoolSettings {
  id: "singleton";
  name: string;
  timezone: string;
  checkInStart: string;
  checkInEnd: string;
  checkOutStart: string;
  checkOutEnd: string;
  endOfDay: string;
  expectedArrival: string;
  geofenceLat: number | null;
  geofenceLng: number | null;
  geofenceRadiusMeters: number | null;
  pinHash: string;
  requireGps: boolean;
}

class KioskDB extends Dexie {
  teachers!: EntityTable<Teacher, "id">;
  templates!: EntityTable<FaceTemplate, "id">;
  sessions!: EntityTable<AttendanceSession, "id">;
  attempts!: EntityTable<AttemptLog, "id">;
  audits!: EntityTable<AuditLog, "id">;
  settings!: EntityTable<SchoolSettings, "id">;

  constructor() {
    super("school-face-kiosk");
    this.version(1).stores({
      teachers: "id, employeeId, department, faceStatus, active",
      templates: "id, teacherId",
      sessions: "id, teacherId, loginAt, logoutAt",
      attempts: "id, at, result, teacherId",
      audits: "id, at, entityId",
      settings: "id",
    });
    this.version(2).stores({
      teachers: "id, employeeId, fullName, department, faceStatus, active",
      templates: "id, teacherId",
      sessions: "id, teacherId, loginAt, logoutAt",
      attempts: "id, at, result, teacherId",
      audits: "id, at, entityId",
      settings: "id",
    });
  }
}

export const db = new KioskDB();

export async function listTeachers(): Promise<Teacher[]> {
  const rows = await db.teachers.toArray();
  return rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function ensureDefaults(): Promise<SchoolSettings> {
  const existing = await db.settings.get("singleton");
  if (existing) return existing;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const row: SchoolSettings = {
    id: "singleton",
    name: "Riverside Staff Gate",
    timezone,
    checkInStart: "06:30",
    checkInEnd: "10:00",
    checkOutStart: "12:00",
    checkOutEnd: "18:00",
    endOfDay: "18:30",
    expectedArrival: "08:15",
    geofenceLat: null,
    geofenceLng: null,
    geofenceRadiusMeters: null,
    pinHash: await hashPin("1234"),
    requireGps: false,
  };
  await db.settings.put(row);
  return row;
}
