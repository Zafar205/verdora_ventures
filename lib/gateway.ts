// Simulated GW-01 + backend. Everything the dashboard needs goes through the
// exported functions here, so replacing the simulator with AWS IoT Core means
// re-implementing this module (see README, "Going live").
import {
  ACTUATORS,
  METRICS,
  MIN_SWITCH_INTERVAL_S,
  NODES,
  POSITIONS,
  SENSORS,
  metricOf,
  sensorKey,
  shedStats,
  type ActuatorState,
  type AlertItem,
  type AuditEntry,
  type CommandRecord,
  type MetricId,
  type OperatingMode,
  type Pos,
  type Profiles,
  type Reading,
  type Role,
  type Shed,
  type Snapshot,
} from "./model";
import { can, permissionsFor, userFor } from "./rbac";

const STEP_MS = 5000;
const HISTORY_LEN = 360; // 30 min at 5 s
const ACK_DELAY_MS = 900;

interface Store {
  t: number; // last simulated time
  boot: number;
  mode: OperatingMode;
  shed: Record<Shed, Record<MetricId, number>>; // true shed-level state
  readings: Record<string, Reading>;
  history: Record<string, [number, number][]>;
  actuators: ActuatorState[];
  commands: CommandRecord[];
  alerts: Map<string, AlertItem>;
  audit: AuditEntry[];
  profiles: Profiles;
  seq: number;
  msgs: number[]; // timestamps of recent messages
}

const g = globalThis as unknown as { __sustainAgro?: Store };

const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Each station sees the shed slightly differently (ends vs. middle).
const OFFSET: Record<Pos, Partial<Record<MetricId, number>>> = {
  A: { temp: 0.7, humidity: -2, moisture: 1.5, n: 3, p: 1, k: 4 },
  M: {},
  B: { temp: -0.7, humidity: 2, moisture: -1.5, n: -3, p: -1, k: -4 },
};

// Light varies proportionally (never negative at night).
const LIGHT_FACTOR: Record<Pos, number> = { A: 1.08, M: 1, B: 0.92 };

function defaultProfiles(): Profiles {
  const limits = () => Object.fromEntries(METRICS.map((x) => [x.id, { ...x.limits }])) as Profiles["aeroponic"]["limits"];
  return {
    aeroponic: { crop: "Basil", limits: { ...limits(), humidity: { min: 60, max: 90 } } },
    hydroponic: { crop: "Lettuce", limits: limits() },
  };
}

function init(): Store {
  const now = Date.now();
  const start = (): Record<MetricId, number> => ({
    temp: 24, humidity: 65, light: 8000, moisture: 75, n: 150, p: 55, k: 220,
  });
  const st: Store = {
    t: now - HISTORY_LEN * STEP_MS,
    boot: now,
    mode: "rule",
    shed: { aeroponic: start(), hydroponic: start() },
    readings: {},
    history: Object.fromEntries(SENSORS.map((x) => [x.key, []])),
    actuators: ACTUATORS.map((a) => ({ id: a.id, on: false, override: false, lastChange: now - (HISTORY_LEN + 10) * STEP_MS, source: "boot" })),
    commands: [],
    alerts: new Map(),
    audit: [],
    profiles: defaultProfiles(),
    seq: 1,
    msgs: [],
  };
  g.__sustainAgro = st;
  advance(st, now); // backfill history
  st.audit = []; // drop backfill noise
  st.commands = [];
  return st;
}

const store = () => g.__sustainAgro ?? init();
const isOn = (st: Store, id: string) => st.actuators.find((a) => a.id === id)!.on;

// ---- physics + local rules -------------------------------------------------

function step(st: Store, t: number) {
  const dt = STEP_MS / 1000;
  const hr = new Date(t).getHours() + new Date(t).getMinutes() / 60;
  const sun = Math.max(0, Math.sin(((hr - 6) / 12) * Math.PI));

  for (const node of NODES) {
    const v = st.shed[node.shed];
    const tag = node.shed === "aeroponic" ? "AER" : "HYD";
    const fan = isOn(st, `FAN-${tag}`);
    const lamp = isOn(st, `LGT-${tag}`);
    const wet = ([1, 2, 3] as const).filter((r) => isOn(st, `WTR-${tag}-R${r}`)).length / 3; // fraction of rows watering
    const mist = node.shed === "aeroponic" ? 0.9 : 0.15;

    v.light = sun * 30000 + (lamp ? 9000 : 0) + 500 + rnd(200);
    v.temp += (22 + sun * 8 - v.temp) * 0.01 - (fan ? 0.12 : 0) * dt + rnd(0.05);
    v.humidity += ((node.shed === "aeroponic" ? 68 : 60) - v.humidity) * 0.01 + wet * mist - (fan ? 0.12 : 0) * dt + rnd(0.15);
    v.moisture = clamp(v.moisture + (wet * 0.45 - 0.045) * dt + rnd(0.02), 5, 98);
    v.n += (150 - v.n) * 0.002 + rnd(0.15);
    v.p += (55 - v.p) * 0.002 + rnd(0.08);
    v.k += (220 - v.k) * 0.002 + rnd(0.15);

    // Sensing + validity check (what the node does before publishing).
    for (const mt of METRICS) {
      for (const pos of POSITIONS) {
        const key = sensorKey(node.id, pos.id, mt.id);
        const base = mt.id === "light" ? v.light * LIGHT_FACTOR[pos.id] : v[mt.id] + (OFFSET[pos.id][mt.id] ?? 0);
        const raw = Math.max(0, base + rnd(mt.noise));
        const ok = raw >= mt.valid[0] && raw <= mt.valid[1];
        st.readings[key] = { value: ok ? raw : null, ts: t, fault: !ok };
        const h = st.history[key];
        h.push([t, ok ? +raw.toFixed(mt.decimals + 1) : NaN]);
        if (h.length > HISTORY_LEN) h.shift();
        st.msgs.push(t);
      }
    }
  }

  runRules(st, t);
  updateAlerts(st, t);
}

function drive(st: Store, id: string, on: boolean, t: number, source: ActuatorState["source"]) {
  const a = st.actuators.find((x) => x.id === id)!;
  if (a.on === on) return;
  if ((t - a.lastChange) / 1000 < MIN_SWITCH_INTERVAL_S) return; // switching protection
  a.on = on;
  a.lastChange = t;
  a.source = source;
}

function runRules(st: Store, t: number) {
  if (st.mode !== "rule") return;
  const free = (id: string) => !st.actuators.find((a) => a.id === id)!.override;

  for (const node of NODES) {
    const tag = node.shed === "aeroponic" ? "AER" : "HYD";
    const lim = st.profiles[node.shed].limits;
    // Rules act on the average of the valid stations, as in the design report.
    const moist = shedStats(st.readings, node.id, "moisture").avg;
    const temp = shedStats(st.readings, node.id, "temp").avg;

    if (moist != null) {
      for (const r of [1, 2, 3]) {
        const id = `WTR-${tag}-R${r}`;
        if (!free(id)) continue;
        if (moist < lim.moisture.min) drive(st, id, true, t, "rule");
        else if (moist >= (lim.moisture.min + lim.moisture.max) / 2 + 5) drive(st, id, false, t, "rule");
      }
    }
    if (temp != null && free(`FAN-${tag}`)) {
      if (temp > lim.temp.max - 2) drive(st, `FAN-${tag}`, true, t, "rule");
      else if (temp < lim.temp.max - 4) drive(st, `FAN-${tag}`, false, t, "rule");
    }
  }
}

function updateAlerts(st: Store, t: number) {
  const live = new Set<string>();
  const raise = (id: string, level: AlertItem["level"], sensor: string, message: string) => {
    live.add(id);
    const cur = st.alerts.get(id);
    if (cur) { cur.level = level; cur.message = message; return; }
    st.alerts.set(id, { id, level, sensor, message, since: t, acknowledged: false });
    pushAudit(st, { ts: t, user: "system", role: "admin", category: "alert", target: sensor, action: `alert: ${message}`, outcome: "ok" });
  };
  for (const node of NODES) {
    for (const mt of METRICS) {
      const where = `${node.name} · ${mt.label}`;
      for (const pos of POSITIONS) {
        if (st.readings[sensorKey(node.id, pos.id, mt.id)].fault)
          raise(`${node.id}.${pos.id}.${mt.id}:fault`, "crit", `${node.id} ${pos.label}`, `${where} sensor fault at ${pos.label.toLowerCase()}`);
      }
      const { avg, spread } = shedStats(st.readings, node.id, mt.id);
      if (avg == null) continue;
      const lim = st.profiles[node.shed].limits[mt.id];
      const f = (n: number) => n.toFixed(mt.decimals);
      if (avg < lim.min) raise(`${node.id}.${mt.id}:low`, "warn", node.id, `${where} low (avg ${f(avg)} ${mt.unit} < ${lim.min})`);
      else if (avg > lim.max) raise(`${node.id}.${mt.id}:high`, "warn", node.id, `${where} high (avg ${f(avg)} ${mt.unit} > ${lim.max})`);
      if (spread > mt.spread) raise(`${node.id}.${mt.id}:spread`, "warn", node.id, `${where}: stations disagree by ${f(spread)} ${mt.unit}, check sensors`);
    }
  }
  for (const id of [...st.alerts.keys()]) if (!live.has(id)) st.alerts.delete(id);
}

function advance(st: Store, now: number) {
  const n = Math.min(Math.floor((now - st.t) / STEP_MS), 1000);
  if (n <= 0) return;
  if (n === 1000) st.t = now - 1000 * STEP_MS;
  for (let i = 0; i < n; i++) { st.t += STEP_MS; step(st, st.t); }
  st.msgs = st.msgs.filter((x) => x > now - 60000);
}

function pushAudit(st: Store, e: Omit<AuditEntry, "id">) {
  st.audit.unshift({ id: `a${st.seq++}`, ...e });
  if (st.audit.length > 200) st.audit.pop();
}

// ---- public API (what route handlers call) --------------------------------

export function snapshot(role: Role): Snapshot {
  const st = store();
  const now = Date.now();
  advance(st, now);
  for (const c of st.commands) {
    if (c.status === "sent" && now - c.ts >= ACK_DELAY_MS) { c.status = "acked"; c.ackedAt = c.ts + ACK_DELAY_MS; }
  }
  const nodes = Object.fromEntries(
    NODES.map((n, i) => [n.id, { online: true, lastSeen: st.t, rssi: -50 - i * 6 + Math.round(rnd(2)), battery: null }]),
  ) as Snapshot["nodes"];

  // Limited roles see control entries only.
  const audit = !can(role, "viewAudit")
    ? []
    : role === "admin" ? st.audit : st.audit.filter((a) => a.category === "control");

  return {
    now,
    mode: st.mode,
    gateway: {
      id: "GW-01", online: true, awsLink: true,
      uptimeS: Math.floor((now - st.boot) / 1000), buffered: 0,
      msgRate: st.msgs.length,
    },
    readings: { ...st.readings },
    nodes,
    actuators: st.actuators.map((a) => ({ ...a })),
    commands: st.commands.slice(0, 15),
    alerts: [...st.alerts.values()].sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || b.since - a.since),
    audit: audit.slice(0, 40),
    profiles: st.profiles,
    permissions: permissionsFor(role),
    source: "simulator",
  };
}

export function history(node: string, metric: string) {
  const st = store();
  advance(st, Date.now());
  const out: Record<string, [number, number][]> = {};
  for (const p of POSITIONS) {
    const h = st.history[`${node}.${p.id}.${metric}`];
    if (!h) return null;
    out[p.id] = h;
  }
  return out;
}

type Result = { ok: true } | { ok: false; status: number; error: string };

export function sendCommand(role: Role, actuatorId: string, action: "on" | "off" | "auto"): Result {
  const st = store();
  const now = Date.now();
  advance(st, now);
  const user = userFor(role);
  const def = ACTUATORS.find((a) => a.id === actuatorId);
  if (!def) return { ok: false, status: 404, error: "Unknown actuator" };
  const a = st.actuators.find((x) => x.id === actuatorId)!;

  const reject = (status: number, error: string, outcome: AuditEntry["outcome"]): Result => {
    st.commands.unshift({ id: `c${st.seq++}`, ts: now, actuator: actuatorId, action, user, role, status: "rejected", reason: error });
    pushAudit(st, { ts: now, user, role, category: "control", target: actuatorId, action, outcome, detail: error });
    return { ok: false, status, error };
  };

  if (!can(role, "switch", def)) return reject(403, `Role "${role}" may not switch ${def.label}`, "denied");
  if (st.mode === "ml") return reject(409, "ML mode is advisory-only until validated", "rejected");
  if (action !== "auto" && (now - a.lastChange) / 1000 < MIN_SWITCH_INTERVAL_S && a.on !== (action === "on")) {
    const wait = Math.ceil(MIN_SWITCH_INTERVAL_S - (now - a.lastChange) / 1000);
    return reject(429, `Switching protection: wait ${wait}s before changing ${def.label}`, "rejected");
  }

  if (action === "auto") { a.override = false; }
  else {
    a.override = true; // manual override takes priority over local rules
    if (a.on !== (action === "on")) { a.on = action === "on"; a.lastChange = now; }
    a.source = "manual";
  }
  st.commands.unshift({ id: `c${st.seq++}`, ts: now, actuator: actuatorId, action, user, role, status: "sent" });
  if (st.commands.length > 50) st.commands.pop();
  pushAudit(st, { ts: now, user, role, category: "control", target: actuatorId, action: action === "auto" ? "release override" : `manual ${action}`, outcome: "ok" });
  return { ok: true };
}

export function setMode(role: Role, mode: OperatingMode): Result {
  const st = store();
  const user = userFor(role);
  if (!can(role, "changeMode")) {
    pushAudit(st, { ts: Date.now(), user, role, category: "config", target: "mode", action: `set ${mode}`, outcome: "denied" });
    return { ok: false, status: 403, error: "Only an admin can change the operating mode" };
  }
  if (mode === "ml") return { ok: false, status: 409, error: "ML mode is not validated yet" };
  st.mode = mode;
  pushAudit(st, { ts: Date.now(), user, role, category: "config", target: "mode", action: `set ${mode}`, outcome: "ok" });
  return { ok: true };
}

export function setLimits(role: Role, shed: Shed, metric: MetricId, min: number, max: number): Result {
  const st = store();
  const user = userFor(role);
  const p = st.profiles[shed];
  if (!can(role, "editProfile")) {
    pushAudit(st, { ts: Date.now(), user, role, category: "config", target: `${shed}.${metric}`, action: "edit limits", outcome: "denied" });
    return { ok: false, status: 403, error: "Not allowed to edit crop profiles" };
  }
  if (!p || !metricOf(metric)) return { ok: false, status: 404, error: "Unknown shed or metric" };
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return { ok: false, status: 422, error: "min must be below max" };
  p.limits[metric] = { min, max };
  pushAudit(st, { ts: Date.now(), user, role, category: "config", target: `${shed}.${metric}`, action: "edit limits", outcome: "ok", detail: `${min} – ${max}` });
  return { ok: true };
}

export function ackAlert(role: Role, id: string): Result {
  const st = store();
  const user = userFor(role);
  if (!can(role, "ack")) return { ok: false, status: 403, error: "Not allowed to acknowledge alerts" };
  const al = st.alerts.get(id);
  if (!al) return { ok: false, status: 404, error: "Alert no longer active" };
  al.acknowledged = true;
  al.by = user;
  pushAudit(st, { ts: Date.now(), user, role, category: "alert", target: al.sensor, action: "acknowledge", outcome: "ok" });
  return { ok: true };
}
