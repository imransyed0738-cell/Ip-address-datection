import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getDeviceInfo } from "@/lib/device";
import { recordSecurityEvent, setLocationConsent, submitLocation } from "@/lib/security.functions";
import { formatWhen, useAlerts, useProfile, useSecurityRealtime } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/user/security/location")({
  head: () => ({
    meta: [
      { title: "Location Security — Sentinel Secure Banking" },
      {
        name: "description",
        content:
          "Consent-based location monitoring. Enable, review your last approximate location, or revoke access at any time.",
      },
      { property: "og:title", content: "Location Security" },
      { property: "og:description", content: "Consent-based location monitoring." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LocationPage,
});

function LocationPage() {
  useSecurityRealtime();
  const profile = useProfile();
  const alerts = useAlerts();
  const queryClient = useQueryClient();
  const consentFn = useServerFn(setLocationConsent);
  const submitFn = useServerFn(submitLocation);
  const eventFn = useServerFn(recordSecurityEvent);
  const watchRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);

  const consent = Boolean(profile.data?.location_consent);
  const unread = (alerts.data ?? []).filter((a) => !a.read).length;

  // Only watch position while consent is on. Revoking stops updates immediately.
  useEffect(() => {
    if (!consent || typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        void submitFn({
          data: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        })
          .then(() => queryClient.invalidateQueries({ queryKey: ["profile"] }))
          .catch((error: Error) => {
            toast.error("Location update failed", { description: error.message });
          });
      },
      (err) => {
        toast.error("Live location stopped", {
          description:
            err.code === GeolocationPositionError.PERMISSION_DENIED
              ? "Location permission was denied. Allow it in your browser settings."
              : err.message || "The device could not provide a location fix.",
        });
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 },
    );
    watchRef.current = id;
    return () => {
      navigator.geolocation.clearWatch(id);
      watchRef.current = null;
    };
  }, [consent, submitFn, queryClient]);

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      let position: GeolocationPosition | null = null;
      if (enabled) {
        if (!window.isSecureContext) {
          throw new Error("Location requires HTTPS or localhost.");
        }
        if (!navigator.geolocation) {
          throw new Error("This browser does not support location services.");
        }

        // Ask the browser first — no consent is recorded unless permission is granted.
        position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            (err) => {
              const message =
                err.code === GeolocationPositionError.PERMISSION_DENIED
                  ? "Location permission was denied. Allow it in your browser settings and try again."
                  : err.code === GeolocationPositionError.POSITION_UNAVAILABLE
                    ? "Your device could not determine its location. Check location services and try again."
                    : "Location lookup timed out. Try again."
              reject(new Error(message));
            },
            { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 },
          );
        });
      }
      await consentFn({ data: { enabled } });
      if (position) {
        await submitFn({
          data: { latitude: position.coords.latitude, longitude: position.coords.longitude },
        });
      }
      await eventFn({
        data: { eventType: "LOCATION_PERMISSION_CHANGED", device: getDeviceInfo() },
      }).catch(() => undefined);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Location preference saved");
    },
    onError: (e: Error) => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.error("Location not enabled", { description: e.message });
    },
  });

  async function refreshNow() {
    if (!window.isSecureContext || !navigator.geolocation) {
      toast.error("Location is unavailable", {
        description: "Use HTTPS or localhost and enable your device location services.",
      });
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await submitFn({
            data: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          });
          await queryClient.invalidateQueries({ queryKey: ["profile"] });
          toast.success("Location updated");
        } catch (e) {
          toast.error("Update rejected", { description: (e as Error).message });
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setBusy(false);
        toast.error("Could not read location", {
          description:
            err.code === GeolocationPositionError.PERMISSION_DENIED
              ? "Location permission was denied. Allow it in your browser settings and try again."
              : err.message,
        });
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 },
    );
  }

  const lat = profile.data?.last_lat as number | null | undefined;
  const lng = profile.data?.last_lng as number | null | undefined;

  return (
    <AppShell unread={unread}>
      <p className="label-caps">Privacy & security</p>
      <h1 className="text-2xl font-semibold">Live security location</h1>

      {profile.isError && (
        <div className="panel mt-6 p-5">
          <p className="text-sm text-destructive">Could not load location settings.</p>
          <p className="mt-1 text-xs text-muted-foreground">{profile.error.message}</p>
          <Button className="mt-4" variant="outline" onClick={() => void profile.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {!profile.isError && <div className="panel mt-6 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Security location monitoring</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              When enabled, your browser asks for permission and your device shares coordinates with
              our servers to verify logins. Disable it and collection stops instantly — the stored
              coordinates are deleted.
            </p>
          </div>
          <Switch
            checked={consent}
            disabled={toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label="Toggle location monitoring"
          />
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <Item label="Status" value={consent ? "Location sharing enabled" : "Disabled"} />
          <Item
            label="Consent recorded"
            value={
              profile.data?.location_consent_at
                ? formatWhen(profile.data.location_consent_at as string)
                : "—"
            }
          />
          <Item label="Latitude" value={consent && lat != null ? "Protected" : "—"} />
          <Item label="Longitude" value={consent && lng != null ? "Protected" : "—"} />
          <Item
            label="Approximate location"
            value={(profile.data?.last_location_label as string) ?? "Not available"}
          />
          <Item
            label="Last updated"
            value={
              profile.data?.last_location_at
                ? formatWhen(profile.data.last_location_at as string)
                : "—"
            }
          />
        </dl>

        {consent && (
          <Button className="mt-6" onClick={refreshNow} disabled={busy}>
            <MapPin className="mr-2 size-4" />
            {busy ? "Reading device location…" : "Update location now"}
          </Button>
        )}
      </div>}

      {consent && lat != null && lng != null && (
        <div className="panel mt-6 overflow-hidden">
          <iframe
            title="Approximate security location"
            className="h-80 w-full border-0"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.03}%2C${
              lat - 0.02
            }%2C${lng + 0.03}%2C${lat + 0.02}&layer=mapnik&marker=${lat}%2C${lng}`}
          />
        </div>
      )}
    </AppShell>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
