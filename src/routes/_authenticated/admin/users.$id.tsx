import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AdminShell, RiskBadge } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { adminUserAction, adminUserDetail } from "@/lib/admin.functions";
import { formatWhen, prettyEvent } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/users/$id")({
  head: () => ({
    meta: [
      { title: "Account investigation — Sentinel Admin" },
      {
        name: "description",
        content:
          "Investigation panel with sign-in history, devices, risk history and authorised admin actions.",
      },
      { property: "og:title", content: "Account investigation — Sentinel Admin" },
      { property: "og:description", content: "Authorised account security investigation panel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Investigation,
});

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Investigation() {
  const { id } = useParams({ from: "/_authenticated/admin/users/$id" });
  const detail = useServerFn(adminUserDetail);
  const act = useServerFn(adminUserAction);
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "user", id],
    queryFn: () => detail({ data: { userId: id } }),
  });

  const action = useMutation({
    mutationFn: (input: { action: any; note?: string }) =>
      act({ data: { userId: id, action: input.action, ...(input.note ? { note: input.note } : {}) } }),
    onSuccess: () => {
      toast.success("Action recorded in the audit log");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });

  const p = data?.profile as any;

  return (
    <AdminShell>
      <Link to="/admin/users" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to users
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">Loading account…</p>}

      {p && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">{p.full_name ?? "Unnamed account"}</h1>
            {data?.risk && <RiskBadge score={data.risk.score} level={data.risk.level} />}
            {p.account_locked && (
              <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                Locked
              </span>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Account information">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Email</dt>
                <dd>{p.email ?? "—"}</dd>
                <dt className="text-muted-foreground">Mobile</dt>
                <dd>{p.mobile ?? "—"}</dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatWhen(p.created_at)}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{p.account_locked ? "Locked" : p.flagged_for_review ? "Under review" : "Active"}</dd>
                <dt className="text-muted-foreground">Password reset required</dt>
                <dd>{p.require_password_reset ? "Yes" : "No"}</dd>
                <dt className="text-muted-foreground">Registered devices</dt>
                <dd>{data?.devices.length ?? 0}</dd>
              </dl>
            </Panel>

            <Panel title="Risk assessment">
              <p className="text-sm">
                Score <strong>{data?.risk.score}</strong>/100 — {data?.risk.level} risk. Reasons:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {data?.risk.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Scores describe account activity only. They never label a person, and high scores require
                human review before any action.
              </p>
            </Panel>

            <Panel title="Authorised location">
              {p.location_consent ? (
                <div className="space-y-2 text-sm">
                  <div>Consent: <strong>Granted</strong> {p.location_consent_at ? `· ${formatWhen(p.location_consent_at)}` : ""}</div>
                  <div>Last authorised location: {p.last_location_label ?? "No fix recorded"}</div>
                  {p.last_lat != null && p.last_lng != null && (
                    <>
                      <div className="font-mono text-xs">
                        {p.last_lat.toFixed(4)}, {p.last_lng.toFixed(4)}
                        {p.location_accuracy ? ` · ±${Math.round(p.location_accuracy)} m` : ""}
                      </div>
                      <div>Updated: {p.last_location_at ? formatWhen(p.last_location_at) : "—"}</div>
                      <iframe
                        title="Authorised location map"
                        className="h-56 w-full rounded border border-border"
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${p.last_lng - 0.02}%2C${p.last_lat - 0.02}%2C${p.last_lng + 0.02}%2C${p.last_lat + 0.02}&layer=mapnik&marker=${p.last_lat}%2C${p.last_lng}`}
                      />
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This user has not consented to location sharing. No coordinates are collected or stored.
                </p>
              )}
            </Panel>

            <Panel title="Administrator actions">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "FORCE_LOGOUT" })}>
                  Force logout
                </Button>
                {p.account_locked ? (
                  <Button size="sm" onClick={() => action.mutate({ action: "UNLOCK" })}>
                    Unlock account
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => action.mutate({ action: "LOCK" })}>
                    Lock account
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "REQUIRE_PASSWORD_RESET" })}>
                  Require password reset
                </Button>
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "FLAG_REVIEW" })}>
                  Flag for review
                </Button>
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "RESOLVE_REVIEW" })}>
                  Resolve review
                </Button>
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "GENERATE_RISK" })}>
                  Generate risk assessment
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                <Textarea
                  placeholder="Investigation note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!note.trim()}
                  onClick={() => action.mutate({ action: "ADD_NOTE", note })}
                >
                  Add note
                </Button>
              </div>
            </Panel>
          </div>

          <Panel title="Recent security events">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">When</th>
                    <th className="py-2">Event</th>
                    <th className="py-2">IP</th>
                    <th className="py-2">Device</th>
                    <th className="py-2">Region</th>
                    <th className="py-2">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.events ?? []).slice(0, 50).map((e: any) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="whitespace-nowrap py-2">{formatWhen(e.created_at)}</td>
                      <td className="py-2">{prettyEvent(e.event_type)}</td>
                      <td className="py-2 font-mono text-xs">{e.ip_address ?? "—"}</td>
                      <td className="py-2">{[e.browser, e.os].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="py-2">{e.location_label ?? "—"}</td>
                      <td className="py-2">
                        <RiskBadge score={e.risk_score} level={e.risk_level} />
                      </td>
                    </tr>
                  ))}
                  {!(data?.events ?? []).length && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-muted-foreground">
                        No events recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Devices and sessions">
              <ul className="space-y-2 text-sm">
                {(data?.devices ?? []).map((d: any) => (
                  <li key={d.id} className="rounded border border-border p-2">
                    <div className="font-medium">{d.device_name ?? "Unnamed device"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[d.device_type, d.browser, d.os].filter(Boolean).join(" · ")} · last IP{" "}
                      <span className="font-mono">{d.last_ip ?? "—"}</span> · {formatWhen(d.last_seen)} ·{" "}
                      {d.trusted ? "Trusted" : "Untrusted"}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">id {d.id}</div>
                  </li>
                ))}
                {!(data?.devices ?? []).length && (
                  <li className="text-muted-foreground">No registered devices.</li>
                )}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                MAC addresses are never collected — browsers do not expose them, and Sentinel does not
                attempt to work around that.
              </p>
            </Panel>

            <Panel title="Risk history and notes">
              <ul className="space-y-2 text-sm">
                {(data?.assessments ?? []).map((a: any) => (
                  <li key={a.id} className="rounded border border-border p-2">
                    <RiskBadge score={a.score} level={a.risk_level} />{" "}
                    <span className="text-xs text-muted-foreground">
                      {formatWhen(a.generated_at)} · {a.review_status}
                    </span>
                    <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                      {(a.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}
                    </ul>
                  </li>
                ))}
                {(data?.notes ?? []).map((n: any) => (
                  <li key={n.id} className="rounded border border-border p-2">
                    <div className="text-xs text-muted-foreground">{formatWhen(n.created_at)} · note</div>
                    <div>{n.note}</div>
                  </li>
                ))}
                {!(data?.assessments ?? []).length && !(data?.notes ?? []).length && (
                  <li className="text-muted-foreground">No assessments or notes yet.</li>
                )}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
