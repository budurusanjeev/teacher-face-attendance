const KEY = "school-kiosk-lockout";
const MAX_FAILS = 3;
const LOCK_MS = 30_000;

type LockState = { fails: number; until: number };

function read(): LockState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { fails: 0, until: 0 };
    return JSON.parse(raw) as LockState;
  } catch {
    return { fails: 0, until: 0 };
  }
}

function write(state: LockState) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function lockRemainingMs(): number {
  const { until } = read();
  return Math.max(0, until - Date.now());
}

export function isLocked(): boolean {
  return lockRemainingMs() > 0;
}

export function registerFail(): { locked: boolean; remainingMs: number } {
  const state = read();
  if (state.until > Date.now()) {
    return { locked: true, remainingMs: state.until - Date.now() };
  }
  const fails = state.fails + 1;
  if (fails >= MAX_FAILS) {
    write({ fails: 0, until: Date.now() + LOCK_MS });
    return { locked: true, remainingMs: LOCK_MS };
  }
  write({ fails, until: 0 });
  return { locked: false, remainingMs: 0 };
}

export function registerSuccess() {
  write({ fails: 0, until: 0 });
}
