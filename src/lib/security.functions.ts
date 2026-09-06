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
  if (!ip || ip === "unknown" || ip.startsWith("127.") || ip.startsWith("::1") || ip.startsWith("192.168.")) {
    return { label: null, lat: null, lng: null };
  }
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { label: null, lat: null, lng: null };
    const j = (await res.json()) as Record<string, unknown>;
    const parts = [j['city'], j['region'], j['country_name']].filter(Boolean) as string[];
    return {
      label: parts.length ? parts.join(", ") : null,
      lat: typeof j['latitude'] === "number" ? (j['latitude'] as number) : null,
      lng: typeof j['longitude'] === "number" ? (j['longitude'] as number) : null,
    };
  } catch {
    return { label: null, lat: null, lng: null };
  }
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const parts = [j['city'] || j['locality'], j['principalSubdivision'], j['countryName']].filter(
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
    if (score >= 30 || data.eventType !== "LOGIN_SUCCESS") {
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
      if (alertError) throw new Error(alertError.message);
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      actor_id: userId,
      actor_role: "user",
      action: data.eventType,
      resource: "security_events",
      ip_address: ip,
      result: "success",
    });
    if (auditError) throw new Error(auditError.message);

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
