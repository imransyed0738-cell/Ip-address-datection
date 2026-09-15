import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, ClipboardCheck, Crosshair, Globe2, Lock, MapPin, ShieldAlert, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AdminShell, RiskBadge } from "@/components/AdminShell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminOverview } from "@/lib/admin.functions";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { lookupIpAddress } from "@/lib/security.functions";
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
  const lookupFn = useServerFn(lookupIpAddress);
  const realtimeStatus = useAdminRealtime();
  const [ipToTrack, setIpToTrack] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => load() });
  const ipLookup = useMutation({
    mutationFn: (ip: string) => lookupFn({ data: { ip } }),
    onError: (error: Error) => toast.error("IP lookup failed", { description: error.message }),
  });

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
      <div className="mt-4">
        <Link to="/admin/attendance" className={buttonVariants({ variant: "outline" })}>
          <ClipboardCheck className="mr-2 size-4" /> Attendance dashboard
        </Link>
      </div>

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

      <section className="panel mt-8 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Crosshair className="size-5 text-accent" />
              <p className="label-caps">IP tracker</p>
            </div>
            <h2 className="mt-2 text-lg font-semibold">Track a public IP address</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Check an IP to view its approximate real-time location and any matching registered device name.
            </p>
          </div>
        </div>

        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const ip = ipToTrack.trim();
            if (ip) ipLookup.mutate(ip);
          }}
        >
          <Input
            className="font-mono sm:max-w-md"
            placeholder="e.g. 8.8.8.8"
            aria-label="Public IP address"
            value={ipToTrack}
            onChange={(event) => setIpToTrack(event.target.value)}
          />
          <Button type="submit" disabled={!ipToTrack.trim() || ipLookup.isPending}>
            <Crosshair className="mr-2 size-4" />
            {ipLookup.isPending ? "Checking…" : "Track IP"}
          </Button>
        </form>

        {ipLookup.data && (
          <div className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded border border-border bg-background p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Device name</div>
              <div className="mt-2 text-sm font-medium">{ipLookup.data.deviceName ?? "Unknown from public IP"}</div>
            </div>
            <div className="rounded border border-border bg-background p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">IP address</div>
              <div className="mt-2 font-mono text-xs">{ipLookup.data.ip}</div>
            </div>
            <div className="rounded border border-border bg-background p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Public location</div>
              <div className="mt-2 text-sm">{ipLookup.data.publicAddress}</div>
            </div>
            <div className="rounded border border-border bg-background p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Network</div>
              <div className="mt-2 text-sm">{ipLookup.data.organization ?? "Organization unavailable"}</div>
            </div>
            <div className="flex items-end rounded border border-border bg-background p-3">
              {ipLookup.data.latitude != null && ipLookup.data.longitude != null ? (
                <Button asChild size="sm" variant="outline" className="w-full">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ipLookup.data.latitude},${ipLookup.data.longitude}`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPin />
                    Open map
                  </a>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Map unavailable</span>
              )}
            </div>
          </div>
        )}
        {ipLookup.isError && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {ipLookup.error.message}
          </p>
        )}
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Security activity</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Recent login and account-security activity across all users.
            </p>
          </div>
          <Link
            to="/admin/events"
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            View full activity
          </Link>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">IP address</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Region</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">User</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    Loading events…
                  </td>
                </tr>
              )}
              {(data?.recent ?? []).map((e: any) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-2">{formatWhen(e.created_at)}</td>
                  <td className="px-3 py-2">{prettyEvent(e.event_type)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.ip_address ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {[e.device_type, e.browser, e.os].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2">{e.location_label ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <RiskBadge score={e.risk_score} level={e.risk_level} />
                      {e.user_id && (
                        <Link
                          to="/admin/users/$id"
                          params={{ id: e.user_id }}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          aria-label={`View activity for ${e.user_id}`}
                        >
                          User activity
                        </Link>
                      )}
                    </div>
                    {e.risk_reasons?.length > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {e.risk_reasons.join(", ")}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{e.status ?? "—"}</td>
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
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
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
