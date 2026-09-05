import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { AdminShell, RiskBadge } from "@/components/AdminShell";
import { Input } from "@/components/ui/input";
import { adminListUsers } from "@/lib/admin.functions";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { formatWhen } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "User security overview — Sentinel Admin" },
      {
        name: "description",
        content: "Account status, last sign-in, devices and explainable risk level for every user.",
      },
      { property: "og:title", content: "User security overview — Sentinel Admin" },
      { property: "og:description", content: "Administrator view of account security status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminUsers,
});

function AdminUsers() {
  const load = useServerFn(adminListUsers);
  const realtimeStatus = useAdminRealtime();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "users"], queryFn: () => load() });
  const [q, setQ] = useState("");

  const rows = (data ?? []).filter((u: any) =>
    `${u.full_name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Users</h1>
        <span
          className={
            realtimeStatus === "SUBSCRIBED" ? "text-xs text-success" : "text-xs text-warning"
          }
        >
          {realtimeStatus === "SUBSCRIBED" ? "Live" : `Realtime ${realtimeStatus.toLowerCase()}`}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Account security status only. Risk levels are explainable signals for review, not verdicts.
      </p>

      <Input
        className="mt-4 max-w-sm"
        placeholder="Search name or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Last sign-in</th>
              <th className="px-3 py-2">Last IP</th>
              <th className="px-3 py-2">Devices</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  Loading users…
                </td>
              </tr>
            )}
            {rows.map((u: any) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-medium">{u.full_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-3 py-2">
                  {u.account_locked ? (
                    <span className="text-destructive">Locked</span>
                  ) : u.flagged_for_review ? (
                    <span className="text-warning">Under review</span>
                  ) : (
                    <span className="text-success">Active</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{formatWhen(u.created_at)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {u.lastLoginAt ? formatWhen(u.lastLoginAt) : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{u.lastIp ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{u.deviceCount}</td>
                <td className="px-3 py-2 text-xs">
                  {u.location_consent ? (u.last_location_label ?? "Consented, no fix yet") : "No consent"}
                </td>
                <td className="px-3 py-2">
                  <RiskBadge score={u.riskScore} level={u.riskLevel} />
                </td>
                <td className="px-3 py-2">
                  <Link
                    to="/admin/users/$id"
                    params={{ id: u.id }}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Investigate
                  </Link>
                </td>
              </tr>
            ))}
            {!isLoading && !rows.length && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  No users match this search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
