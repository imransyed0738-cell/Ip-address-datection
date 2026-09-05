import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, Fingerprint, Globe2, Lock, MapPin, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sentinel Secure Banking — Real-Time Account Security" },
      {
        name: "description",
        content:
          "Monitor logins, IP addresses, devices and consented location in real time. Two-step authentication, security alerts and a 24/7 help line.",
      },
      { property: "og:title", content: "Sentinel Secure Banking" },
      {
        property: "og:description",
        content: "Real-time login, IP and device monitoring for your bank account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Activity,
    title: "Live security activity",
    body: "Every login, device change and security action is recorded and streamed to your dashboard the moment it happens.",
  },
  {
    icon: Globe2,
    title: "Server-verified IP address",
    body: "IP addresses are observed by our servers, never taken from the browser, and resolved to an approximate region.",
  },
  {
    icon: MapPin,
    title: "Consented location monitoring",
    body: "Location tracking is off until you switch it on. Revoke it any time and updates stop immediately.",
  },
  {
    icon: Fingerprint,
    title: "Two-step authentication",
    body: "Authenticator-app codes with recovery, required at every sign-in once enabled.",
  },
  {
    icon: Lock,
    title: "One-tap incident response",
    body: "Lock the account, sign out other sessions and raise a security report from a single screen.",
  },
  {
    icon: ShieldCheck,
    title: "Risk engine",
    body: "New device, new IP and unusual region signals produce a scored risk level on every event.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-navy text-navy-foreground">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          <ShieldCheck className="size-5" />
          <span className="font-semibold tracking-tight">Sentinel Secure Banking</span>
          <div className="ml-auto flex gap-2">
            <Button asChild variant="ghost" className="text-navy-foreground hover:bg-white/10">
              <Link to="/help">Help line</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <p className="label-caps">Account protection platform</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight md:text-5xl">
          Know exactly who is signing into your account, from where, and on what device.
        </h1>
        <p className="mt-5 max-w-2xl text-muted-foreground">
          Sentinel records every authentication and security event with the server-observed IP
          address, device details and — only with your explicit consent — your approximate location.
          Alerts arrive in real time.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Open a secure account</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/help">24/7 security support</Link>
          </Button>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-px bg-border px-0 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-surface p-6">
              <Icon className="size-5 text-accent" />
              <h2 className="mt-4 text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-10 text-xs text-muted-foreground">
        Sentinel is a security demonstration platform. It does not connect to a real banking
        network and performs no real financial transactions.
      </footer>
    </div>
  );
}
