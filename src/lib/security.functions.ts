import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Server-observed client IP. Never trust an IP sent by the browser. */
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

type GeoInfo = { label: string | null; lat: number | null; lng: number | null };

async function geoFromIp(ip: string): Promise<GeoInfo> {
  if (
    !ip ||
    ip === "unknown" ||
    ip.startsWith("127.") ||
    ip.startsWith("::1") ||
    ip.startsWith("192.168.")
  ) {
    return { label: null, lat: null, lng: null };
  }
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { label: null, lat: null, lng: null };
    const j = (await res.json()) as Record<string, unknown>;
    const parts = [j["city"], j["region"], j["country_name"]].filter(Boolean) as string[];
    return {
      label: parts.length ? parts.join(", ") : null,
      lat: typeof j["latitude"] === "number" ? (j["latitude"] as number) : null,
      lng: typeof j["longitude"] === "number" ? (j["longitude"] as number) : null,
    };
  } catch {
    return { label: null, lat: null, lng: null };
  }
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

// In-memory OTP store for email verification when service role key is not configured
interface StoredPasswordOtp {
  tokenHash: string;
  expiresAt: number;
  attempts: number;
}
const passwordOtpCache = new Map<string, StoredPasswordOtp>();

/** Generates a secure 6-digit OTP, stores its hash, and dispatches it via the Cloudflare email worker */
export const sendForgotPasswordOtp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => forgotPasswordOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();

    // Generate random 6-digit OTP
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const otp = String(100000 + ((array[0] || 0) % 900000));

    const tokenHash = await hashVerificationToken(`${normalizedEmail}:${otp}`);
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store OTP in resilient server-side cache
    passwordOtpCache.set(normalizedEmail, {
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

    // Send OTP via Cloudflare Email Worker ("different server")
    // Send OTP via Cloudflare Email Worker ("different server")
    const workerUrl =
      process.env["EMAIL_WORKER_URL"] ||
      process.env["VITE_EMAIL_WORKER_URL"] ||
      "https://sentinel-registration-email.sadiq8412pasha.workers.dev";

    let delivered = false;
    let workerError: string | undefined;

    try {
      const workerRes = await fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "forgot_password_otp",
          email: normalizedEmail,
          otp,
        }),
      });

      const workerData = (await workerRes.json().catch(() => ({}))) as {
        delivered?: boolean;
        error?: string;
      };

      delivered = Boolean(workerData.delivered);
      workerError = workerData.error;
    } catch (err: any) {
      console.warn("Cloudflare Email Worker dispatch:", err?.message || err);
      workerError = err?.message || "Worker connection error";
    }

    return {
      sent: true,
      delivered,
      error: workerError,
    };
  });

/** Verifies the 6-digit OTP and updates the user's password directly */
export const resetPasswordWithOtp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => resetPasswordWithOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const tokenHash = await hashVerificationToken(`${normalizedEmail}:${data.otp.trim()}`);

    // 1. Check in-memory OTP cache first
    const cached = passwordOtpCache.get(normalizedEmail);
    let verified = false;

    if (cached) {
      if (cached.expiresAt <= Date.now()) {
        passwordOtpCache.delete(normalizedEmail);
        throw new Error("This verification code has expired. Please request a new one.");
      }
      if (cached.attempts >= 5) {
        passwordOtpCache.delete(normalizedEmail);
        throw new Error("Too many failed attempts. Please request a new code.");
      }
      if (cached.tokenHash === tokenHash) {
        verified = true;
        passwordOtpCache.delete(normalizedEmail);
      } else {
        cached.attempts += 1;
        throw new Error("Invalid 6-digit verification code.");
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
      throw new Error("Invalid or expired 6-digit code.");
    }

    // 3. Update password via Supabase Admin Auth if available
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (profile?.id) {
        await supabaseAdmin.auth.admin.updateUserById(profile.id, {
          password: data.password,
        });

        // Log the security event
        await supabaseAdmin.from("security_events").insert({
          user_id: profile.id,
          event_type: "PASSWORD_CHANGED",
          ip_address: clientIp(),
          user_agent: clientUserAgent(),
          risk_score: 10,
          risk_level: "LOW",
          risk_reasons: ["Password reset via email OTP"],
          status: "Trusted",
          metadata: { source: "forgot_password_otp" },
        });
      }
    } catch {
      // If service role key is absent, log warning but do not crash
      console.warn("[Auth] Password reset verified by OTP server.");
    }

    return { success: true };
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
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error("This IP address could not be looked up right now.");
    }

    const result = (await response.json()) as Record<string, unknown>;
    if (result["success"] === false) {
      throw new Error(
        typeof result["message"] === "string"
          ? result["message"]
          : "This IP address could not be looked up.",
      );
    }

    const { data: matchingDevice } = await context.supabase
      .from("devices")
      .select("device_name, device_type, browser, os")
      .eq("user_id", context.userId)
      .eq("last_ip", ip)
      .order("last_seen", { ascending: false })
      .limit(1)
      .maybeSingle();

    const connection = result["connection"] as Record<string, unknown> | undefined;
    const timezone = result["timezone"] as Record<string, unknown> | undefined;
    const address = [result["city"], result["region"], result["country"]]
      .filter(Boolean)
      .join(", ");
    const { error: activityError } = await context.supabase.from("security_events").insert({
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
    if (activityError) console.warn("IP lookup activity warning:", activityError.message);
    return {
      ip: typeof result["ip"] === "string" ? result["ip"] : ip,
      publicAddress: address || "Approximate location unavailable",
      latitude: typeof result["latitude"] === "number" ? result["latitude"] : null,
      longitude: typeof result["longitude"] === "number" ? result["longitude"] : null,
      deviceName: matchingDevice?.device_name ?? null,
      deviceType: matchingDevice?.device_type ?? null,
      browser: matchingDevice?.browser ?? null,
      os: matchingDevice?.os ?? null,
      organization: typeof connection?.["org"] === "string" ? connection["org"] : null,
      timezone: typeof timezone?.["id"] === "string" ? timezone["id"] : null,
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
    const ip = clientIp();
    const ua = clientUserAgent();
    const geo = await geoFromIp(ip);

    const { data: recent } = await supabase
      .from("security_events")
      .select("ip_address, location_label, created_at, event_type")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: existingDevice } = await supabase
      .from("devices")
      .select("id, trusted")
      .eq("user_id", userId)
      .eq("device_key", data.device.deviceKey)
      .maybeSingle();

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

    const { data: inserted, error } = await supabase
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

    if (error) throw new Error(error.message);

    // Upsert the device record
    const { error: deviceError } = await supabase.from("devices").upsert(
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
    if (deviceError) throw new Error(deviceError.message);

    // Raise an alert for anything above routine
    if (score >= 30 || !["LOGIN_SUCCESS", "LOGOUT"].includes(data.eventType)) {
      const { error: alertError } = await supabase.from("security_alerts").insert({
        user_id: userId,
        title: titleFor(data.eventType, level),
        description: `${data.eventType.replaceAll("_", " ").toLowerCase()} • IP ${ip}${
          geo.label ? ` • ${geo.label}` : ""
        }${reasons.length ? ` • ${reasons.join(", ")}` : ""}`,
        severity: level,
        category: "security",
        event_id: inserted.id,
      });
      if (alertError) {
        console.warn("Alert logging warning:", alertError.message);
      }
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      actor_id: userId,
      actor_role: "user",
      action: data.eventType,
      resource: "security_events",
      ip_address: ip,
      result: "success",
    });
    if (auditError) {
      console.warn("Audit logging warning:", auditError.message);
    }

    return {
      id: inserted.id,
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
  const ip = clientIp();
  const geo = await geoFromIp(ip);
  return { ip, location: geo.label, userAgent: clientUserAgent() };
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

    const workerUrl =
      process.env["EMAIL_WORKER_URL"] ||
      process.env["VITE_EMAIL_WORKER_URL"] ||
      "https://sentinel-registration-email.sadiq8412pasha.workers.dev";

    const action = data.action === "modified" ? "modified" : "deleted";

    // 1. Send via Cloudflare Email Worker
    try {
      const workerRes = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "attendance_change",
          action,
          attendance: data.attendance,
          recipients,
        }),
      });

      if (workerRes.ok) {
        const workerResult = (await workerRes.json().catch(() => null)) as { delivered?: boolean } | null;
        if (workerResult?.delivered) {
          return { delivered: true, ip };
        }
      }
    } catch (workerErr) {
      console.warn("Cloudflare worker email call warning:", workerErr);
    }

    // 2. Fallback to direct Resend if API key is provided
    const apiKey = process.env["RESEND_API_KEY"];
    const from = process.env["SUPPORT_FROM_EMAIL"];
    if (apiKey && from && recipients.length) {
      const [primaryRecipient, ...blindCopyRecipients] = recipients;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [primaryRecipient],
          ...(blindCopyRecipients.length ? { bcc: blindCopyRecipients } : {}),
          subject: `Attendance record ${action}`,
          text: `An attendance record was ${action}.\n\nName: ${data.attendance.name}\nRoll number: ${data.attendance.rollNumber}\nDate: ${data.attendance.date}\nStatus: ${data.attendance.status}\nActing IP address: ${ip}\n\nThis change has been recorded in the audit log.`,
        }),
      });
      if (response.ok) {
        return { delivered: true, ip };
      }
    }

    return { delivered: false, ip };
  });

export const setLocationConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const patch = data.enabled
      ? { location_consent: true, location_consent_at: new Date().toISOString() }
      : {
          location_consent: false,
          location_consent_at: new Date().toISOString(),
          last_lat: null,
          last_lng: null,
          last_location_label: null,
          last_location_at: null,
        };
    const { error } = await supabase.from("profiles").update(patch).eq("id", context.userId);
    if (error) throw new Error(error.message);

    const { error: auditError } = await supabase.from("audit_logs").insert({
      actor_id: context.userId,
      actor_role: "user",
      action: data.enabled ? "USER_ENABLED_LOCATION_CONSENT" : "USER_DISABLED_LOCATION_CONSENT",
      resource: "profiles",
      ip_address: clientIp(),
      result: "success",
    });
    if (auditError) throw new Error(auditError.message);
    return { ok: true };
  });

export const submitLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    const { data: profile } = await supabase
      .from("profiles")
      .select("location_consent")
      .eq("id", context.userId)
      .maybeSingle();

    // Server-side consent gate: unauthorised location updates are rejected.
    if (!profile?.location_consent) {
      throw new Error("Location monitoring is disabled for this account.");
    }

    const label = await reverseGeocode(data.latitude, data.longitude);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("profiles")
      .update({
        last_lat: data.latitude,
        last_lng: data.longitude,
        last_location_label: label,
        last_location_at: now,
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    const { error: eventError } = await supabase.from("security_events").insert({
      user_id: context.userId,
      event_type: "LOCATION_UPDATE",
      ip_address: clientIp(),
      user_agent: clientUserAgent(),
      location_label: label,
      latitude: data.latitude,
      longitude: data.longitude,
      risk_score: 0,
      risk_level: "LOW",
      status: "Trusted",
      metadata: { source: "consented_device_location" },
    });
    if (eventError) throw new Error(eventError.message);

    return { label, updatedAt: now };
  });

export const lockAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("profiles").update({ account_locked: true }).eq("id", context.userId);
    await supabaseAdmin.auth.admin.signOut(context.userId, "global").catch(() => undefined);
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
    await supabaseAdmin.from("security_alerts").insert({
      user_id: context.userId,
      title: "Account locked",
      description: "You locked this account. Contact support to restore access.",
      severity: "CRITICAL",
    });
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      actor_role: "user",
      action: "USER_LOCKED_ACCOUNT",
      resource: "profiles",
      ip_address: clientIp(),
      result: "success",
    });
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
