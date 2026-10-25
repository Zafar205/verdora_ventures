"use client";
import { useCallback, useEffect, useState } from "react";
import { ACTUATORS, METRICS, NODES, POSITIONS, metricOf, sensorKey, shedStats, type ActuatorDef, type Level, type MetricDef, type MetricId, type NodeDef, type NodeId, type OperatingMode, type Role, type Snapshot } from "@/lib/model";
import { can } from "@/lib/rbac";
import { useRole } from "./AppShell";
import { Card, Pill, fmtTime, fmtUptime, levelColor } from "./ui";
import { TrendChart } from "./TrendChart";

const POLL_MS = 2000;


export default function Dashboard() {
  const { role } = useRole();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; bad: boolean } | null>(null);
  const [selected, setSelected] = useState<{ node: NodeId; metric: MetricId }>({ node: "AER-01", metric: "temp" });
  const [tab, setTab] = useState<"alerts" | "commands" | "audit" | "profiles">("alerts");
  const [tick, setTick] = useState(0);

  const api = useCallback(
    async (path: string, body?: unknown) => {
      const res = await fetch(path, {
        method: body ? "POST" : "GET",
        headers: { "x-role": role, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    },
    [role],
  );

  const refresh = useCallback(async () => {
    try {
      const r = await api("/api/state");
      if (r.ok) { setSnap(r.data); setErr(null); setTick((t) => t + 1); } else setErr("Backend error");
    } catch { setErr("Cannot reach backend"); }
  }, [api]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, POLL_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [refresh]);

  const act = async (path: string, body: unknown, okMsg: string) => {
    const r = await api(path, body);
    setToast({ msg: r.ok ? okMsg : r.data.error ?? "Failed", bad: !r.ok });
    setTimeout(() => setToast(null), 3500);
    refresh();
  };

  const limitsFor = useCallback(
    (node: NodeId, metric: MetricId) => snap?.profiles[NODES.find((n) => n.id === node)!.shed].limits[metric] ?? metricOf(metric).limits,
    [snap],
  );
  const levelOf = useCallback(
    (node: NodeId, metric: MetricId, v: number | null | undefined): Level => {
      if (v == null) return "crit";
      const l = limitsFor(node, metric);
      return v < l.min || v > l.max ? "warn" : "ok";
    },
    [limitsFor],
  );

  const unacked = snap?.alerts.filter((a) => !a.acknowledged).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 sm:px-6">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
        <h1 className="mr-auto text-lg font-semibold tracking-tight">Monitoring &amp; control</h1>

        {snap && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={snap.gateway.online ? "ok" : "crit"}>
              <span className={`size-1.5 rounded-full ${snap.gateway.online ? "bg-ok" : "bg-crit"}`} />
              GW-01 {snap.gateway.online ? "online" : "offline"}
            </Pill>
            <Pill tone={snap.gateway.awsLink ? "ok" : "warn"}>AWS IoT {snap.gateway.awsLink ? "linked" : "buffering"}</Pill>
            <Pill>{snap.gateway.msgRate} msg/min</Pill>
            <Pill>up {fmtUptime(snap.gateway.uptimeS)}</Pill>
            {snap.source === "simulator" && <Pill tone="info">simulated data</Pill>}
          </div>
        )}
      </header>

      {err && <div role="alert" className="mb-4 rounded-lg border border-crit/40 bg-crit/10 px-4 py-2 text-sm text-crit">{err}. Showing the last known values.</div>}

      {!snap ? (
        <p className="py-20 text-center text-muted">Connecting to gateway…</p>
      ) : (
        <div className="space-y-5">
          {/* Mode */}
          <Card>
            <div className="flex flex-wrap items-center gap-4 px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold tracking-wide text-muted uppercase">Operating mode</div>
                <div className="text-sm text-muted">
                  {snap.mode === "rule" ? "Gateway rules drive actuators; manual override wins." : snap.mode === "manual" ? "Rules paused. Only manual commands act." : "Advisory only."}
                </div>
              </div>
              <div role="radiogroup" aria-label="Operating mode" className="flex rounded-lg border border-line bg-panel2 p-0.5">
                {(["manual", "rule", "ml"] as OperatingMode[]).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={snap.mode === m}
                    disabled={!snap.permissions.changeMode || m === "ml"}
                    title={m === "ml" ? "Not validated yet" : !snap.permissions.changeMode ? "Admin only" : undefined}
                    onClick={() => act("/api/mode", { mode: m }, `Mode set to ${m}`)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                      snap.mode === m ? "bg-accent text-white dark:text-black" : "text-muted enabled:hover:text-fg disabled:opacity-50"
                    }`}
                  >
                    {m === "ml" ? "ML (advisory)" : m === "rule" ? "Rule-based" : "Manual"}
                  </button>
                ))}
              </div>
              {unacked > 0 && <Pill tone="warn">{unacked} unacknowledged alert{unacked > 1 ? "s" : ""}</Pill>}
            </div>
          </Card>

          {/* Sheds */}
          <div className="grid gap-5 xl:grid-cols-2">
            {NODES.map((n) => (
              <ShedCard key={n.id} node={n} snap={snap} role={role} selected={selected} onSelect={(metric) => setSelected({ node: n.id, metric })} levelOf={levelOf} act={act} />
            ))}
          </div>

          {/* Trend */}
          <Card title="Trend" right={
            <div className="flex gap-2">
              <select aria-label="Shed" value={selected.node} onChange={(e) => setSelected((s) => ({ ...s, node: e.target.value as NodeId }))} className="rounded-md border border-line bg-panel px-2 py-1 text-sm">
                {NODES.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <select aria-label="Measurement" value={selected.metric} onChange={(e) => setSelected((s) => ({ ...s, metric: e.target.value as MetricId }))} className="rounded-md border border-line bg-panel px-2 py-1 text-sm">
                {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          }>
            <div className="px-4 py-3">
              <div className="mb-2 text-sm font-medium">
                {NODES.find((n) => n.id === selected.node)!.name} · {metricOf(selected.metric).label} ({metricOf(selected.metric).unit}), last 30 min
              </div>
              <TrendChart node={selected.node} metric={metricOf(selected.metric)} limits={limitsFor(selected.node, selected.metric)} tick={Math.floor(tick / 3)} />
            </div>
          </Card>

          {/* Logs */}
          <Card
            title="Activity"
            right={
              <div role="tablist" className="flex gap-1 text-sm">
                {(["alerts", "commands", "audit", "profiles"] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`rounded-md px-2.5 py-1 capitalize ${tab === t ? "bg-panel2 font-medium text-fg" : "text-muted hover:text-fg"}`}>
                    {t === "alerts" && unacked > 0 ? `alerts (${unacked})` : t === "profiles" ? "crop profiles" : t === "audit" ? "audit log" : t}
                  </button>
                ))}
              </div>
            }
          >
            <div className="max-h-[420px] overflow-auto">
              {tab === "alerts" && <AlertsTab snap={snap} act={act} />}
              {tab === "commands" && <CommandsTab snap={snap} />}
              {tab === "audit" && <AuditTab snap={snap} />}
              {tab === "profiles" && <ProfilesTab snap={snap} act={act} />}
            </div>
          </Card>
        </div>
      )}

      {toast && (
        <div role="status" className={`fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg ${toast.bad ? "border-crit/40 bg-panel text-crit" : "border-line bg-panel text-fg"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

type Act = (path: string, body: unknown, okMsg: string) => Promise<void>;

function ShedCard({ node, snap, role, selected, onSelect, levelOf, act }: {
  node: NodeDef; snap: Snapshot; role: Role; selected: { node: NodeId; metric: MetricId };
  onSelect: (m: MetricId) => void;
  levelOf: (n: NodeId, m: MetricId, v: number | null | undefined) => Level;
  act: Act;
}) {
  const nd = snap.nodes[node.id];
  const acts = ACTUATORS.filter((a) => a.node === node.id);
  const group = (title: string, metrics: MetricDef[]) => (
    <table className="w-full text-sm">
      <caption className="px-4 pt-3 pb-1 text-left text-xs font-semibold tracking-wide text-muted uppercase">{title}</caption>
      <thead>
        <tr className="text-xs text-muted">
          <th scope="col" className="px-4 py-1 text-left font-medium"><span className="sr-only">Measurement</span></th>
          <th scope="col" className="px-2 py-1 text-right font-medium">Average</th>
          {POSITIONS.map((p) => <th key={p.id} scope="col" className="px-2 py-1 text-right font-medium">{p.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {metrics.map((m) => {
          const st = shedStats(snap.readings, node.id, m.id);
          const lv = levelOf(node.id, m.id, st.avg);
          const sel = selected.node === node.id && selected.metric === m.id;
          return (
            <tr key={m.id} onClick={() => onSelect(m.id)} className={`cursor-pointer border-t border-line hover:bg-panel2 ${sel ? "bg-panel2" : ""}`}>
              <th scope="row" className="px-4 py-2 text-left font-normal text-muted">
                <button onClick={() => onSelect(m.id)} aria-pressed={sel} className="text-left">{m.label}<span className="ml-1 text-xs">{m.unit}</span></button>
              </th>
              <td className={`num px-2 py-2 text-right text-lg font-semibold ${levelColor[lv]}`}>{st.avg == null ? "—" : st.avg.toFixed(m.decimals)}</td>
              {POSITIONS.map((p) => {
                const r = snap.readings[sensorKey(node.id, p.id, m.id)];
                const l = levelOf(node.id, m.id, r?.value);
                return <td key={p.id} className={`num px-2 py-2 text-right ${l === "ok" ? "" : levelColor[l]}`}>{r?.value == null ? "—" : r.value.toFixed(m.decimals)}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <Card title={`${node.name} · ${node.id}`} right={<Pill tone={nd.online ? "ok" : "crit"}>{nd.online ? `${nd.rssi} dBm` : "offline"}</Pill>}>
      <div className="overflow-x-auto">
        {group("Environment", METRICS.filter((m) => m.group === "env"))}
        {group("Root zone & nutrients", METRICS.filter((m) => m.group === "root"))}
      </div>
      <div className="mt-2 border-t border-line">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">Controls</span>
          {!snap.permissions.switch && <Pill>read-only</Pill>}
        </div>
        <ul className="divide-y divide-line">
          {acts.map((a) => <ActuatorRow key={a.id} def={a} state={snap.actuators.find((x) => x.id === a.id)!} snap={snap} role={role} act={act} />)}
        </ul>
      </div>
    </Card>
  );
}

function ActuatorRow({ def, state, snap, role, act }: { def: ActuatorDef; state: Snapshot["actuators"][number]; snap: Snapshot; role: Role; act: Act }) {
  // The server re-checks every command; this only decides whether to offer the buttons.
  const allowed = can(role, "switch", def);
  const lastCmd = snap.commands.find((c) => c.actuator === def.id && c.status !== "rejected");
  const pending = lastCmd?.status === "sent";
  const send = (action: "on" | "off" | "auto") => act("/api/commands", { actuator: def.id, action }, `${def.label}: ${action === "auto" ? "returned to auto" : `turned ${action}`}`);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <span className={`size-2.5 shrink-0 rounded-full ${state.on ? "bg-ok shadow-[0_0_0_4px_var(--accent-soft)]" : "bg-line"}`} aria-hidden />
      <div className="mr-auto min-w-[8rem]">
        <div className="text-sm font-medium">{def.label}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted">{def.id}</span>
          <Pill tone={state.on ? "ok" : "muted"}>{state.on ? "ON" : "OFF"}</Pill>
          {state.override ? <Pill tone="warn">manual</Pill> : state.source === "rule" ? <Pill tone="info">rule</Pill> : null}
          {pending && <Pill>sending…</Pill>}
        </div>
      </div>
      <div className="flex rounded-lg border border-line bg-panel2 p-0.5 text-sm">
        {(["on", "off", "auto"] as const).map((a) => {
          const active = a === "auto" ? !state.override : state.override && state.on === (a === "on");
          return (
            <button key={a} disabled={!allowed || (a === "auto" && !state.override)} onClick={() => send(a)}
              title={!allowed ? "Your role cannot switch this actuator" : undefined}
              className={`rounded-md px-2.5 py-1 font-medium uppercase transition-colors disabled:cursor-not-allowed ${active ? "" : "disabled:opacity-40"} ${active ? "bg-accent text-white dark:text-black" : "text-muted enabled:hover:text-fg"}`}>
              {a}
            </button>
          );
        })}
      </div>
    </li>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-8 text-center text-sm text-muted">{children}</p>;

function AlertsTab({ snap, act }: { snap: Snapshot; act: Act }) {
  if (!snap.alerts.length) return <Empty>All readings are within their crop-profile limits.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {snap.alerts.map((a) => (
        <li key={a.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${a.acknowledged ? "opacity-60" : ""}`}>
          <span className={`size-2 rounded-full ${a.level === "crit" ? "bg-crit" : "bg-warn"}`} />
          <span className="mr-auto">{a.message}<span className="ml-2 text-xs text-muted">{a.sensor} · since {fmtTime(a.since)}</span></span>
          {a.acknowledged ? <span className="text-xs text-muted">ack by {a.by}</span> : (
            <button disabled={!snap.permissions.ack} onClick={() => act("/api/alerts", { id: a.id }, "Alert acknowledged")}
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium enabled:hover:bg-panel2 disabled:opacity-40">Acknowledge</button>
          )}
        </li>
      ))}
    </ul>
  );
}

function CommandsTab({ snap }: { snap: Snapshot }) {
  if (!snap.commands.length) return <Empty>No commands sent yet. Use the actuator controls above.</Empty>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="sticky top-0 bg-panel text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Time</th><th className="font-medium">Actuator</th><th className="font-medium">Command</th><th className="font-medium">By</th><th className="px-4 font-medium">Status</th></tr></thead>
      <tbody className="divide-y divide-line">
        {snap.commands.map((c) => (
          <tr key={c.id}>
            <td className="num px-4 py-2 text-muted">{fmtTime(c.ts)}</td><td>{c.actuator}</td><td className="uppercase">{c.action}</td><td>{c.user}</td>
            <td className="px-4">{c.status === "rejected" ? <Pill tone="crit" >{c.reason}</Pill> : <Pill tone={c.status === "acked" ? "ok" : "muted"}>{c.status === "acked" ? "acknowledged by GW-01" : "sent"}</Pill>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuditTab({ snap }: { snap: Snapshot }) {
  if (!snap.permissions.viewAudit) return <Empty>Your role cannot view the audit log.</Empty>;
  if (!snap.audit.length) return <Empty>No entries yet.</Empty>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="sticky top-0 bg-panel text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Time</th><th className="font-medium">User</th><th className="font-medium">Target</th><th className="font-medium">Action</th><th className="px-4 font-medium">Outcome</th></tr></thead>
      <tbody className="divide-y divide-line">
        {snap.audit.map((a) => (
          <tr key={a.id}>
            <td className="num px-4 py-2 text-muted">{fmtTime(a.ts)}</td><td>{a.user}</td><td>{a.target}</td>
            <td>{a.action}{a.detail && <span className="text-muted"> · {a.detail}</span>}</td>
            <td className="px-4"><Pill tone={a.outcome === "ok" ? "ok" : a.outcome === "denied" ? "crit" : "warn"}>{a.outcome}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProfilesTab({ snap, act }: { snap: Snapshot; act: Act }) {
  const [draft, setDraft] = useState<Record<string, { min: string; max: string }>>({});
  const editable = snap.permissions.editProfile;
  return (
    <div>
      {!editable && <p className="border-b border-line px-4 py-2 text-xs text-muted">Read-only: only admins and crop specialists can edit profiles.</p>}
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-panel text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Shed</th><th className="font-medium">Measurement</th><th className="font-medium">Min</th><th className="font-medium">Max</th><th className="px-4" /></tr></thead>
        <tbody className="divide-y divide-line">
          {NODES.flatMap((n) => METRICS.map((m) => {
            const lim = snap.profiles[n.shed].limits[m.id];
            const key = `${n.shed}.${m.id}`;
            const d = draft[key];
            const dirty = d && (d.min !== String(lim.min) || d.max !== String(lim.max));
            return (
              <tr key={key}>
                <td className="px-4 py-1.5">{n.name} <span className="text-xs text-muted">({snap.profiles[n.shed].crop})</span></td>
                <td>{m.label} <span className="text-xs text-muted">({m.unit})</span></td>
                {(["min", "max"] as const).map((f) => (
                  <td key={f}>
                    <input type="number" step="any" disabled={!editable} aria-label={`${n.name} ${m.label} ${f}`}
                      value={d?.[f] ?? String(lim[f])}
                      onChange={(e) => setDraft((s) => ({ ...s, [key]: { ...{ min: String(lim.min), max: String(lim.max) }, ...s[key], [f]: e.target.value } }))}
                      className="num w-24 rounded-md border border-line bg-panel2 px-2 py-1 disabled:opacity-60" />
                  </td>
                ))}
                <td className="px-4 text-right">
                  {dirty && (
                    <button onClick={() => { act("/api/profile", { shed: n.shed, metric: m.id, min: Number(d.min), max: Number(d.max) }, "Limits updated"); setDraft((s) => { const x = { ...s }; delete x[key]; return x; }); }}
                      className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white dark:text-black">Save</button>
                  )}
                </td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}
