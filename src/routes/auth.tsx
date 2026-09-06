import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/device";
import { recordSecurityEvent } from "@/lib/security.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Sign in or open a Sentinel account with verified email and two-step protection.",
      },
      { property: "og:title", content: "Sign in — Sentinel Secure Banking" },
      { property: "og:description", content: "Secure sign-in with two-step authentication." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

const registerSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().email("Enter a valid email").max(255),
  mobile: z.string().trim().min(6, "Enter a valid mobile number").max(20),
  password: z
    .string()
    .min(12, "Use at least 12 characters")
    .regex(/[a-z]/, "Add a lowercase letter")
    .regex(/[A-Z]/, "Add an uppercase letter")
    .regex(/[0-9]/, "Add a number")
    .regex(/[^A-Za-z0-9]/, "Add a special character"),
  confirm: z.string(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  postal_code: z.string().trim().max(20).optional(),
});

async function afterSignIn() {
  const device = getDeviceInfo();
  try {
    const result = await recordSecurityEvent({
      data: { eventType: "LOGIN_SUCCESS", device },
    });
    if (result.riskScore >= 30) {
      toast.warning(`Login flagged: ${result.riskLevel}`, {
        description: result.reasons.join(", "),
      });
    }
  } catch {
    // event logging must never block sign-in
  }
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"idle" | "mfa">("idle");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error_description") ?? params.get("error");
    if (!oauthError) return;

    toast.error("Google sign-in failed", { description: oauthError.replace(/\+/g, " ") });
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("error");
    cleanUrl.searchParams.delete("error_code");
    cleanUrl.searchParams.delete("error_description");
    window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void supabase.auth.signOut();
    });
  }, []);

  async function continueAfterPassword() {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setMode("mfa");
        return;
      }
    }
    navigate({ to: "/user/dashboard", replace: true });
    void afterSignIn();
  }

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setLoginError(null);
    if (!email || !password) {
      setLoginError("Email and password are required.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setBusy(false);
      setLoginError(error.message);
      toast.error("Sign-in failed", { description: error.message });
      return;
    }
    setLoginError(null);
    await continueAfterPassword();
    setBusy(false);
  }

  async function handleMfa(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) {
      toast.error("Invalid code", { description: error.message });
      return;
    }
    navigate({ to: "/user/dashboard", replace: true });
    void afterSignIn();
  }

  async function handleRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    if (parsed.data.password !== parsed.data.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    const { full_name, email, password, mobile, address, city, state, country, postal_code } =
      parsed.data;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: { full_name, mobile, address, city, state, country, postal_code },
      },
    });
    setBusy(false);
    if (error) {
      const weakPassword = error.code === "weak_password" || /weak password|known to be weak|pwned/i.test(error.message);
      const rateLimited = /rate limit|after \d+ seconds/i.test(error.message);

      if (weakPassword) {
        toast.error("Password too weak", {
          description: "Use 12+ characters with upper and lowercase letters, a number, and a special character.",
        });
        return;
      }

      toast.error(rateLimited ? "Please wait a moment" : "Registration failed", {
        description: rateLimited
          ? "A confirmation email was already sent. Check your inbox before requesting another."
          : error.message,
      });
      if (rateLimited) {
        setPendingEmail(email);
        setResendIn(60);
      }
      return;
    }

    if (data.session) {
      await continueAfterPassword();
      return;
    }

    setPendingEmail(email);
    setResendIn(60);
  }

  async function resendConfirmation() {
    if (!pendingEmail || resendIn > 0) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: pendingEmail });
    setBusy(false);
    setResendIn(60);
    if (error) toast.error("Could not resend", { description: error.message });
    else toast.success("Confirmation email sent again");
  }

  async function handleForgot() {
    const email = window.prompt("Enter your registered email address");
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error("Could not send reset email", { description: error.message });
    else toast.success("If that address is registered, a reset link is on its way.");
  }

  if (pendingEmail) {
    return (
      <Screen>
        <div className="space-y-4 text-center">
          <h1 className="text-xl font-semibold">Account created — confirm your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to{" "}
            <span className="font-medium text-foreground">{pendingEmail}</span>. Open it to activate
            the account. Sign-in stays blocked until the address is confirmed.
          </p>
          <p className="text-xs text-muted-foreground">
            Nothing in your inbox? Check spam or promotions.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={resendConfirmation}
            disabled={busy || resendIn > 0}
          >
            {resendIn > 0 ? `Resend available in ${resendIn}s` : "Resend confirmation email"}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setPendingEmail(null)}>
            Back to sign in
          </Button>
        </div>
      </Screen>
    );
  }

  if (mode === "mfa") {
    return (
      <Screen>
        <form onSubmit={handleMfa} className="space-y-4">
          <h1 className="text-xl font-semibold">Two-step verification</h1>
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app.
          </p>
          <Input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="text-center font-mono text-lg tracking-[0.4em]"
          />
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Verify and continue"}
          </Button>
        </form>
      </Screen>
    );
  }

  return (
    <Screen>
      <Tabs defaultValue="login">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="login">Sign in</TabsTrigger>
          <TabsTrigger value="register">Register</TabsTrigger>
        </TabsList>

        <TabsContent value="login" className="mt-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <Field label="Email" name="email" type="email" autoComplete="email" required />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Checking…" : "Sign in securely"}
            </Button>
            {loginError && (
              <p role="alert" className="text-sm text-destructive">
                {loginError}
              </p>
            )}
          </form>
          <button
            type="button"
            onClick={handleForgot}
            className="mt-3 text-sm text-accent underline-offset-4 hover:underline"
          >
            Forgot password?
          </button>
        </TabsContent>

        <TabsContent value="register" className="mt-6">
          <form onSubmit={handleRegister} className="space-y-3">
            <Field label="Full name" name="full_name" required />
            <Field label="Email" name="email" type="email" autoComplete="email" required />
            <Field label="Mobile number" name="mobile" required />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Password" name="password" type="password" required />
              <Field label="Confirm password" name="confirm" type="password" required />
            </div>
            <Field label="Address" name="address" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="City" name="city" />
              <Field label="State" name="state" />
              <Field label="Country" name="country" />
              <Field label="Postal code" name="postal_code" />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </Button>
            <p className="text-xs text-muted-foreground">
              We record your IP address, device and security events to protect the account. Location
              monitoring stays off until you enable it.
            </p>
          </form>
        </TabsContent>
      </Tabs>

      <div className="mt-6">
        <Link to="/admin/login" className="block">
          <Button variant="secondary" className="w-full">
            Admin sign in
          </Button>
        </Link>
      </div>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-accent" />
          Sentinel Secure Banking
        </Link>
        <div className="panel p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  ...rest
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...rest} />
    </div>
  );
}
