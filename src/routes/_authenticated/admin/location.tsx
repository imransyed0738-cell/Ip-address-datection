import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";

import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { adminListUsers } from "@/lib/admin.functions";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { formatWhen } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/location")({
  head: () => ({
    meta: [
      { title: "User locations — Sentinel Admin" },
      { name: "description", content: "Consent-aware location monitoring for users." },
    ],
  }),
  component: AdminLocations,
});

function AdminLocations() {
  const load = useServerFn(adminListUsers);
  const realtimeStatus = useAdminRealtime();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "users"], queryFn: () => load() });
  const users = data ?? [];

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">User locations</h1>
        <span
          className={
            realtimeStatus === "SUBSCRIBED" ? "text-xs text-success" : "text-xs text-warning"
          }
        >
          {realtimeStatus === "SUBSCRIBED" ? "Live" : `Realtime ${realtimeStatus.toLowerCase()}`}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Latest location shared by each user. Users without consent are not displayed with location data.
      </p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Consent</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Coordinates</th>
              <th className="px-3 py-2">Last updated</th>
              <th className="px-3 py-2">Map</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Loading locations...
                </td>
              </tr>
            )}
            {users.map((user: any) => (
              <tr key={user.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-medium">{user.full_name ?? "-"}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </td>
                <td className="px-3 py-2">
                  {user.location_consent ? (
                    <span className="text-success">Granted</span>
                  ) : (
                    <span className="text-muted-foreground">Not granted</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {user.location_consent
                    ? user.last_location_label ??
                      ([user.city, user.country].filter(Boolean).join(", ") || "No location fix")
                    : "Hidden"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {user.location_consent && user.last_lat != null && user.last_lng != null
                    ? `${user.last_lat.toFixed(5)}, ${user.last_lng.toFixed(5)}`
                    : "-"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {user.location_consent && user.last_location_at
                    ? formatWhen(user.last_location_at)
                    : "-"}
                </td>
                <td className="px-3 py-2">
                  {user.location_consent && user.last_lat != null && user.last_lng != null ? (
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${user.last_lat},${user.last_lng}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open map for ${user.full_name ?? user.email ?? "user"}`}
                      >
                        <MapPin />
                        Open map
                      </a>
                    </Button>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !users.length && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}