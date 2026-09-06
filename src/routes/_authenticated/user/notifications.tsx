import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatWhen, useAlerts, useSecurityRealtime } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/user/notifications")({
  head: () => ({
    meta: [
      { title: "Security Alerts — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Real-time alerts for new devices, unusual IP addresses and account changes.",
      },
      { property: "og:title", content: "Security Alerts" },
      { property: "og:description", content: "Real-time account security alerts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  useSecurityRealtime();
  const alerts = useAlerts();
  const queryClient = useQueryClient();
  const unread = (alerts.data ?? []).filter((a) => !a.read).length;

  const markRead = useMutation({
    mutationFn: async (id?: string) => {
      const query = supabase.from("security_alerts").update({ read: true });
      const { error } = id ? await query.eq("id", id) : await query.eq("read", false);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["security_alerts"] }),
    onError: (e: Error) => toast.error("Could not update alert", { description: e.message }),
  });

  return (
    <AppShell unread={unread}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Notifications</p>
          <h1 className="text-2xl font-semibold">Security alerts</h1>
        </div>
        {unread > 0 && (
          <Button variant="outline" onClick={() => markRead.mutate(undefined)}>
            <CheckCheck className="mr-2 size-4" /> Mark all read
          </Button>
        )}
      </div>

      <div className="panel mt-6 divide-y divide-border">
        {alerts.isLoading && (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading alerts…</p>
        )}
        {alerts.isError && (
          <div className="p-10 text-center">
            <p className="text-sm text-destructive">Could not load security alerts.</p>
            <p className="mt-1 text-xs text-muted-foreground">{alerts.error.message}</p>
            <Button className="mt-4" variant="outline" onClick={() => void alerts.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {(alerts.data ?? []).map((a) => (
          <article key={a.id} className="flex gap-4 p-5">
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${
                a.read ? "bg-border" : "bg-accent"
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">{a.title}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    a.severity === "CRITICAL" || a.severity === "HIGH"
                      ? "bg-destructive/10 text-destructive"
                      : a.severity === "MEDIUM"
                        ? "bg-warning/15 text-warning-foreground"
                        : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {a.severity}
                </span>
                <span className="label-caps">{a.category}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatWhen(a.created_at)}
                </span>
              </div>
              {a.description && (
                <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>
              )}
              {!a.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 px-0 text-accent"
                  onClick={() => markRead.mutate(a.id)}
                >
                  Mark as read
                </Button>
              )}
            </div>
          </article>
        ))}
        {!alerts.isLoading && !alerts.isError && alerts.data?.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
            <BellOff className="size-6" />
            <p className="text-sm">No alerts. Your account looks quiet.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
