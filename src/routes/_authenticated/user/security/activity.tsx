import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { RiskPill } from "@/routes/_authenticated/user/dashboard";
import {
  formatWhen,
  prettyEvent,
  useAlerts,
  useSecurityEvents,
  useSecurityRealtime,
} from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/user/security/activity")({
  head: () => ({
    meta: [
      { title: "Security Activity — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Every login and security event with IP address, device and approximate location.",
      },
      { property: "og:title", content: "Security Activity" },
      { property: "og:description", content: "Full security event history for your account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ActivityPage,
});

function ActivityPage() {
  useSecurityRealtime();
  const events = useSecurityEvents(200);
  const alerts = useAlerts();
  const unread = (alerts.data ?? []).filter((a) => !a.read).length;

  return (
    <AppShell unread={unread}>
      <p className="label-caps">Audit trail</p>
      <h1 className="text-2xl font-semibold">Security activity</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        IP addresses are observed by our servers. Locations are approximate regions derived from the
        connection or your consented device location.
      </p>

      <div className="panel mt-6 overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {["Date & time", "Event", "IP address", "Device", "Location", "Risk", "Status"].map(
                (h) => (
                  <th key={h} className="px-4 py-3 label-caps">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(events.data ?? []).map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatWhen(e.created_at)}
                </td>
                <td className="px-4 py-3 font-medium">{prettyEvent(e.event_type)}</td>
                <td className="px-4 py-3 font-mono text-xs">{e.ip_address ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {e.device_type ?? "Unknown"} · {e.browser ?? "—"} · {e.os ?? "—"}
                </td>
                <td className="px-4 py-3 text-xs">{e.location_label ?? "Unknown"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <RiskPill level={e.risk_level} />
                    <span className="font-mono text-xs text-muted-foreground">{e.risk_score}</span>
                  </div>
                  {e.risk_reasons?.length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {e.risk_reasons.join(", ")}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">{e.status}</td>
              </tr>
            ))}
            {events.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  No events yet. Sign in from another device to see the trail build up.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
