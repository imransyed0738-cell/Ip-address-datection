export interface Env {
  ALLOWED_ORIGIN?: string;
  REGISTRATION_FROM_EMAIL?: string;
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
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
 * Sends email using available providers on the Cloudflare Worker:
 * 1. Resend API (if RESEND_API_KEY is configured)
 * 2. Brevo API (if BREVO_API_KEY is configured)
 */
async function sendEmail(
  env: Env,
  to: string[],
  subject: string,
  text: string,
  html?: string,
  fromEmail?: string,
): Promise<{ success: boolean; error?: string }> {
  // 1. Resend API
  if (env.RESEND_API_KEY) {
    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail || env.REGISTRATION_FROM_EMAIL || "Sentinel Security <onboarding@resend.dev>",
          to,
          subject,
          text,
          ...(html ? { html } : {}),
        }),
      });

      if (resendRes.ok) {
        return { success: true };
      }
      const errText = await resendRes.text();
      console.warn("Resend email failed:", errText);
      return { success: false, error: `Resend error: ${errText}` };
    } catch (e: any) {
      console.warn("Resend request error:", e?.message);
      return { success: false, error: e?.message || "Resend network error" };
    }
  }

  // 2. Brevo API
  if (env.BREVO_API_KEY) {
    try {
      const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: "Sentinel Security",
            email: env.REGISTRATION_FROM_EMAIL || "notifications@sentinel-security.org",
          },
          to: to.map((email) => ({ email: email.trim() })),
          subject,
          textContent: text,
          ...(html ? { htmlContent: html } : {}),
        }),
      });

      if (brevoRes.ok) {
        return { success: true };
      }
      const errText = await brevoRes.text();
      console.warn("Brevo email failed:", errText);
      return { success: false, error: `Brevo error: ${errText}` };
    } catch (e: any) {
      console.warn("Brevo request error:", e?.message);
      return { success: false, error: e?.message || "Brevo network error" };
    }
  }

  return {
    success: false,
    error: "No email provider key configured on worker. Set RESEND_API_KEY or BREVO_API_KEY.",
  };
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
      : bodyJson.email && typeof bodyJson.email === "string"
        ? [bodyJson.email.trim()]
        : [];

    const targetEmails = Array.from(
      new Set([...(authUserEmail ? [authUserEmail] : []), ...explicitRecipients]),
    ).filter(Boolean);

    if (!targetEmails.length) {
      return response(request, env, { delivered: false, error: "No recipient email found" }, 400);
    }

    // 1. FORGOT PASSWORD OTP EMAIL
    if (bodyJson.type === "forgot_password_otp") {
      const otp = bodyJson.otp || bodyJson.token || "000000";
      const subject = "Your Password Reset OTP - Sentinel Security";
      const text = `Hello,\n\nA password reset request was initiated for your Sentinel account.\n\nYour One-Time Password (OTP) code is:\n\n${otp}\n\nThis code is valid for 5 minutes. Do NOT share this code with anyone.\n\nIf you did not request this password reset, please ignore this email or check your account security settings.\n\nRegards,\nSentinel Security Team`;
      const html = `
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
      `;

      const result = await sendEmail(env, targetEmails, subject, text, html);
      return response(request, env, {
        delivered: result.success,
        recipients: targetEmails,
        error: result.error,
      });
    }

    // 2. ATTENDANCE MODIFICATION OR DELETION NOTIFICATION
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

    // 3. REGISTRATION WELCOME NOTIFICATION
    const regSubject = bodyJson.subject || "Welcome to Sentinel Security - Account Created";
    const regText = bodyJson.text || `Hello ${authUserName},\n\nYour Sentinel Security account has been successfully created for ${targetEmails[0]}.\n\nYou can now sign in to your dashboard.\n\nBest regards,\nSentinel Security Team`;
    const regHtml = bodyJson.html || `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
        <h2 style="color: #111827; margin-top: 0;">Welcome to Sentinel Security!</h2>
        <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">Hello <strong>${authUserName}</strong>,</p>
        <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">Your Sentinel Security account has been successfully created for <strong>${targetEmails[0]}</strong>.</p>
        <div style="margin: 20px 0; padding: 14px 18px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; color: #166534; font-size: 14px;">
          ✓ Your account registration is complete and ready to use.
        </div>
        <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">You can now sign in to access your security dashboard and manage your account.</p>
        <p style="color: #6b7280; font-size: 12px;">If you did not create this account, please contact our security team immediately.</p>
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Sentinel Security Notification System</p>
      </div>
    `;

    const result = await sendEmail(env, targetEmails, regSubject, regText, regHtml);
    return response(request, env, { delivered: result.success, recipients: targetEmails, error: result.error });
  },
};
