import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { approveMobileTrackingConsent } from "@/lib/security.functions";

export const Route = createFileRoute("/mobile-consent")({
  head: () => ({
    meta: [
      { title: "Approve mobile tracking — Sentinel Secure Banking" },
      { name: "description", content: "Approve a mobile security tracking request." },
    ],
  }),
  component: MobileConsentPage,
});

function MobileConsentPage() {
  const approve = useServerFn(approveMobileTrackingConsent);
  const [status, setStatus] = useState<"loading" | "approved" | "error">("loading");
  const [message, setMessage] = useState("Checking verification link…");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing its token.");
      return;
    }

    void approve({ data: { token } })
      .then(() => {
        setStatus("approved");
        setMessage("Mobile tracking has been approved. Return to the dashboard to view consented data.");
      })
      .catch((error: Error) => {
        setStatus("error");
        setMessage(error.message);
      });
  }, [approve]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <section className="panel w-full max-w-lg p-8 text-center">
        <ShieldCheck className="mx-auto size-10 text-accent" />
        <p className="label-caps mt-5">Mobile security consent</p>
        <h1 className="mt-2 text-2xl font-semibold">{status === "approved" ? "Approved" : "Verification"}</h1>
        <p className={`mt-3 text-sm ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {message}
        </p>
        {status === "approved" && <CheckCircle2 className="mx-auto mt-5 size-8 text-success" />}
        {status !== "loading" && (
          <Button asChild className="mt-6">
            <Link to="/user/dashboard">Return to dashboard</Link>
          </Button>
        )}
      </section>
    </main>
  );
}
