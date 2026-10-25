"use client";
import { useCallback, useEffect, useState } from "react";
import type { Shed } from "@/lib/model";
import { can } from "@/lib/rbac";
import type { SurvSnapshot } from "@/lib/surveillance";
import { useRole } from "./AppShell";
import { CameraFeed } from "./CameraFeed";
import { Card, Pill, fmtTime } from "./ui";

const SHED_NAME: Record<Shed, string> = { aeroponic: "Aeroponic shed", hydroponic: "Hydroponic shed" };
const EVENT_LABEL: Record<string, string> = {
  person_detected: "Person detected", round_completed: "Round check completed",
  door_open: "Door opened", door_closed: "Door closed", round_overdue: "Round check overdue",
};

const ago = (ts: number, now: number) => {
  const m = Math.floor((now - ts) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
};

export default function Surveillance() {
  const { role } = useRole();
  const [snap, setSnap] = useState<SurvSnapshot | null>(null);
  const [err, setErr] = useState(false);
  const [toast, setToast] = useState<{ msg: string; bad: boolean } | null>(null);

  const call = useCallback(async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "x-role": role, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: "no-store",
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }, [role]);

  const refresh = useCallback(async () => {
    try { const r = await call("/api/surveillance"); if (r.ok) { setSnap(r.data); setErr(false); } else setErr(true); }
    catch { setErr(true); }
  }, [call]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, 2000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [refresh]);

  const run = async (path: string, body: unknown, okMsg: string) => {
    const r = await call(path, body);
    setToast({ msg: r.ok ? okMsg : r.data.error ?? "Failed", bad: !r.ok });
    setTimeout(() => setToast(null), 3000);
    refresh();
  };
  const sim = (type: string, shed: Shed, camera?: string) =>
    run("/api/surveillance/events", { type, shed, camera, confidence: 0.9 }, `Simulated: ${EVENT_LABEL[type].toLowerCase()}`);

  const canAck = can(role, "ack");
  const canSim = can(role, "switch");
  const unacked = snap?.alerts.filter((a) => !a.acknowledged).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 sm:px-6">
      <header className="flex flex-wrap items-center gap-3 py-4">
        <h1 className="mr-auto text-lg font-semibold tracking-tight">Surveillance</h1>
        {snap && <Pill tone={snap.source === "cv" ? "ok" : "info"}>{snap.source === "cv" ? "CV service connected" : "simulated feeds & detections"}</Pill>}
        {unacked > 0 && <Pill tone="crit">{unacked} unacknowledged alert{unacked > 1 ? "s" : ""}</Pill>}
      </header>

      {err && <div role="alert" className="mb-4 rounded-lg border border-crit/40 bg-crit/10 px-4 py-2 text-sm text-crit">Cannot reach the backend. Showing the last known state.</div>}
      {!snap ? <p className="py-20 text-center text-muted">Loading…</p> : (
        <div className="space-y-5">
          {/* Anomalies */}
          <Card title="Anomalies">
            {snap.alerts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">No anomalies. Doors are closed and round checks are on schedule.</p>
            ) : (
              <ul className="divide-y divide-line">
                {snap.alerts.map((a) => (
                  <li key={a.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${a.acknowledged ? "opacity-60" : ""}`}>
                    <span className={`size-2.5 rounded-full ${a.level === "crit" ? "bg-crit" : "bg-warn"}`} aria-hidden />
                    <Pill tone={a.level === "crit" ? "crit" : "warn"}>{a.kind === "door_open" ? "Door open" : "Round check missed"}</Pill>
                    <span className="mr-auto font-medium">{a.message}</span>
                    <span className="text-xs text-muted">since {fmtTime(a.since)}</span>
                    {a.acknowledged ? <span className="text-xs text-muted">acknowledged</span> : (
                      <button disabled={!canAck} onClick={() => run("/api/surveillance/alerts", { id: a.id }, "Alert acknowledged")}
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium enabled:hover:bg-panel2 disabled:opacity-40">Acknowledge</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Per-shed status + cameras */}
          {(["aeroponic", "hydroponic"] as Shed[]).map((shed) => {
            const s = snap.sheds[shed];
            return (
              <Card key={shed} title={SHED_NAME[shed]} right={
                <div className="flex flex-wrap gap-2">
                  <Pill tone={s.doorOpenSince ? "warn" : "ok"}>Door {s.doorOpenSince ? "open" : "closed"}</Pill>
                  <Pill tone={s.overdue ? "crit" : "ok"}>
                    {s.lastRound == null ? "No round yet" : `Last round ${ago(s.lastRound, snap.now)}`}
                  </Pill>
                  {s.nextDue && !s.overdue && <Pill>next due {fmtTime(s.nextDue)}</Pill>}
                </div>
              }>
                <div className="grid gap-4 p-4 md:grid-cols-2">
                  {snap.cameras.filter((c) => c.shed === shed).map((c) => (
                    <figure key={c.id} className="overflow-hidden rounded-lg border border-line">
                      <div className="relative">
                        <CameraFeed cam={c} person={c.person} doorOpen={c.doorOpen} />
                        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                          <span className={`size-1.5 rounded-full ${c.online ? "bg-crit" : "bg-muted"}`} />{c.online ? "LIVE" : "OFFLINE"}{!c.streamUrl && " · SIMULATED"}
                        </span>
                      </div>
                      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span>{c.name}</span>
                        <span className="num text-xs text-muted">{c.id}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </Card>
            );
          })}

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Detection log" className="lg:col-span-2">
              <div className="max-h-[360px] overflow-auto">
                {snap.events.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">No detections yet.</p> : (
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-panel text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Time</th><th className="font-medium">Shed</th><th className="font-medium">Event</th><th className="px-4 font-medium">Camera</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {snap.events.map((e) => (
                        <tr key={e.id}>
                          <td className="num px-4 py-2 text-muted">{fmtTime(e.ts)}</td>
                          <td>{SHED_NAME[e.shed]}</td>
                          <td><Pill tone={e.type === "round_overdue" ? "crit" : e.type === "door_open" ? "warn" : e.type === "round_completed" ? "ok" : "muted"}>{EVENT_LABEL[e.type]}</Pill>
                            {e.confidence != null && <span className="num ml-2 text-xs text-muted">{Math.round(e.confidence * 100)}%</span>}</td>
                          <td className="num px-4 text-xs text-muted">{e.camera ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card title="Rules & demo controls">
              <div className="space-y-4 p-4 text-sm">
                <ul className="space-y-1 text-muted">
                  <li>Round check expected every <b className="text-fg">{snap.config.roundIntervalMin} min</b> per shed.</li>
                  <li>Door open over <b className="text-fg">{snap.config.doorWarnS}s</b> warns, over <b className="text-fg">{snap.config.doorCritS / 60} min</b> is critical.</li>
                </ul>
                <div>
                  <div className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Simulate CV detections</div>
                  {(["aeroponic", "hydroponic"] as Shed[]).map((shed) => (
                    <div key={shed} className="mb-2">
                      <div className="mb-1 text-xs text-muted">{SHED_NAME[shed]}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {([["door_open", "Open door"], ["door_closed", "Close door"], ["person_detected", "Person"], ["round_completed", "Round done"]] as const).map(([t, label]) => (
                          <button key={t} disabled={!canSim} onClick={() => sim(t, shed, `CAM-${shed === "aeroponic" ? "AER" : "HYD"}-${t.startsWith("door") ? "DOOR" : "INT"}`)}
                            className="rounded-md border border-line px-2 py-1 text-xs font-medium enabled:hover:bg-panel2 disabled:opacity-40">{label}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!canSim && <p className="text-xs text-muted">Operators and admins only.</p>}
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className={`fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg ${toast.bad ? "border-crit/40 bg-panel text-crit" : "border-line bg-panel text-fg"}`}>{toast.msg}</div>
      )}
    </div>
  );
}
