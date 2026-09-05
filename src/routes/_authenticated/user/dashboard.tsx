import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Bell,
  Globe2,
  Lock,
  MapPin,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
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
import {
  getConnectionInfo,
  lockAccount,
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

  const conn = useQuery({ queryKey: ["conn"], queryFn: () => getConnectionInfo() });

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
          <Button variant="outline" onClick={() => terminateMutation.mutate()} disabled={terminateMutation.isPending}>
            Sign out other sessions
          </Button>
          <Button variant="destructive" onClick={() => setConfirmLock(true)}>
            <Lock className="mr-2 size-4" /> Lock account
          </Button>
        </div>
      </div>

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

      <section className="panel mt-6">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Live security activity</h2>
          <Link to="/user/security/activity" className="text-xs text-accent hover:underline">
            View all
          </Link>
        </div>
        <ul className="divide-y divide-border">
          {(events.data ?? []).slice(0, 6).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <span className="font-medium">{prettyEvent(e.event_type)}</span>
              <span className="font-mono text-xs text-muted-foreground">{e.ip_address ?? "—"}</span>
              <span className="text-xs text-muted-foreground">
                {e.device_type ?? "Unknown"} · {e.browser ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground">{e.location_label ?? "Unknown"}</span>
              <span className="ml-auto text-xs text-muted-foreground">{formatWhen(e.created_at)}</span>
              <RiskPill level={e.risk_level} />
            </li>
          ))}
          {events.data?.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No security events recorded yet.
            </li>
          )}
        </ul>
      </section>

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
