import { Link, createFileRoute } from "@tanstack/react-router";
import { LifeBuoy, Mail, Phone, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SUPPORT } from "@/lib/support";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "24/7 Security Help Line — Sentinel Secure Banking" },
      {
        name: "description",
        content:
          "Reach the Sentinel security team by phone or email, or report unauthorised account activity around the clock.",
      },
      { property: "og:title", content: "24/7 Security Help Line" },
      { property: "og:description", content: "Phone and email support for account security." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Help,
});

function Help() {
  const configured = SUPPORT.phone !== "";
  return (
    <div className="min-h-screen bg-surface px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="text-sm text-accent underline-offset-4 hover:underline">
          ← Back
        </Link>
        <div className="panel mt-4 p-8">
          <LifeBuoy className="size-6 text-accent" />
          <h1 className="mt-4 text-2xl font-semibold">24/7 Security Support</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Contact details are set by the deployment owner. No number is invented here.
          </p>

          <dl className="mt-8 space-y-5">
            <Row icon={Phone} label="Phone" value={SUPPORT.phone || "Not configured"} />
            <Row icon={Mail} label="Email" value={SUPPORT.email || "Not configured"} />
            <Row
              icon={ShieldAlert}
              label="Unauthorised activity"
              value={SUPPORT.emergencyEmail || "Not configured"}
            />
          </dl>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild disabled={!configured}>
              <a href={configured ? `tel:${SUPPORT.phone}` : undefined}>Call support</a>
            </Button>
            <Button asChild variant="outline">
              <a href={SUPPORT.email ? `mailto:${SUPPORT.email}` : undefined}>Email support</a>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/user/notifications">Review my alerts</Link>
            </Button>
          </div>

          {!configured && (
            <p className="mt-6 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              Support contacts are not configured yet. Set them in{" "}
              <code className="font-mono">src/lib/support.ts</code> before going live.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div>
        <dt className="label-caps">{label}</dt>
        <dd className="font-mono text-sm">{value}</dd>
      </div>
    </div>
  );
}
