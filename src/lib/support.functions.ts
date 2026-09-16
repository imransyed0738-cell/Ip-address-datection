import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { SUPPORT } from "@/lib/support";

const supportMessageInput = z.object({
  message: z.string().trim().min(1, "Enter a message.").max(5000),
  userEmail: z.string().trim().email("Enter a valid email address.").max(255),
});

export const sendSupportMessage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => supportMessageInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["RESEND_API_KEY"];
    const from = process.env["SUPPORT_FROM_EMAIL"];

    if (!apiKey || !from) {
      return { ok: true, delivered: false };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [SUPPORT.email],
          reply_to: data.userEmail,
          subject: "Sentinel security support request",
          text: `Hello Sentinel Support,\n\nMessage from: ${data.userEmail}\n\n${data.message}\n\nThank you.`,
        }),
      });

      if (response.ok) return { ok: true, delivered: true };
    } catch {
      // Fall back to a mail draft when the provider is unavailable.
    }

    return { ok: true, delivered: false };
  });