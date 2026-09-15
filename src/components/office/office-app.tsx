"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { EnrollDialog } from "@/components/office/enroll-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  todayRows,
  teacherHistory,
  type TodayRow,
} from "@/lib/attendance";
import { downloadText, sessionsToCsv } from "@/lib/csv";
import {
  db,
  ensureDefaults,
  listTeachers,
  type AttemptLog,
  type AttendanceSession,
  type SchoolSettings,
  type Teacher,
} from "@/lib/db";
import { createId } from "@/lib/ids";
import { hashPin, pinsMatch } from "@/lib/pin";
import { formatDateTime, formatDuration, formatTime, todayKey } from "@/lib/time";

function statusClass(status: TodayRow["status"]) {
  switch (status) {
    case "In":
      return "bg-emerald-600 text-white";
    case "Left":
      return "bg-slate-700 text-white";
    case "Missing checkout":
      return "bg-amber-500 text-amber-950";
    default:
      return "bg-red-700 text-white";
  }
}

export function OfficeApp() {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [rows, setRows] = useState<TodayRow[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [attempts, setAttempts] = useState<AttemptLog[]>([]);
  const [tab, setTab] = useState("today");
  const [query, setQuery] = useState("");
  const [enrollFor, setEnrollFor] = useState<Teacher | null>(null);
  const [historyTeacher, setHistoryTeacher] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [history, setHistory] = useState<AttendanceSession[]>([]);
  const [edit, setEdit] = useState<AttendanceSession | null>(null);
  const [editLogin, setEditLogin] = useState("");
  const [editLogout, setEditLogout] = useState("");
  const [editReason, setEditReason] = useState("");

  const [staffName, setStaffName] = useState("");
  const [staffId, setStaffId] = useState("");
  const [staffDept, setStaffDept] = useState("General");
  const [newPin, setNewPin] = useState("");

  async function refresh() {
    const s = await ensureDefaults();
    setSettings(s);
    const today = await todayRows();
    setRows(today.rows);
    const list = await listTeachers();
    setTeachers(list);
    if (list.length === 0) setTab("staff");
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    setAttempts(
      (await db.attempts.orderBy("at").reverse().limit(80).toArray()).filter(
        (a) => a.at >= start.toISOString(),
      ),
    );
    const day = todayKey(s.timezone);
    if (!fromDay) setFromDay(day.slice(0, 8) + "01");
    if (!toDay) setToDay(day);
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Could not load office data.";
          toast.error(message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // refresh reads current date filters; run when the office is unlocked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const entered = String(new FormData(e.currentTarget).get("pin") ?? pin).trim();
    try {
      const s = await ensureDefaults();
      if (await pinsMatch(entered, s.pinHash)) {
        setUnlocked(true);
        setPin("");
      } else {
        toast.error("Wrong office PIN.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not open office storage.";
      toast.error(message);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.teacher.fullName.toLowerCase().includes(q) ||
        r.teacher.employeeId.toLowerCase().includes(q) ||
        r.teacher.department.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const counts = useMemo(() => {
    const c = { in: 0, left: 0, missing: 0, notIn: 0 };
    for (const r of rows) {
      if (r.status === "In") c.in += 1;
      else if (r.status === "Left") c.left += 1;
      else if (r.status === "Missing checkout") c.missing += 1;
      else c.notIn += 1;
    }
    return c;
  }, [rows]);

  async function addTeacher(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fullName = String(form.get("fullName") ?? staffName).trim();
    const employeeId = String(form.get("employeeId") ?? staffId).trim();
    const department = String(form.get("department") ?? staffDept).trim() || "General";
    if (!fullName || !employeeId) {
      toast.error("Name and employee ID are required.");
      return;
    }
    try {
      const dup = await db.teachers.where("employeeId").equals(employeeId).first();
      if (dup) {
        toast.error("That employee ID already exists.");
        return;
      }
      await db.teachers.add({
        id: createId("tch"),
        fullName,
        employeeId,
        department,
        faceStatus: "pending",
        active: true,
        createdAt: new Date().toISOString(),
      });
      setStaffName("");
      setStaffId("");
      toast.success("Teacher added. Click Enroll face on their row.");
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save this teacher.";
      toast.error(message);
    }
  }

  async function loadHistory() {
    if (!historyTeacher) return;
    const list = await teacherHistory(historyTeacher, fromDay, toDay);
    setHistory(list);
  }

  async function exportHistory() {
    if (!settings || !historyTeacher) return;
    const teacher = teachers.find((t) => t.id === historyTeacher);
    if (!teacher) return;
    const csv = sessionsToCsv(
      history.map((s) => ({
        name: teacher.fullName,
        employeeId: teacher.employeeId,
        loginAt: s.loginAt,
        logoutAt: s.logoutAt,
        source: s.source,
        notes: s.notes,
      })),
      settings.timezone,
    );
    downloadText(`${teacher.employeeId}-attendance.csv`, csv);
  }

  async function saveEdit() {
    if (!edit || !editReason.trim()) {
      toast.error("A reason is required for corrections.");
      return;
    }
    const loginAt = new Date(editLogin).toISOString();
    const logoutAt = editLogout ? new Date(editLogout).toISOString() : null;
    await db.sessions.update(edit.id, { loginAt, logoutAt, source: "manual", notes: editReason.trim() });
    await db.audits.add({
      id: createId("aud"),
      at: new Date().toISOString(),
      action: "session_update",
      entityType: "session",
      entityId: edit.id,
      reason: editReason.trim(),
      beforeJson: JSON.stringify(edit),
      afterJson: JSON.stringify({ loginAt, logoutAt }),
    });
    toast.success("Session updated.");
    setEdit(null);
    setEditReason("");
    await refresh();
    await loadHistory();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const next = { ...settings };
    if (newPin.trim()) {
      if (newPin.trim().length < 4) {
        toast.error("PIN must be at least 4 digits.");
        return;
      }
      next.pinHash = await hashPin(newPin.trim());
    }
    await db.settings.put(next);
    setNewPin("");
    toast.success("Settings saved on this tablet.");
    await refresh();
  }

  if (!unlocked) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-100 px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Register staff (office)</CardTitle>
            <CardDescription>
              There is no email signup. Unlock with PIN <strong>1234</strong>, add a teacher, then
              enroll their face on this device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={(e) => void unlock(e)}>
              <Label htmlFor="pin">Office PIN</Label>
              <Input
                id="pin"
                name="pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
                autoFocus={false}
              />
              <Button type="submit">Unlock and register</Button>
              <Link href="/" className="text-center text-sm text-muted-foreground hover:underline">
                Back to gate
              </Link>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {settings.name}
          </p>
          <h1 className="text-xl font-semibold">Today’s staff attendance</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/"
            className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted"
          >
            Open gate
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              setUnlocked(false);
            }}
          >
            Lock office
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="In" value={counts.in} />
          <Summary label="Left" value={counts.left} />
          <Summary label="Not in" value={counts.notIn} />
          <Summary label="Missing checkout" value={counts.missing} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex h-auto w-full flex-wrap">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="attempts">Failed attempts</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="mt-4">
            <div className="mb-3">
              <Input
                placeholder="Search name, ID, or department"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {filtered.length === 0 ? (
              <Empty>No teachers added yet. Open Register a teacher on the Staff tab.</Empty>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Teacher</TableHead>
                      <TableHead>Dept</TableHead>
                      <TableHead>Login</TableHead>
                      <TableHead>Logout</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.teacher.id}>
                        <TableCell>
                          <div className="font-medium">{r.teacher.fullName}</div>
                          <div className="text-xs text-muted-foreground">{r.teacher.employeeId}</div>
                        </TableCell>
                        <TableCell>{r.teacher.department}</TableCell>
                        <TableCell>
                          {r.session ? formatTime(r.session.loginAt, settings.timezone) : "—"}
                        </TableCell>
                        <TableCell>
                          {r.session?.logoutAt
                            ? formatTime(r.session.logoutAt, settings.timezone)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {r.session
                            ? formatDuration(r.session.loginAt, r.session.logoutAt)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusClass(r.status)}>{r.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                Teacher
                <select
                  className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                  value={historyTeacher}
                  onChange={(e) => setHistoryTeacher(e.target.value)}
                >
                  <option value="">Select…</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                From
                <Input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                To
                <Input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} />
              </label>
              <div className="flex items-end gap-2">
                <Button onClick={() => void loadHistory()}>Show</Button>
                <Button variant="outline" onClick={() => void exportHistory()} disabled={history.length === 0}>
                  CSV
                </Button>
              </div>
            </div>
            {history.length === 0 ? (
              <Empty>No sessions in this period for that teacher.</Empty>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Login</TableHead>
                      <TableHead>Logout</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{formatDateTime(s.loginAt, settings.timezone)}</TableCell>
                        <TableCell>
                          {s.logoutAt ? formatDateTime(s.logoutAt, settings.timezone) : "—"}
                        </TableCell>
                        <TableCell>{formatDuration(s.loginAt, s.logoutAt)}</TableCell>
                        <TableCell>{s.source}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEdit(s);
                              setEditLogin(toLocalInput(s.loginAt));
                              setEditLogout(s.logoutAt ? toLocalInput(s.logoutAt) : "");
                              setEditReason("");
                            }}
                          >
                            Correct
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="staff" className="mt-4 space-y-4">
            <form className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-4" onSubmit={(e) => void addTeacher(e)}>
              <div className="sm:col-span-4">
                <p className="font-medium">Register a teacher</p>
                <p className="text-sm text-muted-foreground">
                  1) Add name and employee ID. 2) Click Enroll face. 3) Blink three times at the camera.
                </p>
              </div>
              <Input name="fullName" placeholder="Full name" value={staffName} onChange={(e) => setStaffName(e.target.value)} />
              <Input name="employeeId" placeholder="Employee ID" value={staffId} onChange={(e) => setStaffId(e.target.value)} />
              <Input name="department" placeholder="Department" value={staffDept} onChange={(e) => setStaffDept(e.target.value)} />
              <Button type="submit">Register</Button>
            </form>
            {teachers.length === 0 ? (
              <Empty>No staff registered yet. Use the form above, then Enroll face.</Empty>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Face</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teachers.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          {t.fullName}
                          <div className="text-xs text-muted-foreground">{t.department}</div>
                        </TableCell>
                        <TableCell>{t.employeeId}</TableCell>
                        <TableCell>{t.faceStatus}</TableCell>
                        <TableCell>{t.active ? "Yes" : "No"}</TableCell>
                        <TableCell className="space-x-2">
                          <Button size="sm" onClick={() => setEnrollFor(t)}>
                            Enroll face
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void db.teachers.update(t.id, { active: !t.active }).then(() => refresh())
                            }
                          >
                            {t.active ? "Disable" : "Enable"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="attempts" className="mt-4">
            {attempts.length === 0 ? (
              <Empty>No failed or matched attempts logged today.</Empty>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attempts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{formatDateTime(a.at, settings.timezone)}</TableCell>
                        <TableCell>{a.result}</TableCell>
                        <TableCell>{a.reason ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <form className="grid max-w-xl gap-3 rounded-xl border bg-white p-4" onSubmit={(e) => void saveSettings(e)}>
              <Field label="School name">
                <Input
                  value={settings.name}
                  onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                />
              </Field>
              <Field label="Timezone">
                <Input
                  value={settings.timezone}
                  onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Check-in start">
                  <Input
                    type="time"
                    value={settings.checkInStart}
                    onChange={(e) => setSettings({ ...settings, checkInStart: e.target.value })}
                  />
                </Field>
                <Field label="Check-in end">
                  <Input
                    type="time"
                    value={settings.checkInEnd}
                    onChange={(e) => setSettings({ ...settings, checkInEnd: e.target.value })}
                  />
                </Field>
                <Field label="Check-out start">
                  <Input
                    type="time"
                    value={settings.checkOutStart}
                    onChange={(e) => setSettings({ ...settings, checkOutStart: e.target.value })}
                  />
                </Field>
                <Field label="Check-out end">
                  <Input
                    type="time"
                    value={settings.checkOutEnd}
                    onChange={(e) => setSettings({ ...settings, checkOutEnd: e.target.value })}
                  />
                </Field>
                <Field label="End of day">
                  <Input
                    type="time"
                    value={settings.endOfDay}
                    onChange={(e) => setSettings({ ...settings, endOfDay: e.target.value })}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.requireGps}
                  onChange={(e) => setSettings({ ...settings, requireGps: e.target.checked })}
                />
                Require GPS on each match (turn on for a real campus kiosk)
              </label>
              <Field label="New office PIN (optional)">
                <Input
                  type="password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="Leave blank to keep current PIN"
                />
              </Field>
              <p className="text-sm text-muted-foreground">
                Liveness cannot be turned off. Face templates never leave this tablet.
              </p>
              <Button type="submit">Save settings</Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>

      <EnrollDialog
        key={enrollFor?.id ?? "closed"}
        teacher={enrollFor}
        open={!!enrollFor}
        onOpenChange={(o) => {
          if (!o) setEnrollFor(null);
        }}
        onDone={() => void refresh()}
      />

      {edit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Correct a session</CardTitle>
              <CardDescription>Every change is audited. A reason is required.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Login">
                <Input type="datetime-local" value={editLogin} onChange={(e) => setEditLogin(e.target.value)} />
              </Field>
              <Field label="Logout (empty = still in)">
                <Input type="datetime-local" value={editLogout} onChange={(e) => setEditLogout(e.target.value)} />
              </Field>
              <Field label="Reason">
                <Textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEdit(null)}>
                  Cancel
                </Button>
                <Button onClick={() => void saveEdit()}>Save</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-white px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
    </label>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
