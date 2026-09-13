export function schoolDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function formatDuration(loginAt: string, logoutAt: string | null): string {
  if (!logoutAt) return "—";
  const ms = new Date(logoutAt).getTime() - new Date(loginAt).getTime();
  if (ms < 0) return "—";
  const minutes = Math.round(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return `${hours}h ${rest}m`;
}

function clockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  return h * 60 + m;
}

export function currentClockMinutes(timeZone: string, at = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function isWithinWindow(
  timeZone: string,
  start: string,
  end: string,
  at = new Date(),
): boolean {
  const now = currentClockMinutes(timeZone, at);
  const a = clockToMinutes(start);
  const b = clockToMinutes(end);
  if (a <= b) return now >= a && now <= b;
  return now >= a || now <= b;
}

export function isPastEndOfDay(timeZone: string, endOfDay: string, at = new Date()): boolean {
  return currentClockMinutes(timeZone, at) > clockToMinutes(endOfDay);
}

export function todayKey(timeZone: string, at = new Date()): string {
  return schoolDate(at.toISOString(), timeZone);
}
