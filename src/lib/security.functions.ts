import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Utility server function to report whether SMTP/Gmail credentials are available
export const isSmtpConfigured = createServerFn({ method: "POST" }).handler(async () => {
  const smtpUser = process.env["SMTP_USER"] || process.env["GMAIL_USER"] || process.env["ADMIN_EMAIL"];
  const smtpPass = process.env["SMTP_PASS"] || process.env["GMAIL_APP_PASSWORD"];
  return { configured: Boolean(smtpUser && smtpPass) };
});

// Save local SMTP (development) config to .env.local — convenience helper for local testing only.
export const saveLocalSmtpConfig = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        gmailUser: z.string().trim().email(),
        appPassword: z.string().trim().min(16).max(128),
        smtpHost: z.string().trim().optional(),
        smtpPort: z.string().trim().optional(),
        emailFrom: z.string().trim().optional(),
        adminEmail: z.string().trim().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // This helper is intended for local development only. It writes a .env.local file
    // in the project root so the dev server picks up SMTP credentials. Do NOT use in
    // production.
    const fs = await import("fs/promises");
    const pathMod = await import("path");
    const root = process.cwd();
    const envPath = pathMod.join(root, ".env.local");

    const lines = [] as string[];
    lines.push(`GMAIL_USER=${data.gmailUser}`);
    lines.push(`GMAIL_APP_PASSWORD=${data.appPassword}`);
    lines.push(`SMTP_HOST=${data.smtpHost ?? "smtp.gmail.com"}`);
    lines.push(`SMTP_PORT=${data.smtpPort ?? "465"}`);
    if (data.emailFrom) lines.push(`EMAIL_FROM=${data.emailFrom}`);
    if (data.adminEmail) lines.push(`ADMIN_EMAIL=${data.adminEmail}`);

    const content = lines.join("\n") + "\n";
    await fs.writeFile(envPath, content, { encoding: "utf8", flag: "w" });
    return { ok: true, path: envPath };
  });

/** Server-observed client IP with fallback to public external IP detection for local environments. */
function clientIp(): string {
  const req = getRequest();
  const h = req?.headers;
  if (!h) return "unknown";
  const candidates = [
    h.get("cf-connecting-ip"),
    h.get("true-client-ip"),
    h.get("x-client-ip"),
    h.get("x-real-ip"),
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim(),
    h.get("forwarded")?.match(/for=(?:"?)(\[[^\]]+\]|[^;,\s"]+)/i)?.[1],
  ];
  const ip = candidates.find((v) => v && v.length > 0);
  return ip ?? "unknown";
}

function clientUserAgent(): string {
  return getRequest()?.headers.get("user-agent") ?? "unknown";
}

type GeoInfo = {
  label: string | null;
  lat: number | null;
  lng: number | null;
  city?: string | null;
  country?: string | null;
};

async function resolvePublicIpAndGeo(providedIp?: string | null): Promise<{ ip: string; geo: GeoInfo }> {
  let ip =
    providedIp &&
    providedIp !== "unknown" &&
    !providedIp.startsWith("127.") &&
    !providedIp.startsWith("::1") &&
    !providedIp.startsWith("192.168.") &&
    !providedIp.startsWith("10.")
      ? providedIp
      : "";

  if (!ip) {
    try {
      const res = await fetch("https://api64.ipify.org?format=json", {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      const data = (await res.json()) as { ip?: string };
      if (data?.ip) ip = data.ip;
    } catch {}
  }

  if (!ip) ip = "127.0.0.1";

  let label: string | null = null;
  let lat: number | null = null;
  let lng: number | null = null;
  let city: string | null = null;
  let country: string | null = null;

  if (ip !== "127.0.0.1" && ip !== "unknown") {
    try {
      const geoRes = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      });
      const j = (await geoRes.json()) as any;
      if (j && j.success) {
        city = j.city ?? null;
        country = j.country ?? null;
        const parts = [j.city, j.region, j.country].filter(Boolean);
        label = parts.length ? parts.join(", ") : null;
        lat = typeof j.latitude === "number" ? j.latitude : null;
        lng = typeof j.longitude === "number" ? j.longitude : null;
      }
    } catch {}

    if (!label) {
      try {
        const freeRes = await fetch(`https://freeipapi.com/api/json/${encodeURIComponent(ip)}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        });
        const j2 = (await freeRes.json()) as any;
        if (j2 && (j2.cityName || j2.countryName)) {
          city = j2.cityName ?? null;
          country = j2.countryName ?? null;
          const parts = [j2.cityName, j2.regionName, j2.countryName].filter(Boolean);
          label = parts.length ? parts.join(", ") : null;
          lat = typeof j2.latitude === "number" ? j2.latitude : null;
          lng = typeof j2.longitude === "number" ? j2.longitude : null;
        }
      } catch {}
    }
  }

  return { ip, geo: { label, lat, lng, city, country } };
}

async function geoFromIp(ip: string): Promise<GeoInfo> {
  const resolved = await resolvePublicIpAndGeo(ip);
  return resolved.geo;
}

function isPublicIp(ip: string): boolean {
  if (ip.includes(".")) {
    const octets = ip.split(".").map(Number);
    if (
      octets.length !== 4 ||
      octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) {
      return false;
    }
    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;
    return (
      first !== 0 &&
      first !== 10 &&
      first !== 127 &&
      first < 224 &&
      !(first === 169 && second === 254) &&
      !(first === 172 && second >= 16 && second <= 31) &&
      !(first === 192 && second === 168)
    );
  }

  const normalized = ip.toLowerCase();
  return (
    normalized.includes(":") &&
    normalized !== "::1" &&
    !normalized.startsWith("fc") &&
    !normalized.startsWith("fd") &&
    !normalized.startsWith("fe80:")
  );
}

const ipLookupInput = z.object({
  ip: z
    .string()
    .trim()
    .min(3)
    .max(45)
    .refine(isPublicIp, "Enter a valid public IPv4 or IPv6 address."),
});

const mobileLookupInput = z.object({
  mobile: z.string().trim().min(6).max(20),
});

const mobileConsentInput = z.object({
  mobile: z.string().trim().min(6).max(20),
});

const mobileApprovalInput = z.object({
  token: z.string().trim().min(32).max(128),
});

const forgotPasswordOtpInput = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

const resetPasswordWithOtpInput = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit code"),
  password: z.string().min(12, "Use at least 12 characters"),
});

const attendanceChangeInput = z.object({
  action: z.enum(["modified", "deleted"]),
  attendance: z.object({
    name: z.string().trim().min(1).max(160),
    rollNumber: z.string().trim().min(1).max(80),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["Present", "Late", "Absent", "Leave"]),
    ipAddress: z.string().trim().min(1).max(80),
  }),
});

const welcomeEmailInput = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  fullName: z.string().trim().optional(),
});

const registrationOtpInput = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  fullName: z.string().trim().optional(),
});

const verifyRegistrationOtpInput = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit code"),
});

function normalizeMobile(value: string): string {
  return value.replace(/\D/g, "");
}

function createVerificationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashVerificationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function appOrigin(): string {
  const request = getRequest();
  const configured = process.env["VITE_APP_URL"] ?? process.env["APP_URL"];
  if (configured) return configured.replace(/\/$/, "");
  const origin = request?.headers.get("origin");
  if (origin) return origin;
  const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
  const protocol = request?.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

/** Sends a one-time approval link to the signed-in account email. */
export const sendMobileTrackingConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => mobileConsentInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile?.email) throw new Error("No email is available for this account.");

    const apiKey = process.env["RESEND_API_KEY"];
    const from = process.env["SUPPORT_FROM_EMAIL"];
    if (!apiKey || !from) {
      throw new Error(
        "Email verification is not configured. Add RESEND_API_KEY and SUPPORT_FROM_EMAIL.",
      );
    }

    const token = createVerificationToken();
    const tokenHash = await hashVerificationToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: insertError } = await supabaseAdmin.from("mobile_tracking_requests").insert({
      requester_id: context.userId,
      mobile: data.mobile,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (insertError) throw new Error(insertError.message);

    const link = `${appOrigin()}/mobile-consent?token=${encodeURIComponent(token)}`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [profile.email],
        subject: "Approve mobile security tracking",
        text: `A mobile tracking request was created for ${data.mobile}. Approve it here within 15 minutes:\n\n${link}\n\nIf you did not request this, ignore this email.`,
      }),
    });
    if (!response.ok) throw new Error("The verification email could not be sent.");
    return { sentTo: profile.email, expiresAt };
  });

/** Approves a consent token from the email link without requiring an existing session. */
export const approveMobileTrackingConsent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => mobileApprovalInput.parse(d))
  .handler(async ({ data }) => {
    const tokenHash = await hashVerificationToken(data.token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: request, error: requestError } = await supabaseAdmin
      .from("mobile_tracking_requests")
      .select("id, expires_at, status")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request || request.status !== "pending")
      throw new Error("This verification link is invalid or already used.");
    if (new Date(request.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin
        .from("mobile_tracking_requests")
        .update({ status: "expired" })
        .eq("id", request.id);
      throw new Error("This verification link has expired. Request a new one.");
    }

    const { error: updateError } = await supabaseAdmin
      .from("mobile_tracking_requests")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", request.id)
      .eq("status", "pending");
    if (updateError) throw new Error(updateError.message);
    return { approved: true };
  });

// Resilient OTP store backed by globalThis + local disk persistence
interface StoredOtpRecord {
  tokenHash: string;
  expiresAt: number;
  attempts: number;
}

declare global {
  var __sentinel_otp_memory_cache: Map<string, StoredOtpRecord> | undefined;
}

const memoryOtpCache: Map<string, StoredOtpRecord> =
  globalThis.__sentinel_otp_memory_cache ??
  (globalThis.__sentinel_otp_memory_cache = new Map<string, StoredOtpRecord>());

async function saveOtpRecord(key: string, record: StoredOtpRecord): Promise<void> {
  memoryOtpCache.set(key, record);
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(process.cwd(), ".otp-storage.json");
    let stored: Record<string, StoredOtpRecord> = {};
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      stored = JSON.parse(raw);
    } catch {}
    stored[key] = record;
    await fs.writeFile(filePath, JSON.stringify(stored, null, 2), "utf-8");
  } catch (err) {
    console.warn("[OTP] Could not persist to disk:", err);
  }
}

async function loadOtpRecord(key: string): Promise<StoredOtpRecord | undefined> {
  const inMem = memoryOtpCache.get(key);
  if (inMem) return inMem;
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(process.cwd(), ".otp-storage.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const stored = JSON.parse(raw) as Record<string, StoredOtpRecord>;
    const rec = stored[key];
    if (rec) {
      memoryOtpCache.set(key, rec);
      return rec;
    }
  } catch {}
  return undefined;
}

async function removeOtpRecord(key: string): Promise<void> {
  memoryOtpCache.delete(key);
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(process.cwd(), ".otp-storage.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const stored = JSON.parse(raw) as Record<string, StoredOtpRecord>;
    delete stored[key];
    await fs.writeFile(filePath, JSON.stringify(stored, null, 2), "utf-8");
  } catch {}
}

/** Generates a secure 6-digit OTP, stores its hash, and dispatches it via email */
export const sendForgotPasswordOtp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => forgotPasswordOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();

    // Generate random 6-digit OTP
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const otp = String(100000 + ((array[0] || 0) % 900000));

    const tokenHash = await hashVerificationToken(`${normalizedEmail}:${otp}`);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP in persistent cache (globalThis + disk)
    await saveOtpRecord(`forgot:${normalizedEmail}`, {
      tokenHash,
      expiresAt,
      attempts: 0,
    });

    // Also attempt to store in Supabase if service key is present, but never fail if not
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (profile?.id) {
        await supabaseAdmin
          .from("mobile_tracking_requests")
          .update({ status: "expired" })
          .eq("requester_id", profile.id)
          .eq("mobile", `otp:${normalizedEmail}`)
          .eq("status", "pending");

        await supabaseAdmin.from("mobile_tracking_requests").insert({
          requester_id: profile.id,
          mobile: `otp:${normalizedEmail}`,
          token_hash: tokenHash,
          expires_at: new Date(expiresAt).toISOString(),
        });
      }
    } catch {
      // Ignored: service role key is not required for custom email server
    }

    // Dispatch OTP via multi-channel notification mailer (SMTP / Resend / Brevo / Cloudflare)
    const { sendNotificationEmail } = await import("@/lib/mailer.server");
    const mailResult = await sendNotificationEmail({
      to: normalizedEmail,
      subject: "Your Password Reset OTP - Sentinel Security",
      text: `Hello,\n\nA password reset request was initiated for your Sentinel account.\n\nYour One-Time Password (OTP) code is:\n\n${otp}\n\nThis code is valid for 5 minutes. Do NOT share this code with anyone.\n\nRegards,\nSentinel Security Team`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
          <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Password Reset Verification</h2>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">A password reset request was initiated for your Sentinel account.</p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
            <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7280; margin-bottom: 6px;">One-Time Verification Code</div>
            <div style="font-family: monospace; font-size: 32px; font-weight: 700; letter-spacing: 0.3em; color: #1e40af;">${otp}</div>
          </div>
          <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">This code will expire in <strong>5 minutes</strong>. Do not share this code with anyone.</p>
          <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Sentinel Security Notification System</p>
        </div>
      `,
    });

    return {
      sent: true,
      delivered: mailResult.success,
      provider: mailResult.provider,
      error: mailResult.error,
    };
  });

/** Dispatches a welcome email notification to newly registered users */
export const sendWelcomeRegistrationEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => welcomeEmailInput.parse(d))
  .handler(async ({ data }) => {
    const { sendNotificationEmail } = await import("@/lib/mailer.server");
    const name = data.fullName?.trim() || "there";
    const subject = "Welcome to Sentinel Security - Account Created";
    const text = `Hello ${name},\n\nYour Sentinel Security account has been successfully created for ${data.email}.\n\nYou can now sign in to your dashboard.\n\nBest regards,\nSentinel Security Team`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
        <h2 style="color: #111827; margin-top: 0;">Welcome to Sentinel Security!</h2>
        <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">Hello <strong>${name}</strong>,</p>
        <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">Your Sentinel Security account has been successfully created for <strong>${data.email}</strong>.</p>
        <div style="margin: 20px 0; padding: 14px 18px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; color: #166534; font-size: 14px;">
          ✓ Your account registration is complete and ready to use.
        </div>
        <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">You can now sign in to access your security dashboard and manage your account.</p>
        <p style="color: #6b7280; font-size: 12px;">If you did not create this account, please contact our security team immediately.</p>
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Sentinel Security Notification System</p>
      </div>
    `;

    const mailResult = await sendNotificationEmail({
      to: data.email,
      subject,
      text,
      html,
    });

    return {
      sent: true,
      delivered: mailResult.success,
      provider: mailResult.provider,
      error: mailResult.error,
    };
  });

/** Generates and sends a 6-digit verification code to verify user email before creating their account */
export const sendRegistrationOtp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => registrationOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const name = data.fullName?.trim() || "User";

    // Generate secure random 6-digit OTP
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const otp = String(100000 + ((array[0] || 0) % 900000));

    const tokenHash = await hashVerificationToken(`register:${normalizedEmail}:${otp}`);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store in persistent cache
    await saveOtpRecord(`register:${normalizedEmail}`, {
      tokenHash,
      expiresAt,
      attempts: 0,
    });

    const { sendNotificationEmail } = await import("@/lib/mailer.server");
    const mailResult = await sendNotificationEmail({
      to: normalizedEmail,
      subject: `Your Registration Verification Code: ${otp} - Sentinel Security`,
      text: `Hello ${name},\n\nThank you for opening a Sentinel Security account.\n\nYour 6-digit registration verification code is:\n\n${otp}\n\nThis code will expire in 10 minutes. Enter this code to verify your email and activate your account.\n\nBest regards,\nSentinel Security Team`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
          <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Complete Your Registration</h2>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Hello <strong>${name}</strong>,</p>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Thank you for registering with Sentinel Security. Please enter the 6-digit verification code below to confirm your email and create your account:</p>
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #166534; margin-bottom: 6px;">Registration Verification Code</div>
            <div style="font-family: monospace; font-size: 34px; font-weight: 700; letter-spacing: 0.3em; color: #15803d;">${otp}</div>
          </div>
          <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">This code will expire in <strong>10 minutes</strong>. Do NOT share this code with anyone.</p>
          <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Sentinel Security Notification System</p>
        </div>
      `,
    });

    return {
      sent: true,
      delivered: mailResult.success,
      provider: mailResult.provider,
      error: mailResult.error,
    };
  });

/** Verifies the 6-digit OTP entered by the user before creating their account */
export const verifyRegistrationOtp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => verifyRegistrationOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const tokenHash = await hashVerificationToken(`register:${normalizedEmail}:${data.otp.trim()}`);

    const cached = await loadOtpRecord(`register:${normalizedEmail}`);
    if (!cached) {
      throw new Error("No verification code found. Please request a new code.");
    }
    if (cached.expiresAt <= Date.now()) {
      await removeOtpRecord(`register:${normalizedEmail}`);
      throw new Error("This verification code has expired. Please request a new code.");
    }
    if (cached.attempts >= 5) {
      await removeOtpRecord(`register:${normalizedEmail}`);
      throw new Error("Too many failed attempts. Please request a new code.");
    }
    if (cached.tokenHash !== tokenHash) {
      cached.attempts += 1;
      await saveOtpRecord(`register:${normalizedEmail}`, cached);
      throw new Error("Invalid 6-digit verification code. Please check your email.");
    }

    // OTP is valid! Remove from cache so it cannot be reused
    await removeOtpRecord(`register:${normalizedEmail}`);
    return { success: true };
  });

/** Verifies the 6-digit OTP and updates the user's password directly */
export const resetPasswordWithOtp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => resetPasswordWithOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const tokenHash = await hashVerificationToken(`${normalizedEmail}:${data.otp.trim()}`);

    // 1. Check persistent OTP cache (globalThis + disk)
    const cached = await loadOtpRecord(`forgot:${normalizedEmail}`);
    let verified = false;

    if (cached) {
      if (cached.expiresAt <= Date.now()) {
        await removeOtpRecord(`forgot:${normalizedEmail}`);
        throw new Error("This verification code has expired. Please request a new one.");
      }
      if (cached.attempts >= 5) {
        await removeOtpRecord(`forgot:${normalizedEmail}`);
        throw new Error("Too many failed attempts. Please request a new code.");
      }
      if (cached.tokenHash === tokenHash) {
        verified = true;
        await removeOtpRecord(`forgot:${normalizedEmail}`);
      } else {
        cached.attempts += 1;
        await saveOtpRecord(`forgot:${normalizedEmail}`, cached);
        throw new Error("Invalid 6-digit verification code. Please check your email.");
      }
    }

    // 2. If not verified in cache, check Supabase mobile_tracking_requests
    if (!verified) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: request } = await supabaseAdmin
          .from("mobile_tracking_requests")
          .select("id, requester_id, expires_at, status")
          .eq("mobile", `otp:${normalizedEmail}`)
          .eq("token_hash", tokenHash)
          .maybeSingle();

        if (request && request.status === "pending") {
          if (new Date(request.expires_at).getTime() <= Date.now()) {
            await supabaseAdmin
              .from("mobile_tracking_requests")
              .update({ status: "expired" })
              .eq("id", request.id);
            throw new Error("This code has expired. Please request a new one.");
          }
          await supabaseAdmin
            .from("mobile_tracking_requests")
            .update({ status: "approved", approved_at: new Date().toISOString() })
            .eq("id", request.id);
          verified = true;
        }
      } catch (e: any) {
        if (e?.message?.includes("expired")) throw e;
      }
    }

    if (!verified) {
      throw new Error("Invalid or expired 6-digit verification code.");
    }

    // 3. Update password via Supabase
    let updatedByServer = false;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Attempt 3a: Try the database RPC function (runs with SECURITY DEFINER privileges)
      try {
        const { data: rpcSuccess, error: rpcError } = await (supabaseAdmin as any).rpc("reset_user_password_by_email", {
          p_email: normalizedEmail,
          p_password: data.password,
        });
        if (!rpcError && rpcSuccess) {
          updatedByServer = true;
        }
      } catch {
        // RPC not applied yet
      }

      // Attempt 3b: Try admin API (works when SUPABASE_SERVICE_ROLE_KEY is configured in .env)
      if (!updatedByServer) {
        let targetUserId: string | null = null;
        try {
          const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
          const found = userList?.users?.find((u) => u.email?.toLowerCase() === normalizedEmail);
          if (found) targetUserId = found.id;
        } catch {}

        if (!targetUserId) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("email", normalizedEmail)
            .maybeSingle();
          if (profile?.id) targetUserId = profile.id;
        }

        if (targetUserId) {
          const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
            password: data.password,
          });

          if (!updateError) {
            updatedByServer = true;
            try {
              await supabaseAdmin.from("security_events").insert({
                user_id: targetUserId,
                event_type: "PASSWORD_CHANGED",
                ip_address: clientIp(),
                user_agent: clientUserAgent(),
                risk_score: 10,
                risk_level: "LOW",
                risk_reasons: ["Password reset via email OTP"],
                status: "Trusted",
                metadata: { source: "forgot_password_otp" },
              });
            } catch {
              // event log non-blocking
            }
          }
        }
      }

      if (updatedByServer) {
        // Send password change confirmation email via Gmail SMTP
        try {
          const { sendNotificationEmail } = await import("@/lib/mailer.server");
          await sendNotificationEmail({
            to: normalizedEmail,
            subject: "Your Sentinel password has been changed",
            text: `Hello,\n\nYour Sentinel Security account password was successfully changed.\n\nIf you did not make this change, contact us immediately.\n\nRegards,\nSentinel Security Team`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
                <h2 style="color: #111827; margin-top: 0;">Password Changed Successfully ✅</h2>
                <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Hello,</p>
                <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Your Sentinel Security account password for <strong>${normalizedEmail}</strong> has been successfully changed.</p>
                <div style="margin: 20px 0; padding: 14px 18px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; color: #991b1b; font-size: 14px;">
                  ⚠️ If you did not request this change, please contact our security team immediately.
                </div>
                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Sentinel Security Notification System</p>
              </div>
            `,
          });
        } catch {
          // Non-critical — confirmation email is optional
        }
      }
    } catch {
      console.warn("[Auth] Service role or RPC unavailable.");
    }

    // Return verified:true so the client knows OTP passed, and updatedByServer indicating if DB was updated
    return { success: true, verified: true, updatedByServer };
  });

/** Returns device records only when the number belongs to the signed-in user's profile. */
export const lookupMobileDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => mobileLookupInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("mobile, location_consent, last_location_label, last_location_at, last_lat, last_lng")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);

    if (!profile?.mobile || normalizeMobile(profile.mobile) !== normalizeMobile(data.mobile)) {
      throw new Error(
        "For privacy, mobile tracking is limited to your own verified account number.",
      );
    }

    const { data: approvedRequests, error: consentError } = await context.supabase
      .from("mobile_tracking_requests")
      .select("mobile, status, expires_at")
      .eq("requester_id", context.userId)
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(20);
    if (consentError) throw new Error(consentError.message);
    const hasConsent = (approvedRequests ?? []).some(
      (request) =>
        normalizeMobile(request.mobile) === normalizeMobile(data.mobile) &&
        new Date(request.expires_at).getTime() > Date.now(),
    );
    if (!hasConsent)
      throw new Error("Verify the consent link sent to your account email before tracking.");

    const { data: devices, error: devicesError } = await context.supabase
      .from("devices")
      .select("id, device_name, device_type, browser, os, last_ip, last_seen, trusted")
      .eq("user_id", context.userId)
      .order("last_seen", { ascending: false });
    if (devicesError) throw new Error(devicesError.message);

    return {
      devices: devices ?? [],
      location: profile.location_consent
        ? {
            label: profile.last_location_label,
            updatedAt: profile.last_location_at,
            latitude: profile.last_lat,
            longitude: profile.last_lng,
          }
        : null,
    };
  });

/** Looks up approximate public information for an IP without exposing the lookup service to the browser. */
export const lookupIpAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ipLookupInput.parse(d))
  .handler(async ({ data, context }) => {
    const ip = data.ip;
    let result: any = null;

    try {
      const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        result = await response.json();
      }
    } catch {}

    if (!result || result.success === false) {
      try {
        const response2 = await fetch(`https://freeipapi.com/api/json/${encodeURIComponent(ip)}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (response2.ok) {
          const j2 = await response2.json();
          result = {
            ip: j2.ipAddress || ip,
            city: j2.cityName,
            region: j2.regionName,
            country: j2.countryName,
            latitude: j2.latitude,
            longitude: j2.longitude,
            connection: { org: j2.isp },
            timezone: { id: j2.timeZone },
          };
        }
      } catch {}
    }

    if (!result) {
      throw new Error("This IP address could not be looked up right now.");
    }

    let matchingDevice: any = null;
    try {
      const { data: dev } = await context.supabase
        .from("devices")
        .select("device_name, device_type, browser, os")
        .eq("user_id", context.userId)
        .eq("last_ip", ip)
        .order("last_seen", { ascending: false })
        .limit(1)
        .maybeSingle();
      matchingDevice = dev;
    } catch {}

    const connection = result["connection"] as Record<string, unknown> | undefined;
    const timezone = result["timezone"] as Record<string, unknown> | undefined;
    const address = [result["city"], result["region"], result["country"]]
      .filter(Boolean)
      .join(", ");

    try {
      await context.supabase.from("security_events").insert({
        user_id: context.userId,
        event_type: "IP_LOOKUP",
        ip_address: ip,
        user_agent: clientUserAgent(),
        location_label: address || null,
        risk_score: 0,
        risk_level: "LOW",
        risk_reasons: [],
        status: "Trusted",
        metadata: { source: "ip_tracker", tracked_ip: ip },
      });
    } catch {}

    return {
      ip: typeof result["ip"] === "string" ? result["ip"] : ip,
      publicAddress: address || "Approximate location unavailable",
      latitude: typeof result["latitude"] === "number" ? result["latitude"] : null,
      longitude: typeof result["longitude"] === "number" ? result["longitude"] : null,
      deviceName: matchingDevice?.device_name ?? null,
      deviceType: matchingDevice?.device_type ?? null,
      browser: matchingDevice?.browser ?? null,
      os: matchingDevice?.os ?? null,
      organization: typeof connection?.["org"] === "string" ? connection["org"] : (typeof connection?.["isp"] === "string" ? connection["isp"] : null),
      timezone: typeof timezone?.["id"] === "string" ? timezone["id"] : (typeof timezone?.["utc"] === "string" ? timezone["utc"] : null),
    };
  });

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const parts = [j["city"] || j["locality"], j["principalSubdivision"], j["countryName"]].filter(
      Boolean,
    ) as string[];
    return parts.length ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

function levelFor(score: number): string {
  if (score >= 80) return "CRITICAL";
  if (score >= 55) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

const deviceSchema = z.object({
  deviceKey: z.string().min(4).max(128),
  deviceName: z.string().max(120).optional(),
  deviceType: z.string().max(40).optional(),
  browser: z.string().max(60).optional(),
  os: z.string().max(60).optional(),
});

const eventInput = z.object({
  eventType: z.enum([
    "LOGIN_SUCCESS",
    "LOGOUT",
    "IP_LOOKUP",
    "NEW_DEVICE",
    "PASSWORD_CHANGED",
    "MFA_ENABLED",
    "MFA_DISABLED",
    "LOCATION_PERMISSION_CHANGED",
    "LOCATION_UPDATE",
    "SUSPICIOUS_LOGIN",
    "ACCOUNT_LOCKED",
    "SESSIONS_TERMINATED",
    "SECURITY_ALERT",
    "PROFILE_UPDATED",
    "DEVICE_TRUSTED",
    "DEVICE_REMOVED",
  ]),
  device: deviceSchema,
  note: z.string().max(300).optional(),
});

/** Records a security event with server-derived IP, geo and risk score. */
export const recordSecurityEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => eventInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const userId = context.userId;
    const resolved = await resolvePublicIpAndGeo(clientIp());
    const ip = resolved.ip;
    const geo = resolved.geo;
    const ua = clientUserAgent();

    // Also update profile with latest location
    if (geo.label || geo.lat) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("profiles").update({
          last_lat: geo.lat,
          last_lng: geo.lng,
          last_location_label: geo.label,
          last_location_at: new Date().toISOString(),
          city: geo.city ?? null,
          country: geo.country ?? null,
        }).eq("id", userId);
      } catch {}
    }

    let recent: any[] = [];
    try {
      const { data: recData } = await supabase
        .from("security_events")
        .select("ip_address, location_label, created_at, event_type")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      recent = recData ?? [];
    } catch {}

    let existingDevice: any = null;
    try {
      const { data: devData } = await supabase
        .from("devices")
        .select("id, trusted")
        .eq("user_id", userId)
        .eq("device_key", data.device.deviceKey)
        .maybeSingle();
      existingDevice = devData;
    } catch {}

    const reasons: string[] = [];
    let score = 0;

    if (!existingDevice) {
      reasons.push("New device");
      score += 35;
    } else if (!existingDevice.trusted) {
      reasons.push("Untrusted device");
      score += 15;
    }

    const knownIps = new Set((recent ?? []).map((r) => r.ip_address).filter(Boolean) as string[]);
    if (ip !== "unknown" && knownIps.size > 0 && !knownIps.has(ip)) {
      reasons.push("New IP address");
      score += 20;
    }

    const knownPlaces = new Set(
      (recent ?? []).map((r) => r.location_label).filter(Boolean) as string[],
    );
    if (geo.label && knownPlaces.size > 0 && !knownPlaces.has(geo.label)) {
      reasons.push("Unusual geographic region");
      score += 25;
    }

    if (data.eventType === "SUSPICIOUS_LOGIN") {
      reasons.push("Reported as suspicious");
      score += 40;
    }

    score = Math.min(score, 100);
    const level = levelFor(score);
    const status = score >= 55 ? "Suspicious" : score >= 30 ? "Review" : "Trusted";

    let insertedId = "event-" + Date.now();
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: inserted, error } = await supabaseAdmin
        .from("security_events")
        .insert({
          user_id: userId,
          event_type: data.eventType,
          ip_address: ip,
          user_agent: ua,
          device_type: data.device.deviceType ?? null,
          browser: data.device.browser ?? null,
          os: data.device.os ?? null,
          location_label: geo.label,
          latitude: geo.lat,
          longitude: geo.lng,
          risk_score: score,
          risk_level: level,
          risk_reasons: reasons,
          status,
          metadata: data.note ? { note: data.note } : {},
        })
        .select("id")
        .single();
      if (inserted?.id) insertedId = inserted.id;
      if (error) console.warn("security_events insert notice:", error.message);
    } catch (e) {
      console.warn("security_events insert warning:", e);
    }

    // Upsert the device record if table exists
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("devices").upsert(
        {
          user_id: userId,
          device_key: data.device.deviceKey,
          device_name: data.device.deviceName ?? null,
          device_type: data.device.deviceType ?? null,
          browser: data.device.browser ?? null,
          os: data.device.os ?? null,
          last_ip: ip,
          last_seen: new Date().toISOString(),
        },
        { onConflict: "user_id,device_key" },
      );
    } catch {}

    // Raise an alert if table exists
    if (score >= 30 || !["LOGIN_SUCCESS", "LOGOUT"].includes(data.eventType)) {
      try {
        await supabase.from("security_alerts").insert({
          user_id: userId,
          title: titleFor(data.eventType, level),
          description: `${data.eventType.replaceAll("_", " ").toLowerCase()} • IP ${ip}${
            geo.label ? ` • ${geo.label}` : ""
          }${reasons.length ? ` • ${reasons.join(", ")}` : ""}`,
          severity: level,
          category: "security",
          event_id: insertedId,
        });
      } catch {}
    }

    try {
      await supabase.from("audit_logs").insert({
        actor_id: userId,
        actor_role: "user",
        action: data.eventType,
        resource: "security_events",
        ip_address: ip,
        result: "success",
      });
    } catch {}

    return {
      id: insertedId,
      ip,
      location: geo.label,
      riskScore: score,
      riskLevel: level,
      reasons,
      status,
      newDevice: !existingDevice,
    };
  });

function titleFor(eventType: string, level: string) {
  switch (eventType) {
    case "LOGIN_SUCCESS":
      return level === "LOW" ? "New login detected" : "Unrecognised login detected";
    case "LOGOUT":
      return "User signed out";
    case "IP_LOOKUP":
      return "IP address checked";
    case "NEW_DEVICE":
      return "New device signed in";
    case "PASSWORD_CHANGED":
      return "Your password was changed";
    case "MFA_ENABLED":
      return "Two-step authentication enabled";
    case "MFA_DISABLED":
      return "Two-step authentication disabled";
    case "LOCATION_PERMISSION_CHANGED":
      return "Location monitoring preference changed";
    case "LOCATION_UPDATE":
      return "Security location updated";
    case "SUSPICIOUS_LOGIN":
      return "Suspicious activity reported";
    case "ACCOUNT_LOCKED":
      return "Account locked";
    case "SESSIONS_TERMINATED":
      return "Other sessions were signed out";
    case "DEVICE_TRUSTED":
      return "Device trust changed";
    case "DEVICE_REMOVED":
      return "Device removed";
    default:
      return "Security event";
  }
}

/** Returns the server-observed IP and approximate region of the caller. */
export const getConnectionInfo = createServerFn({ method: "GET" }).handler(async () => {
  const resolved = await resolvePublicIpAndGeo(clientIp());
  return { ip: resolved.ip, location: resolved.geo.label, userAgent: clientUserAgent() };
});

/** Audits an attendance edit/removal and alerts the acting user plus all administrators. */
export const notifyAttendanceChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => attendanceChangeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: authData, error: authError } = await context.supabase.auth.getUser();
    if (authError || !authData.user) throw new Error("Could not identify the signed-in user.");

    const serverIp = clientIp();
    const ip = serverIp === "unknown" ? data.attendance.ipAddress : serverIp;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (rolesError) throw new Error(rolesError.message);

    const adminIds = (roles ?? []).map((role) => role.user_id);
    const { data: admins, error: adminsError } = adminIds.length
      ? await supabaseAdmin.from("profiles").select("email").in("id", adminIds)
      : { data: [], error: null };
    if (adminsError) throw new Error(adminsError.message);

    const recipients = Array.from(
      new Set(
        [authData.user.email, ...(admins ?? []).map((admin) => admin.email)]
          .filter((email): email is string => Boolean(email))
          .map((email) => email.toLowerCase()),
      ),
    );
    try {
      const { data: hasAdminRole } = await supabaseAdmin.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId,
        actor_role: hasAdminRole ? "admin" : "user",
        action: `ATTENDANCE_${data.action.toUpperCase()}`,
        resource: `attendance/${data.attendance.date}/${data.attendance.rollNumber}`,
        ip_address: ip,
        result: "success",
      });
    } catch {}

    const action = data.action === "modified" ? "modified" : "deleted";
    const actionLabel = action === "modified" ? "Modified ✏️" : "Deleted 🗑️";
    const actionColor = action === "modified" ? "#d97706" : "#dc2626";
    const actionBg   = action === "modified" ? "#fffbeb" : "#fef2f2";
    const actionBorder = action === "modified" ? "#fde68a" : "#fecaca";

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
        <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Attendance Record ${actionLabel}</h2>
        <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">An attendance record has been <strong>${action}</strong> in the Sentinel system.</p>
        <div style="background: ${actionBg}; border: 1px solid ${actionBorder}; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <table style="width:100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="color:#6b7280; padding: 4px 0; width:40%;">Name</td><td style="color:#111827; font-weight:600;">${data.attendance.name}</td></tr>
            <tr><td style="color:#6b7280; padding: 4px 0;">Roll Number</td><td style="color:#111827; font-weight:600;">${data.attendance.rollNumber}</td></tr>
            <tr><td style="color:#6b7280; padding: 4px 0;">Date</td><td style="color:#111827; font-weight:600;">${data.attendance.date}</td></tr>
            <tr><td style="color:#6b7280; padding: 4px 0;">Status</td><td style="color:${actionColor}; font-weight:600;">${data.attendance.status}</td></tr>
            <tr><td style="color:#6b7280; padding: 4px 0;">Note</td><td style="color:#111827;">${data.attendance.note || "—"}</td></tr>
            <tr><td style="color:#6b7280; padding: 4px 0;">IP Address</td><td style="color:#111827; font-family:monospace;">${ip}</td></tr>
          </table>
        </div>
        <p style="color:#6b7280; font-size:12px;">This change has been recorded in the Sentinel audit log.</p>
        <hr style="border:0; border-top:1px solid #e5e7eb; margin:20px 0;" />
        <p style="color:#9ca3af; font-size:12px; margin-bottom:0;">Sentinel Security Notification System</p>
      </div>
    `;

    // Send via Gmail SMTP (primary) → Resend fallback → Cloudflare Worker last resort
    const { sendNotificationEmail } = await import("@/lib/mailer.server");
    try {
      await sendNotificationEmail({
        to: recipients,
        subject: `[Sentinel] Attendance ${actionLabel} — ${data.attendance.name} (${data.attendance.date})`,
        text: `Attendance record ${action}.\n\nName: ${data.attendance.name}\nRoll Number: ${data.attendance.rollNumber}\nDate: ${data.attendance.date}\nStatus: ${data.attendance.status}\nNote: ${data.attendance.note || "—"}\nIP Address: ${ip}\n\nThis change has been recorded in the audit log.`,
        html: emailHtml,
      });
      return { delivered: true, ip };
    } catch (mailErr) {
      console.warn("[Attendance] Email notification failed:", mailErr);
    }

    return { delivered: false, ip };
  });

export const setLocationConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    let patch: Record<string, unknown> = {
      location_consent: data.enabled,
      location_consent_at: data.enabled ? now : null,
    };

    let resolvedGeo: any = null;
    if (data.enabled) {
      const resolved = await resolvePublicIpAndGeo(clientIp());
      resolvedGeo = resolved;
      if (resolved.geo.label || resolved.geo.lat) {
        patch = {
          ...patch,
          last_lat: resolved.geo.lat,
          last_lng: resolved.geo.lng,
          last_location_label: resolved.geo.label,
          last_location_at: now,
          city: resolved.geo.city ?? null,
          country: resolved.geo.country ?? null,
        };
      }
    } else {
      patch = {
        ...patch,
        last_lat: null,
        last_lng: null,
        last_location_label: null,
        last_location_at: null,
      };
    }

    await supabaseAdmin.from("profiles").update(patch).eq("id", context.userId);

    try {
      await supabaseAdmin.from("security_events").insert({
        user_id: context.userId,
        event_type: "LOCATION_PERMISSION_CHANGED",
        ip_address: resolvedGeo?.ip ?? clientIp(),
        location_label: resolvedGeo?.geo?.label ?? null,
        latitude: resolvedGeo?.geo?.lat ?? null,
        longitude: resolvedGeo?.geo?.lng ?? null,
        risk_score: 0,
        risk_level: "LOW",
        status: "Trusted",
        metadata: { enabled: data.enabled },
      });
    } catch {}

    try {
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId,
        actor_role: "user",
        action: data.enabled ? "USER_ENABLED_LOCATION_CONSENT" : "USER_DISABLED_LOCATION_CONSENT",
        resource: "profiles",
        ip_address: resolvedGeo?.ip ?? clientIp(),
        result: "success",
      });
    } catch {}

    return { ok: true, patch };
  });

export const submitLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const label = await reverseGeocode(data.latitude, data.longitude);
    const now = new Date().toISOString();
    const resolved = await resolvePublicIpAndGeo(clientIp());

    await supabaseAdmin
      .from("profiles")
      .update({
        location_consent: true,
        location_consent_at: now,
        last_lat: data.latitude,
        last_lng: data.longitude,
        last_location_label: label || resolved.geo.label,
        last_location_at: now,
      })
      .eq("id", context.userId);

    try {
      await supabaseAdmin.from("security_events").insert({
        user_id: context.userId,
        event_type: "LOCATION_UPDATE",
        ip_address: resolved.ip,
        user_agent: clientUserAgent(),
        location_label: label || resolved.geo.label,
        latitude: data.latitude,
        longitude: data.longitude,
        risk_score: 0,
        risk_level: "LOW",
        status: "Trusted",
        metadata: { source: "consented_device_location" },
      });
    } catch {}

    return { label: label || resolved.geo.label, updatedAt: now };
  });

export const lockAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      await supabaseAdmin.from("profiles").update({ account_locked: true }).eq("id", context.userId);
    } catch {}
    await supabaseAdmin.auth.admin.signOut(context.userId, "global").catch(() => undefined);
    try {
      await supabaseAdmin.from("security_events").insert({
        user_id: context.userId,
        event_type: "ACCOUNT_LOCKED",
        ip_address: clientIp(),
        user_agent: clientUserAgent(),
        risk_score: 90,
        risk_level: "CRITICAL",
        risk_reasons: ["User requested account lock"],
        status: "Locked",
      });
    } catch {}
    try {
      await supabaseAdmin.from("security_alerts").insert({
        user_id: context.userId,
        title: "Account locked",
        description: "You locked this account. Contact support to restore access.",
        severity: "CRITICAL",
      });
    } catch {}
    try {
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId,
        actor_role: "user",
        action: "USER_LOCKED_ACCOUNT",
        resource: "profiles",
        ip_address: clientIp(),
        result: "success",
      });
    } catch {}
    return { ok: true };
  });

export const terminateOtherSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.signOut(context.userId, "others");
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("security_events").insert({
      user_id: context.userId,
      event_type: "SESSIONS_TERMINATED",
      ip_address: clientIp(),
      user_agent: clientUserAgent(),
      risk_score: 10,
      risk_level: "LOW",
      status: "Trusted",
    });
    return { ok: true };
  });
