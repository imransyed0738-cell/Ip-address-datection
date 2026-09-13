export interface Env {
  ALLOWED_ORIGIN?: string;
  REGISTRATION_FROM_EMAIL?: string;
  RESEND_API_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_URL?: string;
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.ALLOWED_ORIGIN === "*" || !env.ALLOWED_ORIGIN ? "*" : env.ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function response(request: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request, env), "Content-Type": "application/json" },
  });
}

/**
 * Sends email using available providers:
 * 1. Resend API (if RESEND_API_KEY is configured)
 * 2. MailChannels API (free on Cloudflare Workers)
 */
async function sendEmail(
  env: Env,
  to: string[],
  subject: string,
  text: string,
  fromEmail?: string,
): Promise<{ success: boolean; error?: string }> {
  const from = fromEmail || env.REGISTRATION_FROM_EMAIL || "Sentinel Security <notifications@sentinel-security.org>";

  // 1. Resend if key exists
  if (env.RESEND_API_KEY) {
    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.REGISTRATION_FROM_EMAIL || "onboarding@resend.dev",
          to,
          subject,
          text,
        }),
      });

      if (resendRes.ok) {
        return { success: true };
      }
      console.warn("Resend email failed:", await resendRes.text());
    } catch (e: any) {
      console.warn("Resend request error:", e?.message);
    }
  }

  // 2. MailChannels (native to Cloudflare Workers)
  try {
    const personalizations = to.map((email) => ({
      to: [{ email: email.trim() }],
    }));

    const mcRes = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations,
        from: {
          email: "notifications@sentinel-security.org",
          name: "Sentinel Security",
        },
        subject,
        content: [{ type: "text/plain", value: text }],
      }),
    });

    if (mcRes.ok || mcRes.status === 202) {
      return { success: true };
    }
    const errText = await mcRes.text();
    console.warn("MailChannels error response:", mcRes.status, errText);
    return { success: false, error: `MailChannels status ${mcRes.status}: ${errText}` };
  } catch (err: any) {
    return { success: false, error: err?.message || "Mail transport error" };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== "*" && origin && origin !== env.ALLOWED_ORIGIN) {
      return response(request, env, { delivered: false, error: "Origin not allowed" }, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request, env) });
    if (request.method !== "POST") return response(request, env, { error: "Method not allowed" }, 405);

    let bodyJson: any = {};
    try {
      bodyJson = await request.json();
    } catch {
      bodyJson = {};
    }

    const authorization = request.headers.get("Authorization");
    const supabaseUrl = env.SUPABASE_URL || "https://c--560bc521-8c58-4581-9b02-3f0c74aaa16e-prod.lovable.cloud";
    const supabaseAnon = env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_9rEJ_BX_oo0FIN9tu4EekQ_RYQYbJxD";

    let authUserEmail: string | null = null;
    let authUserName: string = "there";

    // Verify token if provided
    if (authorization?.startsWith("Bearer ")) {
      try {
        const userResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
          headers: {
            apikey: supabaseAnon,
            Authorization: authorization,
          },
        });

        if (userResponse.ok) {
          const user = (await userResponse.json()) as {
            email?: string;
            user_metadata?: { full_name?: string };
          };
          if (user.email) {
            authUserEmail = user.email;
            authUserName = user.user_metadata?.full_name?.trim() || "there";
          }
        }
      } catch (err) {
        console.warn("User auth verification error:", err);
      }
    }

    // Determine recipients
    const explicitRecipients: string[] = Array.isArray(bodyJson.recipients)
      ? bodyJson.recipients.filter((e: unknown): e is string => typeof e === "string" && Boolean(e))
      : [];

    const targetEmails = Array.from(
      new Set([...(authUserEmail ? [authUserEmail] : []), ...explicitRecipients]),
    ).filter(Boolean);

    if (!targetEmails.length) {
      return response(request, env, { delivered: false, error: "No recipient email found" }, 400);
    }

    // ATTENDANCE MODIFICATION OR DELETION NOTIFICATION
    if (bodyJson.type === "attendance_change") {
      const action = bodyJson.action === "deleted" ? "deleted" : "modified";
      const att = bodyJson.attendance || {};
      const subject = `Notice: Attendance Record ${action.toUpperCase()} - Sentinel Security`;
      const text = `Hello,\n\nThis is an automated notification from Sentinel Security.\n\nYour attendance record has been ${action}.\n\nDetails:\n- Name: ${att.name || "N/A"}\n- Roll Number: ${att.rollNumber || "N/A"}\n- Date: ${att.date || "N/A"}\n- Status: ${att.status || "N/A"}\n- IP Address: ${att.ipAddress || "N/A"}\n- Note: ${att.note || "None"}\n\nTimestamp: ${new Date().toUTCString()}\n\nIf you did not make or authorize this change, please review your security dashboard or contact an administrator immediately.\n\nRegards,\nSentinel Security Team`;

      const result = await sendEmail(env, targetEmails, subject, text);
      return response(request, env, {
        delivered: result.success,
        recipients: targetEmails,
        error: result.error,
      });
    }

    // REGISTRATION WELCOME NOTIFICATION
    const regSubject = "Welcome to Sentinel Secure Banking";
    const regText = `Hello ${authUserName},\n\nYour Sentinel account has been successfully created for ${targetEmails[0]}.\n\nIf you did not create this account, please contact support immediately.\n\nSentinel Security Team`;

    const result = await sendEmail(env, targetEmails, regSubject, regText);
    return response(request, env, { delivered: result.success, recipients: targetEmails, error: result.error });
  },
};
