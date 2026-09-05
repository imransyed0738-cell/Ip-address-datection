import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, Globe2, Lock, MapPin, ShieldAlert, Users } from "lucide-react";

import { AdminShell, RiskBadge } from "@/components/AdminShell";
import { adminOverview } from "@/lib/admin.functions";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { formatWhen, prettyEvent } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Security overview — Sentinel Admin" },
      {
        name: "description",
        content: "Live security overview of logins, risk levels and account events for administrators.",
      },
      { property: "og:title", content: "Security overview — Sentinel Admin" },
      { property: "og:description", content: "Live administrator security monitoring." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminDashboard,
});

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="panel flex items-center gap-3 rounded-lg border border-border bg-card p-4">
      <Icon className="size-5 text-muted-foreground" />
      <div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="label-caps text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const load = useServerFn(adminOverview);
  const realtimeStatus = useAdminRealtime();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => load() });

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Security overview</h1>
        <span
          className={
            realtimeStatus === "SUBSCRIBED" ? "text-xs text-success" : "text-xs text-warning"
          }
        >
          {realtimeStatus === "SUBSCRIBED" ? "Live" : `Realtime ${realtimeStatus.toLowerCase()}`}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Live monitoring of authentication and account-security events. Risk scores flag activity for human
        review — they are never an automatic judgement about a person.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Registered users" value={data?.users ?? 0} icon={Users} />
        <Stat label="Active users" value={data?.activeUsers ?? 0} icon={Activity} />
        <Stat label="Live IPs" value={data?.liveIpCount ?? 0} icon={MapPin} />
        <Stat label="Geo regions" value={data?.geoRegions ?? 0} icon={Globe2} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Events (24h)" value={data?.events24 ?? 0} icon={Activity} />
        <Stat label="High-risk events" value={data?.highRiskCount ?? 0} icon={ShieldAlert} />
        <Stat label="Locked accounts" value={data?.locked ?? 0} icon={Lock} />
        <div className="panel flex items-center gap-3 rounded-lg border border-border bg-card p-4">
          <ShieldAlert className="size-5 text-muted-foreground" />
          <div>
            <div className="text-2xl font-semibold tabular-nums">{data?.recent?.length ?? 0}</div>
            <div className="label-caps text-xs text-muted-foreground">Live monitor</div>
          </div>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Live security events</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Region</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">User</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Loading events…
                  </td>
                </tr>
              )}
              {(data?.recent ?? []).map((e: any) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-2">{formatWhen(e.created_at)}</td>
                  <td className="px-3 py-2">{prettyEvent(e.event_type)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.ip_address ?? "—"}</td>
                  <td className="px-3 py-2">{[e.browser, e.os].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2">{e.location_label ?? "—"}</td>
                  <td className="px-3 py-2">
                    <RiskBadge score={e.risk_score} level={e.risk_level} />
                  </td>
                  <td className="px-3 py-2">
                    {e.user_id ? (
                      <Link
                        to="/admin/users/$id"
                        params={{ id: e.user_id }}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        Investigate
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && !(data?.recent ?? []).length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No security events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
