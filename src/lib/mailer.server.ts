import nodemailer from "nodemailer";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  type?: "security_alert" | "cyber_threat_alert" | "forgot_password_otp" | "registration_welcome" | "general";
  title?: string;
  ip?: string;
  riskLevel?: string;
  location?: string;
  device?: string;
}

export interface SendEmailResult {
  success: boolean;
  provider?: string;
  error?: string;
  recipients?: string[];
}

/**
 * Sends email using the first available configured provider:
 * 1. Direct SMTP / Gmail (via SMTP_USER + SMTP_PASS)
 * 2. Resend API (via RESEND_API_KEY)
 * 3. Brevo API (via BREVO_API_KEY)
 * 4. Cloudflare Worker (via EMAIL_WORKER_URL)
 */
export async function sendNotificationEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, subject, text, html, type, title, ip, riskLevel, location, device } = options;
  const rawList = Array.isArray(to) ? to : [to];
  const recipients = Array.from(
    new Set(
      rawList
        .filter((e): e is string => typeof e === "string" && Boolean(e.trim()))
        .map((e) => e.trim().toLowerCase()),
    ),
  );

  if (!recipients.length) {
    return { success: false, error: "No recipient email address specified." };
  }

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
        to: recipients.join(", "),
        subject,
        text,
        html: html || text,
      });

      return { success: true, provider: "smtp", recipients };
    } catch (err: any) {
      console.warn("[Mailer] SMTP delivery failed:", err?.message || err);
      // Fall through to next provider
    }
  }

  // 2. Resend API
  const resendApiKey = process.env["RESEND_API_KEY"];
  if (resendApiKey) {
    try {
      const fromEmail = process.env["EMAIL_FROM"] || "Sentinel Security <onboarding@resend.dev>";
      // For batch or single recipients
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: recipients,
          subject,
          text,
          ...(html ? { html } : {}),
        }),
      });

      if (res.ok) {
        return { success: true, provider: "resend", recipients };
      }
      const errText = await res.text();
      console.warn("[Mailer] Resend delivery failed:", errText);

      // If Resend rejected because recipient is not the account owner (testing domain limitation),
      // forward an admin dispatch copy to adminEmail so the OTP / registration event is NEVER lost
      const adminEmail = (process.env["ADMIN_EMAIL"] || "syedimranpasha012@gmail.com").trim().toLowerCase();
      if (
        !recipients.includes(adminEmail) &&
        (errText.includes("testing emails to your own") || errText.includes("validation_error"))
      ) {
        try {
          const adminRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromEmail,
              to: [adminEmail],
              subject: `[Dispatch for ${recipients.join(", ")}] ${subject}`,
              text: `[Automated Dispatch Notice]\nTarget recipient: ${recipients.join(", ")}\n\n${text}`,
              html:
                `<div style="padding: 12px; border-left: 4px solid #3b82f6; background: #eff6ff; margin-bottom: 16px; font-family: sans-serif; font-size: 13px; color: #1e40af;"><strong>Notice:</strong> This email was generated for <strong>${recipients.join(", ")}</strong>. (Resend testing domain forwarded this to your admin email).</div>` +
                (html || text),
            }),
          });
          if (adminRes.ok) {
            console.log("[Mailer] Delivered dispatch copy to admin email via Resend.");
            return {
              success: true,
              provider: "resend_admin_dispatch",
              recipients: [adminEmail],
            };
          }
        } catch {
          // ignore
        }
      }
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
          to: recipients.map((r) => ({ email: r })),
          subject,
          textContent: text,
          ...(html ? { htmlContent: html } : {}),
        }),
      });

      if (res.ok) {
        return { success: true, provider: "brevo", recipients };
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
    const isOtp = Boolean(
      otpMatch && (subject.includes("OTP") || subject.includes("Verification") || subject.includes("Reset"))
    );

    const emailType =
      type ||
      (isOtp
        ? "forgot_password_otp"
        : subject.toLowerCase().includes("alert") || subject.toLowerCase().includes("security")
          ? "security_alert"
          : "registration_welcome");

    const workerRes = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: emailType,
        recipients,
        email: recipients[0],
        otp: isOtp ? otpMatch : undefined,
        subject,
        title,
        text,
        html,
        ip,
        ipAddress: ip,
        riskLevel,
        location,
        device,
      }),
    });

    const workerData = (await workerRes.json().catch(() => ({}))) as {
      delivered?: boolean;
      error?: string;
    };

    if (workerData.delivered) {
      return { success: true, provider: "cloudflare_worker", recipients };
    }
    return {
      success: false,
      error:
        workerData.error ||
        "Email delivery pending. Please add an SMTP App Password (or RESEND_API_KEY / BREVO_API_KEY) in .env.",
      recipients,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Email notification server unreachable.",
      recipients,
    };
  }
}

