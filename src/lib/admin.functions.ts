import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function clientIp(): string {
  const h = getRequest()?.headers;
  if (!h) return "unknown";
  const candidates = [
    h.get("cf-connecting-ip"),
    h.get("x-real-ip"),
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim(),
  ];
  return candidates.find((v) => v && v.length > 0) ?? "unknown";
}

function configuredAdminEmails(): string[] {
  const values = [
    import.meta.env?.VITE_ADMIN_EMAIL,
    process.env?.ADMIN_EMAIL,
    process.env?.VITE_ADMIN_EMAIL,
    "syedimranpasha012@gmail.com",
  ];

  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase()),
    ),
  );
}

async function ensureAdminRole(db: any, userId: string, email: string | null) {
  const { data: current, error: currentError } = await db.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });

  if (!currentError && current) return true;

  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  if (!configuredAdminEmails().includes(normalizedEmail)) return false;

  const { error: insertError } = await db.from("user_roles").upsert(
    { user_id: userId, role: "admin" },
    { onConflict: "user_id,role" },
  );

  if (insertError) {
    throw new Error(insertError.message || "Failed to grant administrator access.");
  }

  return true;
}

/** Server-side RBAC gate. Never trust a role claim sent by the browser. */
async function assertAdmin(context: { supabase: any; userId: string }) {
  const adminCheck = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });

  if (!adminCheck.error && adminCheck.data) return context.userId;

  const { data: userData, error: userError } = await context.supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Forbidden: administrator access required");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const granted = await ensureAdminRole(supabaseAdmin, context.userId, userData.user.email ?? null);
  if (!granted) throw new Error("Forbidden: administrator access required");

  return context.userId;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function writeAudit(
  db: any,
  actorId: string,
  action: string,
  resource: string,
  result = "success",
) {
  await db.from("audit_logs").insert({
    actor_id: actorId,
    actor_role: "admin",
    action,
    resource,
    ip_address: clientIp(),
    result,
  });
}

export function levelFor(score: number) {
  if (score >= 76) return "CRITICAL";
  if (score >= 51) return "HIGH";
  if (score >= 21) return "MEDIUM";
  return "LOW";
}

/** Am I an administrator? Answered by the server, used only for UI routing. */
export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: hasAdminRole, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!roleError && hasAdminRole) return { admin: true };

    const { data: userData } = await context.supabase.auth.getUser();
    const email = userData.user?.email ?? null;
    const db = await admin();
    return { admin: await ensureAdminRole(db, context.userId, email) };
  });

/** Explainable risk scoring from recent account activity. */
function scoreFromEvents(
  events: Array<{ event_type: string; ip_address: string | null; created_at: string }>,
  deviceCount: number,
) {
  const reasons: string[] = [];
  let score = 0;
  const now = Date.now();
  const recent = events.filter((e) => now - new Date(e.created_at).getTime() < 1000 * 60 * 60 * 24 * 7);

  const failed = recent.filter((e) => e.event_type === "LOGIN_FAILED").length;
  if (failed >= 3) {
    score += Math.min(30, failed * 4);
    reasons.push(`${failed} failed login attempts in the last 7 days`);
  }
  const suspicious = recent.filter((e) => e.event_type === "SUSPICIOUS_LOGIN").length;
  if (suspicious) {
    score += 25;
    reasons.push(`${suspicious} logins reported as suspicious`);
  }
  const newDevices = recent.filter((e) => e.event_type === "NEW_DEVICE").length;
  if (newDevices) {
    score += Math.min(20, newDevices * 10);
    reasons.push(`${newDevices} new device sign-in(s)`);
  }
  const resets = recent.filter((e) => e.event_type === "PASSWORD_CHANGED").length;
  if (resets >= 2) {
    score += 12;
    reasons.push(`Password changed ${resets} times recently`);
  }
  const mfaOff = recent.filter((e) => e.event_type === "MFA_DISABLED").length;
  if (mfaOff) {
    score += 15;
    reasons.push("Two-step authentication was disabled");
  }
  // Rapid IP changes inside 10 minutes
  const sorted = [...recent].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  let rapid = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (
      a.ip_address &&
      b.ip_address &&
      a.ip_address !== b.ip_address &&
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime() < 1000 * 60 * 10
    ) {
      rapid++;
    }
  }
  if (rapid) {
    score += Math.min(20, rapid * 7);
    reasons.push(`${rapid} rapid IP address change(s) within 10 minutes`);
  }
  if (deviceCount >= 4) {
    score += 8;
    reasons.push(`${deviceCount} registered devices`);
  }
  // Unusual hours (00:00–05:00 local server time)
  const odd = recent.filter((e) => {
    const h = new Date(e.created_at).getUTCHours();
    return e.event_type === "LOGIN_SUCCESS" && h >= 0 && h < 5;
  }).length;
  if (odd >= 2) {
    score += 8;
    reasons.push(`${odd} sign-ins at unusual hours`);
  }

  score = Math.min(100, score);
  if (!reasons.length) reasons.push("No unusual activity detected in the last 7 days");
  return { score, level: levelFor(score), reasons };
}

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const db = context.supabase;
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

    const [{ count: users }, { count: events24 }, { data: recent }, { data: locked }, { data: activeLogins }] =
      await Promise.all([
        db.from("profiles").select("id", { count: "exact", head: true }),
        db.from("security_events").select("id", { count: "exact", head: true }).gte("created_at", since),
        db
          .from("security_events")
          .select("id, user_id, event_type, ip_address, browser, os, location_label, risk_score, risk_level, status, created_at")
          .order("created_at", { ascending: false })
          .limit(40),
        db.from("profiles").select("id").eq("account_locked", true),
        db
          .from("security_events")
          .select("user_id, ip_address, location_label")
          .gte("created_at", since)
          .eq("event_type", "LOGIN_SUCCESS"),
      ]);

    const activeUsers = new Set((activeLogins ?? []).map((e: any) => e.user_id).filter(Boolean)).size;
    const uniqueIps = new Set((recent ?? []).map((e: any) => e.ip_address).filter(Boolean)).size;
    const geoRegions = new Set((recent ?? []).map((e: any) => e.location_label).filter(Boolean)).size;
    const highRisk = (recent ?? []).filter((e: any) => e.risk_score >= 51);
    return {
      users: users ?? 0,
      activeUsers,
      events24: events24 ?? 0,
      liveIpCount: uniqueIps,
      geoRegions,
      locked: (locked ?? []).length,
      highRiskCount: highRisk.length,
      recent: recent ?? [],
      highRisk,
    };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const db = context.supabase;
    const { data: mergedProfiles } = await db
      .from("profiles")
      .select(
        "id, full_name, email, account_locked, flagged_for_review, location_consent, last_location_label, last_location_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    const profiles = mergedProfiles ?? [];
    const ids = profiles.map((p: any) => p.id);
    const { data: events } = await db
      .from("security_events")
      .select("user_id, event_type, ip_address, risk_score, created_at")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false })
      .limit(1000);
    const { data: devices } = await db.from("devices").select("user_id");

    return profiles.map((p: any) => {
      const own = (events ?? []).filter((e: any) => e.user_id === p.id);
      const lastLogin = own.find((e: any) => e.event_type === "LOGIN_SUCCESS");
      const deviceCount = (devices ?? []).filter((d: any) => d.user_id === p.id).length;
      const risk = scoreFromEvents(own as any, deviceCount);
      return {
        ...p,
        deviceCount,
        lastLoginAt: lastLogin?.created_at ?? null,
        lastIp: own[0]?.ip_address ?? null,
        riskScore: risk.score,
        riskLevel: risk.level,
      };
    });
  });

export const adminUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const adminId = await assertAdmin(context as any);
    const db = await admin();
    const uid = data.userId;

    const [profile, events, devices, alerts, notes, assessments] = await Promise.all([
      db.from("profiles").select("*").eq("id", uid).maybeSingle(),
      db.from("security_events").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(200),
      db.from("devices").select("*").eq("user_id", uid).order("last_seen", { ascending: false }),
      db.from("security_alerts").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(50),
      db.from("admin_notes").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
      db
        .from("security_risk_assessments")
        .select("*")
        .eq("user_id", uid)
        .order("generated_at", { ascending: false })
        .limit(20),
    ]);

    const risk = scoreFromEvents((events.data ?? []) as any, (devices.data ?? []).length);
    await writeAudit(db, adminId, "ADMIN_VIEWED_USER_SECURITY", `profiles/${uid}`);

    return {
      profile: profile.data,
      events: events.data ?? [],
      devices: devices.data ?? [],
      alerts: alerts.data ?? [],
      notes: notes.data ?? [],
      assessments: assessments.data ?? [],
      risk,
    };
  });

const actionInput = z.object({
  userId: z.string().uuid(),
  action: z.enum([
    "LOCK",
    "UNLOCK",
    "FORCE_LOGOUT",
    "REQUIRE_PASSWORD_RESET",
    "FLAG_REVIEW",
    "RESOLVE_REVIEW",
    "ADD_NOTE",
    "GENERATE_RISK",
  ]),
  note: z.string().max(1000).optional(),
});

export const adminUserAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => actionInput.parse(d))
  .handler(async ({ data, context }) => {
    const adminId = await assertAdmin(context as any);
    const db = await admin();
    const uid = data.userId;

    switch (data.action) {
      case "LOCK": {
        await db.from("profiles").update({ account_locked: true }).eq("id", uid);
        await db.auth.admin.signOut(uid, "global").catch(() => undefined);
        await db.from("security_alerts").insert({
          user_id: uid,
          title: "Account locked by security team",
          description: "An administrator locked this account pending a security review.",
          severity: "CRITICAL",
        });
        break;
      }
      case "UNLOCK":
        await db.from("profiles").update({ account_locked: false }).eq("id", uid);
        break;
      case "FORCE_LOGOUT":
        await db.auth.admin.signOut(uid, "global").catch(() => undefined);
        break;
      case "REQUIRE_PASSWORD_RESET":
        await db.from("profiles").update({ require_password_reset: true }).eq("id", uid);
        await db.from("security_alerts").insert({
          user_id: uid,
          title: "Password reset required",
          description: "Your security team requires you to change your password.",
          severity: "HIGH",
        });
        break;
      case "FLAG_REVIEW":
        await db.from("profiles").update({ flagged_for_review: true }).eq("id", uid);
        break;
      case "RESOLVE_REVIEW":
        await db.from("profiles").update({ flagged_for_review: false }).eq("id", uid);
        await db
          .from("security_risk_assessments")
          .update({ review_status: "REVIEWED", reviewed_by_admin_id: adminId })
          .eq("user_id", uid)
          .eq("review_status", "PENDING");
        break;
      case "ADD_NOTE": {
        if (!data.note?.trim()) throw new Error("Note cannot be empty");
        await db.from("admin_notes").insert({ user_id: uid, admin_id: adminId, note: data.note.trim() });
        break;
      }
      case "GENERATE_RISK": {
        const { data: events } = await db
          .from("security_events")
          .select("event_type, ip_address, created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(200);
        const { data: devices } = await db.from("devices").select("id").eq("user_id", uid);
        const risk = scoreFromEvents((events ?? []) as any, (devices ?? []).length);
        await db.from("security_risk_assessments").insert({
          user_id: uid,
          score: risk.score,
          risk_level: risk.level,
          reasons: risk.reasons,
          review_status: risk.score >= 51 ? "PENDING" : "AUTO_CLEARED",
        });
        break;
      }
    }

    await writeAudit(db, adminId, `ADMIN_${data.action}`, `profiles/${uid}`);
    return { ok: true };
  });

export const adminSecurityEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ highRiskOnly: z.boolean().default(false) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const db = context.supabase;
    let q = db
      .from("security_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.highRiskOnly) q = q.gte("risk_score", 51);
    const { data: events } = await q;
    const ids = Array.from(new Set((events ?? []).map((e: any) => e.user_id).filter(Boolean)));
    const { data: profiles } = await db
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    return (events ?? []).map((e: any) => ({
      ...e,
      user: map.get(e.user_id) ?? null,
    }));
  });

export const adminAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const db = context.supabase;
    const { data } = await db
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(150);
    return data ?? [];
  });
