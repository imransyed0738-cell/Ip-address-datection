import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Laptop, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/device";
import { recordSecurityEvent } from "@/lib/security.functions";
import { formatWhen, useAlerts, useDevices, useSecurityRealtime } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/user/devices")({
  head: () => ({
    meta: [
      { title: "Registered Devices — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Review the browsers and devices that have signed in, trust them or remove them.",
      },
      { property: "og:title", content: "Registered Devices" },
      { property: "og:description", content: "Manage devices that access your account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DevicesPage,
});

function DevicesPage() {
  useSecurityRealtime();
  const devices = useDevices();
  const alerts = useAlerts();
  const queryClient = useQueryClient();
  const eventFn = useServerFn(recordSecurityEvent);
  const unread = (alerts.data ?? []).filter((a) => !a.read).length;
  const currentKey = typeof window === "undefined" ? "" : getDeviceInfo().deviceKey;

  const setTrust = useMutation({
    mutationFn: async ({ id, trusted }: { id: string; trusted: boolean }) => {
      const { error } = await supabase.from("devices").update({ trusted }).eq("id", id);
      if (error) throw error;
      await eventFn({
        data: {
          eventType: "DEVICE_TRUSTED",
          device: getDeviceInfo(),
          note: trusted ? "Device trusted" : "Device trust removed",
        },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
    onError: (e: Error) => toast.error("Update failed", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("devices").delete().eq("id", id);
      if (error) throw error;
      await eventFn({
        data: {
          eventType: "DEVICE_REMOVED",
          device: getDeviceInfo(),
          note: "Registered device removed",
        },
      });
    },
    onSuccess: () => {
      toast.success("Device removed");
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e: Error) => toast.error("Could not remove device", { description: e.message }),
  });

  return (
    <AppShell unread={unread}>
      <p className="label-caps">Access control</p>
      <h1 className="text-2xl font-semibold">Registered devices</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Each browser gets a random registered key stored locally. We never read hardware
        identifiers or MAC addresses — browsers block that, and we do not work around it.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {devices.isLoading && (
          <p className="panel p-8 text-center text-sm text-muted-foreground">Loading devices…</p>
        )}
        {devices.isError && (
          <div className="panel p-8 text-center">
            <p className="text-sm text-destructive">Could not load registered devices.</p>
            <p className="mt-1 text-xs text-muted-foreground">{devices.error.message}</p>
            <Button className="mt-4" variant="outline" onClick={() => void devices.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {(devices.data ?? []).map((d) => {
          const isCurrent = d.device_key === currentKey;
          return (
            <div key={d.id} className="panel p-5">
              <div className="flex items-start gap-3">
                <Laptop className="mt-0.5 size-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{d.device_name}</h2>
                    {isCurrent && (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                        THIS DEVICE
                      </span>
                    )}
                    {d.trusted && (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        TRUSTED
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {d.device_type} · {d.browser} · {d.os}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {d.last_ip ?? "IP unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last seen {d.last_seen ? formatWhen(d.last_seen as string) : "—"}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTrust.mutate({ id: d.id as string, trusted: !d.trusted })}
                >
                  <ShieldCheck className="mr-2 size-4" />
                  {d.trusted ? "Remove trust" : "Trust device"}
                </Button>
                {!isCurrent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => remove.mutate(d.id as string)}
                  >
                    <Trash2 className="mr-2 size-4" /> Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {!devices.isLoading && !devices.isError && devices.data?.length === 0 && (
          <p className="panel p-8 text-center text-sm text-muted-foreground">
            No devices registered yet.
          </p>
        )}
      </div>
    </AppShell>
  );
}
