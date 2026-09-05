import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/device";
import { recordSecurityEvent } from "@/lib/security.functions";
import { useAlerts } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/user/security/")({
  head: () => ({
    meta: [
      { title: "Security Settings — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Enable two-step authentication and change your account password.",
      },
      { property: "og:title", content: "Security Settings" },
      { property: "og:description", content: "Two-step authentication and password controls." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SecuritySettings,
});

function SecuritySettings() {
  const alerts = useAlerts();
  const queryClient = useQueryClient();
  const unread = (alerts.data ?? []).filter((a) => !a.read).length;
  const eventFn = useServerFn(recordSecurityEvent);

  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const factors = useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp ?? [];
    },
  });

  const verified = (factors.data ?? []).filter((f) => f.status === "verified");

  const startEnroll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) =>
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret }),
    onError: (e: Error) => toast.error("Could not start enrolment", { description: e.message }),
  });

  const confirmEnroll = useMutation({
    mutationFn: async () => {
      if (!enroll) throw new Error("No enrolment in progress");
      const challenge = await supabase.auth.mfa.challenge({ factorId: enroll.id });
      if (challenge.error) throw challenge.error;
      const { error } = await supabase.auth.mfa.verify({
        factorId: enroll.id,
        challengeId: challenge.data.id,
        code,
      });
      if (error) throw error;
      await eventFn({
        data: { eventType: "MFA_ENABLED", device: getDeviceInfo() },
      }).catch(() => undefined);
    },
    onSuccess: () => {
      toast.success("Two-step authentication enabled");
      setEnroll(null);
      setCode("");
      void queryClient.invalidateQueries({ queryKey: ["mfa-factors"] });
      void queryClient.invalidateQueries({ queryKey: ["mfa"] });
    },
    onError: (e: Error) => toast.error("Invalid code", { description: e.message }),
  });

  const disableMfa = useMutation({
    mutationFn: async (factorId: string) => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      await eventFn({
        data: { eventType: "MFA_DISABLED", device: getDeviceInfo() },
      }).catch(() => undefined);
    },
    onSuccess: () => {
      toast.success("Two-step authentication removed");
      void queryClient.invalidateQueries({ queryKey: ["mfa-factors"] });
      void queryClient.invalidateQueries({ queryKey: ["mfa"] });
    },
    onError: (e: Error) => toast.error("Could not disable", { description: e.message }),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      if (newPassword.length < 10) throw new Error("Use at least 10 characters.");
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        // Signed-in changes require the current password.
        ...({ current_password: currentPassword } as Record<string, string>),
      });
      if (error) throw error;
      await eventFn({
        data: { eventType: "PASSWORD_CHANGED", device: getDeviceInfo() },
      }).catch(() => undefined);
    },
    onSuccess: () => {
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
    },
    onError: (e: Error) => toast.error("Password not changed", { description: e.message }),
  });

  return (
    <AppShell unread={unread}>
      <p className="label-caps">Account protection</p>
      <h1 className="text-2xl font-semibold">Security settings</h1>

      <section className="panel mt-6 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-accent" />
          <h2 className="font-semibold">Two-step authentication</h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Require a time-based code from your authenticator app at every sign-in.
        </p>

        {verified.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
              ENABLED
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => disableMfa.mutate(verified[0]!.id)}
              disabled={disableMfa.isPending}
            >
              Turn off
            </Button>
          </div>
        ) : enroll ? (
          <div className="mt-4 max-w-sm space-y-3">
            <img src={enroll.qr} alt="Authenticator QR code" className="size-48 rounded-md border border-border bg-white" />
            <p className="break-all font-mono text-xs text-muted-foreground">{enroll.secret}</p>
            <div className="space-y-1.5">
              <Label htmlFor="totp">6-digit code</Label>
              <Input
                id="totp"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => confirmEnroll.mutate()} disabled={confirmEnroll.isPending}>
                Verify & enable
              </Button>
              <Button variant="ghost" onClick={() => setEnroll(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button className="mt-4" onClick={() => startEnroll.mutate()} disabled={startEnroll.isPending}>
            Enable two-step authentication
          </Button>
        )}
      </section>

      <section className="panel mt-6 p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-accent" />
          <h2 className="font-semibold">Change password</h2>
        </div>
        <div className="mt-4 grid max-w-sm gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cur">Current password</Label>
            <Input
              id="cur"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">New password</Label>
            <Input
              id="new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <Button
            className="justify-self-start"
            onClick={() => changePassword.mutate()}
            disabled={changePassword.isPending}
          >
            Update password
          </Button>
        </div>
      </section>
    </AppShell>
  );
}
