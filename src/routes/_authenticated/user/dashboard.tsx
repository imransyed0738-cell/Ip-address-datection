import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Bell,
  ClipboardCheck,
  Crosshair,
  Globe2,
  Lock,
  Mail,
  MapPin,
  Settings,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/device";
import {
  getConnectionInfo,
  lookupIpAddress,
  lookupMobileDevices,
  sendMobileTrackingConsent,
  lockAccount,
  recordSecurityEvent,
  terminateOtherSessions,
} from "@/lib/security.functions";
import {
  formatWhen,
  prettyEvent,
  useAlerts,
  useDevices,
  useProfile,
  useSecurityEvents,
  useSecurityRealtime,
} from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/user/dashboard")({
  head: () => ({
    meta: [
      { title: "Security Dashboard — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Your live account security posture: 2FA, sessions, devices, IP and alerts.",
      },
      { property: "og:title", content: "Security Dashboard" },
      { property: "og:description", content: "Live account security posture." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  useSecurityRealtime();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const events = useSecurityEvents(10);
  const alerts = useAlerts();
  const devices = useDevices();
  const [confirmLock, setConfirmLock] = useState(false);
  const [ipToTrack, setIpToTrack] = useState("");
  const [mobileToTrack, setMobileToTrack] = useState("");
  const [consentEmail, setConsentEmail] = useState<string | null>(null);

  const conn = useQuery({ queryKey: ["conn"], queryFn: () => getConnectionInfo() });
  const lookupFn = useServerFn(lookupIpAddress);
  const ipLookup = useMutation({
    mutationFn: (ip: string) => lookupFn({ data: { ip } }),
    onError: (error: Error) => toast.error("IP lookup failed", { description: error.message }),
  });
  const mobileLookupFn = useServerFn(lookupMobileDevices);
  const sendConsentFn = useServerFn(sendMobileTrackingConsent);
  const sendConsent = useMutation({
    mutationFn: (mobile: string) => sendConsentFn({ data: { mobile } }),
    onSuccess: (result) => {
      setConsentEmail(result.sentTo);
      toast.success("Verification link sent", { description: `Sent to ${result.sentTo}` });
    },
    onError: (error: Error) => toast.error("Could not send verification link", { description: error.message }),
  });
  const mobileLookup = useMutation({
    mutationFn: (mobile: string) => mobileLookupFn({ data: { mobile } }),
    onSuccess: async (lookupResult) => {
      try {
        await eventFn({
          data: {
            eventType: "SECURITY_ALERT",
            device: getDeviceInfo(),
            note: `Mobile device lookup: ${lookupResult.devices.length} registered device${lookupResult.devices.length === 1 ? "" : "s"} found`,
          },
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["devices"] }),
          queryClient.invalidateQueries({ queryKey: ["security_events"] }),
          queryClient.invalidateQueries({ queryKey: ["security_alerts"] }),
        ]);
        toast.success("Mobile lookup added to security activity");
      } catch (error) {
        toast.error("Lookup succeeded, but activity could not be updated", {
          description: error instanceof Error ? error.message : "Try refreshing the dashboard.",
        });
      }
    },
    onError: (error: Error) => toast.error("Mobile lookup failed", { description: error.message }),
  });

  const mfa = useQuery({
    queryKey: ["mfa"],
    queryFn: async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      return (data?.totp ?? []).some((f) => f.status === "verified");
    },
  });

  const emailVerified = useQuery({
    queryKey: ["email-verified"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return Boolean(data.user?.email_confirmed_at ?? data.user?.confirmed_at);
    },
  });

  const lockFn = useServerFn(lockAccount);
  const terminateFn = useServerFn(terminateOtherSessions);
  const eventFn = useServerFn(recordSecurityEvent);
  const currentKey = typeof window === "undefined" ? "" : getDeviceInfo().deviceKey;

  useEffect(() => {
    let active = true;
    async function ensureCurrentDevice() {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user || !active) return;
        const info = getDeviceInfo();

        const { data: existingDevice } = await supabase
          .from("devices")
          .select("id")
          .eq("user_id", auth.user.id)
          .eq("device_key", info.deviceKey)
          .maybeSingle();

        const { data: existingEvents } = await supabase
          .from("security_events")
          .select("id")
          .eq("user_id", auth.user.id)
          .limit(1);

        if ((!existingDevice || !existingEvents?.length) && active) {
          await eventFn({
            data: {
              eventType: existingDevice ? "LOGIN_SUCCESS" : "NEW_DEVICE",
              device: info,
              note: "Active session monitoring",
            },
          });
        }

        if (active) {
          await Promise.all([
            queryClient.refetchQueries({ queryKey: ["devices"] }),
            queryClient.refetchQueries({ queryKey: ["security_events"] }),
            queryClient.refetchQueries({ queryKey: ["security_alerts"] }),
          ]);
        }
      } catch (err) {
        console.warn("Device monitoring check:", err);
      }
    }
    void ensureCurrentDevice();
    return () => {
      active = false;
    };
  }, [eventFn, queryClient]);

  const lockMutation = useMutation({
    mutationFn: () => lockFn(),
    onSuccess: async () => {
      toast.success("Account locked. You have been signed out everywhere.");
      await supabase.auth.signOut();
      window.location.href = "/auth";
    },
    onError: (e: Error) => toast.error("Could not lock account", { description: e.message }),
  });

  const terminateMutation = useMutation({
    mutationFn: () => terminateFn(),
    onSuccess: () => {
      toast.success("All other sessions were signed out.");
      void queryClient.invalidateQueries({ queryKey: ["security_events"] });
    },
    onError: (e: Error) => toast.error("Could not sign out sessions", { description: e.message }),
  });

  const unread = (alerts.data ?? []).filter((a) => !a.read).length;
  const trustedDevices = (devices.data ?? []).filter((d) => d.trusted).length;
  const monitoringError = events.error ?? devices.error ?? alerts.error;
  const monitoringLoading = events.isLoading || devices.isLoading || alerts.isLoading;

  const score =
    (mfa.data ? 40 : 0) +
    (emailVerified.data ? 25 : 0) +
    (profile.data?.location_consent ? 10 : 0) +
    (trustedDevices > 0 ? 15 : 0) +
    (unread === 0 ? 10 : 0);

  return (
    <AppShell unread={unread}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Account security</p>
          <h1 className="text-2xl font-semibold">
            Welcome, {profile.data?.full_name ?? "account holder"}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/user/security">
              <Settings className="mr-2 size-4" /> Settings
            </Link>
          </Button>
          <Button variant="outline" onClick={() => terminateMutation.mutate()} disabled={terminateMutation.isPending}>
            Sign out other sessions
          </Button>
          <Button variant="destructive" onClick={() => setConfirmLock(true)}>
            <Lock className="mr-2 size-4" /> Lock account
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <QuickLink
          to="/user/security/location"
          icon={MapPin}
          label="Live geo tracking"
          value={profile.data?.location_consent ? "Enabled" : "Enable location"}
          detail={profile.data?.last_location_label ?? "Consent-based device location"}
          tone={profile.data?.location_consent ? "success" : "warning"}
        />
        <QuickLink
          to="/user/devices"
          icon={Smartphone}
          label="Device security"
          value={`${devices.data?.length ?? 0} registered`}
          detail={`${trustedDevices} trusted device${trustedDevices === 1 ? "" : "s"}`}
        />
        <QuickLink
          to="/user/security/activity"
          icon={Activity}
          label="Security activity"
          value={events.data?.[0] ? prettyEvent(events.data[0].event_type) : "No events yet"}
          detail={events.data?.[0] ? formatWhen(events.data[0].created_at) : "View login and location events"}
        />
        <QuickLink
          to="/user/attendance"
          icon={ClipboardCheck}
          label="Attendance dashboard"
          value="Manual check-in"
          detail="Record your attendance for any date"
        />
      </div>

      <section className="panel mt-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Crosshair className="size-5 text-accent" />
              <p className="label-caps">IP tracker</p>
            </div>
            <h2 className="mt-2 text-lg font-semibold">Check a public IP address</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Get the approximate public location and network details for an IPv4 or IPv6 address.
              A device name is shown only when it matches one of your registered devices.
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
          <div className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <LookupDetail
              label="Device name"
              value={ipLookup.data.deviceName ?? "Unknown from public IP"}
            />
            <LookupDetail label="IP address" value={ipLookup.data.ip} mono />
            <LookupDetail label="Public address (approx.)" value={ipLookup.data.publicAddress} />
            <LookupDetail
              label="Network"
              value={ipLookup.data.organization ?? "Organization unavailable"}
            />
          </div>
        )}
        {ipLookup.isError && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {ipLookup.error.message}
          </p>
        )}
      </section>

      <section className="panel mt-6 p-5">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 size-5 text-accent" />
          <div>
            <p className="label-caps">Mobile tracker</p>
            <h2 className="mt-2 text-lg font-semibold">Find your registered mobile devices</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Enter a mobile number and send a consent link to the signed-in account email. After
              approval, return here to view its registered device names, location, and public IP.
            </p>
            <Button asChild className="mt-4" variant="outline" size="sm">
              <Link to="/auth">Create your verified security account</Link>
            </Button>
          </div>
        </div>

        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const mobile = mobileToTrack.trim();
            if (mobile) mobileLookup.mutate(mobile);
          }}
        >
          <Input
            className="sm:max-w-md"
            type="tel"
            placeholder="Your account mobile number"
            aria-label="Account mobile number"
            value={mobileToTrack}
            onChange={(event) => setMobileToTrack(event.target.value)}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={!mobileToTrack.trim() || sendConsent.isPending}
              onClick={() => sendConsent.mutate(mobileToTrack.trim())}
            >
              <Mail className="mr-2 size-4" />
              {sendConsent.isPending ? "Sending…" : "Send verification link"}
            </Button>
            <Button type="submit" disabled={!mobileToTrack.trim() || mobileLookup.isPending}>
              <Smartphone className="mr-2 size-4" />
              {mobileLookup.isPending ? "Checking…" : "Track mobile"}
            </Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Use the number registered on your verified account. New users can create an account,
          confirm their email, and then track their own device.
        </p>
        {consentEmail && (
          <p className="mt-2 text-sm text-success" role="status">
            Verification link sent to <strong>{consentEmail}</strong>.
          </p>
        )}

        {mobileLookup.data && (
          <div className="mt-5 border-t border-border">
            <div className="grid gap-3 py-4 sm:grid-cols-2">
              <LookupDetail
                label="Last consented location"
                value={mobileLookup.data.location?.label ?? "Location sharing is disabled"}
              />
              <LookupDetail
                label="Location updated"
                value={
                  mobileLookup.data.location?.updatedAt
                    ? formatWhen(mobileLookup.data.location.updatedAt)
                    : "No location update available"
                }
              />
            </div>
            {mobileLookup.data.location?.latitude != null &&
              mobileLookup.data.location.longitude != null && (
                <a
                  className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
                  href={`https://www.google.com/maps?q=${mobileLookup.data.location.latitude},${mobileLookup.data.location.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="size-4" /> Open location on map
                </a>
              )}
            <div className="divide-y divide-border border-t border-border">
              {mobileLookup.data.devices.length === 0 && (
                <p className="py-4 text-sm text-muted-foreground">No registered devices found.</p>
              )}
              {mobileLookup.data.devices.map((device) => (
                <div key={device.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                  <span className="font-medium">{device.device_name ?? "Unnamed device"}</span>
                  <span className="text-xs text-muted-foreground">
                    {device.device_type ?? "Unknown"} · {device.browser ?? "—"} · {device.os ?? "—"}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    Public IP: {device.last_ip ?? "Unknown"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {device.last_seen ? formatWhen(device.last_seen) : "Last seen unknown"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {mobileLookup.isError && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {mobileLookup.error.message}
          </p>
        )}
      </section>

      <section className="panel mt-6 border-l-4 border-accent px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-caps">Monitoring status</p>
            <p className="text-sm font-medium">
              {monitoringLoading
                ? "Loading security activity and devices…"
                : monitoringError
                  ? "Monitoring needs attention"
                  : "Security activity and devices are being monitored"}
            </p>
            {monitoringError && (
              <p className="mt-1 text-xs text-destructive">{monitoringError.message}</p>
            )}
          </div>
          {monitoringError && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["security_events"] });
                void queryClient.invalidateQueries({ queryKey: ["devices"] });
                void queryClient.invalidateQueries({ queryKey: ["security_alerts"] });
              }}
            >
              Retry monitoring
            </Button>
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={ShieldCheck}
          label="Security score"
          value={`${score}/100`}
          hint={score >= 80 ? "Strong" : score >= 50 ? "Improve 2FA & devices" : "At risk"}
          tone={score >= 80 ? "success" : score >= 50 ? "warning" : "danger"}
        />
        <Stat
          icon={UserCheck}
          label="Two-step auth"
          value={mfa.data ? "Enabled" : "Disabled"}
          hint={mfa.data ? "Authenticator app" : "Turn it on in Security"}
          tone={mfa.data ? "success" : "danger"}
        />
        <Stat
          icon={Bell}
          label="Email verification"
          value={emailVerified.data ? "Verified" : "Pending"}
          tone={emailVerified.data ? "success" : "warning"}
        />
        <Stat
          icon={MapPin}
          label="Location monitoring"
          value={profile.data?.location_consent ? "Enabled" : "Off"}
          hint={profile.data?.last_location_label ?? "No consented location"}
          tone={profile.data?.location_consent ? "success" : "muted"}
        />
        <Stat icon={Smartphone} label="Registered devices" value={String(devices.data?.length ?? 0)} hint={`${trustedDevices} trusted`} />
        <Stat icon={Bell} label="Unread alerts" value={String(unread)} tone={unread ? "warning" : "success"} />
        <Stat
          icon={Globe2}
          label="Current IP"
          value={conn.data?.ip ?? "…"}
          hint={conn.data?.location ?? "Region unavailable"}
        />
        <Stat
          icon={Activity}
          label="Last event"
          value={events.data?.[0] ? prettyEvent(events.data[0].event_type) : "None"}
          hint={events.data?.[0] ? formatWhen(events.data[0].created_at) : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="panel">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">Registered devices</h2>
            <Link to="/user/devices" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {devices.isLoading && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                Loading devices…
              </li>
            )}
            {devices.isError && (
              <li className="px-5 py-8 text-center text-sm text-destructive">
                Could not load devices.
              </li>
            )}
            {!devices.isLoading &&
              !devices.isError &&
              (devices.data ?? []).slice(0, 6).map((d) => {
                const isCurrent = d.device_key === currentKey;
                return (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm"
                  >
                    <span className="font-medium">{d.device_name || "Device"}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.device_type ?? "Unknown"} · {d.browser ?? "—"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {d.last_ip ?? "—"}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {d.last_seen ? formatWhen(d.last_seen as string) : "—"}
                    </span>
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
                  </li>
                );
              })}
            {!devices.isLoading && !devices.isError && devices.data?.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                No devices registered yet.
              </li>
            )}
          </ul>
        </section>

        <section className="panel">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">Live security activity</h2>
            <Link to="/user/security/activity" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {events.isLoading && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                Loading activity…
              </li>
            )}
            {events.isError && (
              <li className="px-5 py-8 text-center text-sm text-destructive">
                Could not load security activity.
              </li>
            )}
            {!events.isLoading &&
              !events.isError &&
              (events.data ?? []).slice(0, 6).map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm"
                >
                  <span className="font-medium">{prettyEvent(e.event_type)}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {e.ip_address ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.device_type ?? "Unknown"} · {e.browser ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.location_label ?? "Unknown"}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatWhen(e.created_at)}
                  </span>
                  <RiskPill level={e.risk_level} />
                </li>
              ))}
            {!events.isLoading && !events.isError && events.data?.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                No security events recorded yet.
              </li>
            )}
          </ul>
        </section>
      </div>

      <AlertDialog open={confirmLock} onOpenChange={setConfirmLock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock this account?</AlertDialogTitle>
            <AlertDialogDescription>
              All sessions are terminated immediately and sign-in stays blocked until support
              restores access. Use this if you suspect unauthorised activity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => lockMutation.mutate()}>Lock account</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function LookupDetail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="label-caps">{label}</p>
      <p className={`mt-1 break-words text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
  value,
  detail,
  tone = "muted",
}: {
  to: "/user/security/location" | "/user/devices" | "/user/security/activity" | "/user/attendance";
  icon: typeof MapPin;
  label: string;
  value: string;
  detail: string;
  tone?: "success" | "warning" | "muted";
}) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-accent";
  return (
    <Link to={to} className="panel block p-5 transition-colors hover:border-accent/60 hover:bg-secondary/40">
      <div className="flex items-center gap-2">
        <Icon className={`size-5 ${color}`} />
        <span className="label-caps">{label}</span>
      </div>
      <p className="mt-4 text-lg font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      <span className="mt-4 inline-block text-xs font-medium text-accent">Open security view →</span>
    </Link>
  );
}

export function RiskPill({ level }: { level: string }) {
  const tone =
    level === "CRITICAL" || level === "HIGH"
      ? "bg-destructive/10 text-destructive"
      : level === "MEDIUM"
        ? "bg-warning/15 text-warning-foreground"
        : "bg-success/10 text-success";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${tone}`}>
      {level}
    </span>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone = "muted",
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: "success" | "warning" | "danger" | "muted";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${color}`} />
        <span className="label-caps">{label}</span>
      </div>
      <p className="mt-2 truncate text-lg font-semibold">{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
