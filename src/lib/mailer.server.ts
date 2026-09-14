import nodemailer from "nodemailer";

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  success: boolean;
  provider?: string;
  error?: string;
}

/**
 * Sends email using the first available configured provider:
 * 1. Direct SMTP / Gmail (via SMTP_USER + SMTP_PASS)
 * 2. Resend API (via RESEND_API_KEY)
 * 3. Brevo API (via BREVO_API_KEY)
 * 4. Cloudflare Worker (via EMAIL_WORKER_URL)
 */
export async function sendNotificationEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, subject, text, html } = options;

  // 1. Direct SMTP (e.g., Gmail with App Password, or custom SMTP)
  const smtpUser = process.env["SMTP_USER"] || process.env["GMAIL_USER"] || process.env["ADMIN_EMAIL"];
  const smtpPass = process.env["SMTP_PASS"] || process.env["GMAIL_APP_PASSWORD"];
  const smtpHost = process.env["SMTP_HOST"] || "smtp.gmail.com";
  const smtpPort = Number(process.env["SMTP_PORT"] || 465);

  if (smtpUser && smtpPass) {
    try {
      const isGmail = smtpHost.includes("gmail") || smtpUser.includes("@gmail.com");
      const transporter = nodemailer.createTransport(
        isGmail
          ? {
              service: "gmail",
              auth: {
                user: smtpUser,
                pass: smtpPass.replace(/\s+/g, ""), // clean spaces from 16-char app passwords
              },
            }
          : {
              host: smtpHost,
              port: smtpPort,
              secure: smtpPort === 465,
              auth: {
                user: smtpUser,
                pass: smtpPass,
              },
            }
      );

      await transporter.sendMail({
        from: `"Sentinel Security" <${smtpUser}>`,
        to,
        subject,
        text,
        html: html || text,
      });

      return { success: true, provider: "smtp" };
    } catch (err: any) {
      console.warn("[Mailer] SMTP delivery failed:", err?.message || err);
      // Fall through to next provider
    }
  }

  // 2. Resend API
  const resendApiKey = process.env["RESEND_API_KEY"];
  if (resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env["EMAIL_FROM"] || "Sentinel Security <onboarding@resend.dev>",
          to: [to],
          subject,
          text,
          ...(html ? { html } : {}),
        }),
      });

      if (res.ok) {
        return { success: true, provider: "resend" };
      }
      const errText = await res.text();
      console.warn("[Mailer] Resend delivery failed:", errText);
    } catch (err: any) {
      console.warn("[Mailer] Resend network error:", err?.message || err);
    }
  }

  // 3. Brevo API
  const brevoApiKey = process.env["BREVO_API_KEY"];
  if (brevoApiKey) {
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: "Sentinel Security",
            email: process.env["EMAIL_FROM"] || "notifications@sentinel-security.org",
          },
          to: [{ email: to }],
          subject,
          textContent: text,
          ...(html ? { htmlContent: html } : {}),
        }),
      });

      if (res.ok) {
        return { success: true, provider: "brevo" };
      }
      const errText = await res.text();
      console.warn("[Mailer] Brevo delivery failed:", errText);
    } catch (err: any) {
      console.warn("[Mailer] Brevo network error:", err?.message || err);
    }
  }

  // 4. Cloudflare Worker fallback
  const workerUrl =
    process.env["EMAIL_WORKER_URL"] ||
    process.env["VITE_EMAIL_WORKER_URL"] ||
    "https://sentinel-registration-email.sadiq8412pasha.workers.dev";

  try {
    const otpMatch = text.match(/\b\d{6}\b/)?.[0];
    const isOtp = Boolean(otpMatch && (subject.includes("OTP") || subject.includes("Verification") || subject.includes("Reset")));

    const workerRes = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: isOtp ? "forgot_password_otp" : "registration_welcome",
        email: to,
        otp: isOtp ? otpMatch : undefined,
        subject,
        text,
        html,
      }),
    });

    const workerData = (await workerRes.json().catch(() => ({}))) as {
      delivered?: boolean;
      error?: string;
    };

    if (workerData.delivered) {
      return { success: true, provider: "cloudflare_worker" };
    }
    return {
      success: false,
      error:
        workerData.error ||
        "Email delivery pending. Please add an SMTP App Password (or RESEND_API_KEY / BREVO_API_KEY) in .env.",
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Email notification server unreachable.",
    };
  }
}

