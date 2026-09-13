import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getConnectionInfo, notifyAttendanceChange } from "@/lib/security.functions";

const STORAGE_KEY = "sentinel-user-attendance";
const statuses = ["Present", "Late", "Absent", "Leave"] as const;
type AttendanceStatus = (typeof statuses)[number];

type AttendanceRecord = {
  id: string;
  name: string;
  rollNumber: string;
  date: string;
  status: AttendanceStatus;
  note: string;
  ipAddress: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function currentConnection(
  getServerConnection: () => Promise<{ ip: string; location: string | null; userAgent: string }>,
) {
  const connection = await getServerConnection();
  if (connection.ip !== "unknown") return connection;

  try {
    const response = await fetch("https://api64.ipify.org?format=json");
    if (!response.ok) return connection;
    const result = (await response.json()) as { ip?: unknown };
    return typeof result.ip === "string" ? { ...connection, ip: result.ip } : connection;
  } catch {
    return connection;
  }
}

export const Route = createFileRoute("/_authenticated/user/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance Dashboard — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Manually record and review your attendance history.",
      },
    ],
  }),
  component: AttendanceDashboard,
});

function AttendanceDashboard() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [status, setStatus] = useState<AttendanceStatus>("Present");
  const [note, setNote] = useState("");
  const connectionFn = useServerFn(getConnectionInfo);
  const notifyChangeFn = useServerFn(notifyAttendanceChange);
  const connection = useQuery({
    queryKey: ["attendance", "connection"],
    queryFn: () => currentConnection(() => connectionFn()),
    refetchInterval: 30_000,
  });
  const attendanceChange = useMutation({
    mutationFn: (data: { action: "modified" | "deleted"; attendance: AttendanceRecord }) =>
      notifyChangeFn({ data }),
    onSuccess: (result) => {
      if (result.delivered) {
        toast.success("Attendance updated and notification email sent.");
      } else {
        toast.warning("Attendance updated, but email delivery is not configured.");
      }
    },
    onError: (error: Error) =>
      toast.error("Attendance saved, but notifications failed", { description: error.message }),
  });

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      setRecords(JSON.parse(saved) as AttendanceRecord[]);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }, [records]);

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => b.date.localeCompare(a.date)),
    [records],
  );
  const presentCount = records.filter((record) => record.status === "Present").length;
  const lateCount = records.filter((record) => record.status === "Late").length;

  function saveRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || !name.trim() || !rollNumber.trim()) return;

    const previous = records.find(
      (item) => item.date === date && item.rollNumber === rollNumber.trim(),
    );
    const record: AttendanceRecord = {
      id: `${date}-${rollNumber.trim()}-${Date.now()}`,
      name: name.trim(),
      rollNumber: rollNumber.trim(),
      date,
      status,
      note: note.trim(),
      ipAddress: connection.data?.ip ?? "Unavailable",
    };

    setRecords((current) => [
      ...current.filter(
        (record) => record.date !== date || record.rollNumber !== rollNumber.trim(),
      ),
      record,
    ]);
    if (previous) attendanceChange.mutate({ action: "modified", attendance: record });
    setNote("");
  }

  function removeRecord(id: string) {
    const record = records.find((item) => item.id === id);
    setRecords((current) => current.filter((record) => record.id !== id));
    if (record) {
      attendanceChange.mutate({
        action: "deleted",
        attendance: { ...record, ipAddress: connection.data?.ip ?? record.ipAddress },
      });
    }
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Daily records</p>
          <h1 className="text-2xl font-semibold">Attendance dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add attendance with a name, roll number, and the current server-observed IP address.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/user/dashboard">Back to dashboard</Link>
        </Button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Summary label="Total records" value={records.length} />
        <Summary label="Present" value={presentCount} tone="success" />
        <Summary label="Late" value={lateCount} tone="warning" />
      </div>

      <section className="panel mt-6 p-5">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-5 text-accent" />
          <h2 className="font-semibold">Record attendance</h2>
        </div>
        <form
          className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end"
          onSubmit={saveRecord}
        >
          <div className="space-y-1.5">
            <Label htmlFor="attendance-name">Name</Label>
            <Input
              id="attendance-name"
              placeholder="Full name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attendance-roll">Roll number</Label>
            <Input
              id="attendance-roll"
              placeholder="e.g. CS-024"
              value={rollNumber}
              onChange={(event) => setRollNumber(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attendance-date">Date</Label>
            <Input
              id="attendance-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attendance-status">Status</Label>
            <select
              id="attendance-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as AttendanceStatus)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {statuses.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attendance-note">Note (optional)</Label>
            <Input
              id="attendance-note"
              placeholder="Add a short note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Current IP address</Label>
            <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 font-mono text-xs">
              {connection.isLoading ? "Detecting…" : (connection.data?.ip ?? "Unavailable")}
            </div>
          </div>
          <Button type="submit">Save attendance</Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          The IP is observed by the server and refreshes every 30 seconds. Saving the same roll
          number for a date updates that person&apos;s record.
        </p>
      </section>

      <section className="panel mt-6 p-5">
        <h2 className="font-semibold">Attendance history</h2>
        {sortedRecords.length ? (
          <div className="mt-4 divide-y divide-border">
            {sortedRecords.map((record) => (
              <div key={record.id} className="flex flex-wrap items-center gap-3 py-3">
                <time className="w-32 text-sm font-medium" dateTime={record.date}>
                  {record.date}
                </time>
                <div className="min-w-40">
                  <div className="text-sm font-medium">{record.name || "Unknown"}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {record.rollNumber || "No roll number"}
                  </div>
                </div>
                <span className={statusClass(record.status)}>{record.status}</span>
                <span className="min-w-40 flex-1 text-sm text-muted-foreground">
                  {record.note || "No note added"}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {record.ipAddress || "IP unavailable"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete attendance for ${record.date}`}
                  onClick={() => removeRecord(record.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No attendance records yet. Add your first day above.
          </p>
        )}
      </section>
    </AppShell>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning";
}) {
  return (
    <div className="panel p-4">
      <p className="label-caps">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function statusClass(status: AttendanceStatus) {
  if (status === "Present")
    return "rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success";
  if (status === "Late")
    return "rounded-full bg-warning/20 px-3 py-1 text-xs font-semibold text-warning-foreground";
  if (status === "Absent")
    return "rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive";
  return "rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground";
}
