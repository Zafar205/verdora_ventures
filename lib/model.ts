// Shared types + static registry derived from the Week 10 design report.

export type NodeId = "AER-01" | "HYD-01";
export type Shed = "aeroponic" | "hydroponic";
export type Pos = "A" | "M" | "B";
export type MetricId = "moisture" | "n" | "p" | "k" | "temp" | "humidity" | "light";
export type Role = "admin" | "operator" | "specialist" | "technician" | "viewer";
export type OperatingMode = "manual" | "rule" | "ml";
export type Level = "ok" | "warn" | "crit";

/** Three sensor stations per shed: both ends and the middle, for a representative average. */
export const POSITIONS: { id: Pos; label: string }[] = [
  { id: "A", label: "Front end" },
  { id: "M", label: "Middle" },
  { id: "B", label: "Back end" },
];

export interface MetricDef {
  id: MetricId;
  label: string;
  unit: string;
  decimals: number;
  group: "env" | "root";
  /** Plausible electrical range; readings outside are flagged as sensor faults. */
  valid: [number, number];
  /** Default alert limits (each shed's crop profile can override). */
  limits: { min: number; max: number };
  /** Max believable difference between the three stations before we flag disagreement. */
  spread: number;
  noise: number;
}

const m = (
  id: MetricId, label: string, unit: string, decimals: number, group: MetricDef["group"],
  valid: [number, number], min: number, max: number, spread: number, noise: number,
): MetricDef => ({ id, label, unit, decimals, group, valid, limits: { min, max }, spread, noise });

export const METRICS: MetricDef[] = [
  m("temp", "Temperature", "°C", 1, "env", [-10, 60], 18, 30, 4, 0.08),
  m("humidity", "Humidity", "%", 0, "env", [0, 100], 55, 85, 15, 0.3),
  m("light", "Light", "lux", 0, "env", [0, 120000], 0, 60000, 15000, 300),
  m("moisture", "Moisture", "%", 1, "root", [0, 100], 60, 90, 15, 0.2),
  m("n", "Nitrogen (N)", "mg/L", 0, "root", [0, 500], 100, 200, 40, 0.8),
  m("p", "Phosphorus (P)", "mg/L", 0, "root", [0, 300], 30, 80, 20, 0.4),
  m("k", "Potassium (K)", "mg/L", 0, "root", [0, 600], 150, 300, 60, 1),
];

export const metricOf = (id: MetricId) => METRICS.find((x) => x.id === id)!;

export interface NodeDef {
  id: NodeId;
  shed: Shed;
  name: string;
}

export const NODES: NodeDef[] = [
  { id: "AER-01", shed: "aeroponic", name: "Aeroponic shed" },
  { id: "HYD-01", shed: "hydroponic", name: "Hydroponic shed" },
];

export const nodeOf = (id: NodeId) => NODES.find((n) => n.id === id)!;
export const sensorKey = (node: NodeId, pos: Pos, metric: MetricId) => `${node}.${pos}.${metric}`;

export interface SensorDef {
  key: string; // e.g. "AER-01.M.temp"
  node: NodeId;
  pos: Pos;
  metric: MetricId;
}

export const SENSORS: SensorDef[] = NODES.flatMap((n) =>
  METRICS.flatMap((mt) => POSITIONS.map((p) => ({ key: sensorKey(n.id, p.id, mt.id), node: n.id, pos: p.id, metric: mt.id }))),
);

export interface ActuatorDef {
  id: string;
  label: string;
  node: NodeId;
  kind: "water" | "fan" | "light";
  row?: 1 | 2 | 3;
  group: "irrigation" | "climate" | "lighting" | "pumps";
  note: string;
}

export const ACTUATORS: ActuatorDef[] = NODES.flatMap((n): ActuatorDef[] => {
  const tag = n.shed === "aeroponic" ? "AER" : "HYD";
  const rows = ([1, 2, 3] as const).map((row): ActuatorDef => ({
    id: `WTR-${tag}-R${row}`,
    label: n.shed === "aeroponic" ? `Row ${row} misting pump` : `Row ${row} circulation pump`,
    node: n.id, kind: "water", row,
    group: n.shed === "aeroponic" ? "irrigation" : "pumps",
    note: n.shed === "aeroponic" ? "Mist nozzles" : "Nutrient flow",
  }));
  return [
    ...rows,
    { id: `FAN-${tag}`, label: "Ventilation fan", node: n.id, kind: "fan", group: "climate", note: "Shed exhaust" },
    { id: `LGT-${tag}`, label: "Grow light", node: n.id, kind: "light", group: "lighting", note: "Supplemental LED" },
  ];
});

/** Average (and spread) of the valid station readings for one metric in one shed. */
export function shedStats(readings: Record<string, Reading>, node: NodeId, metric: MetricId) {
  const vals = POSITIONS.map((p) => readings[sensorKey(node, p.id, metric)]?.value).filter((v): v is number => v != null);
  if (!vals.length) return { avg: null as number | null, spread: 0, n: 0 };
  return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, spread: Math.max(...vals) - Math.min(...vals), n: vals.length };
}

/** Gateway safety: minimum seconds between two state changes on one actuator. */
export const MIN_SWITCH_INTERVAL_S = 10;

export interface Reading {
  value: number | null; // null = no valid sample
  ts: number;
  fault: boolean;
}

export interface ActuatorState {
  id: string;
  on: boolean;
  /** true while a manual command is holding the actuator against local rules */
  override: boolean;
  lastChange: number;
  /** who/what last drove it */
  source: "rule" | "manual" | "boot";
}

export interface CommandRecord {
  id: string;
  ts: number;
  actuator: string;
  action: "on" | "off" | "auto";
  user: string;
  role: Role;
  status: "sent" | "acked" | "rejected";
  ackedAt?: number;
  reason?: string;
}

export interface AlertItem {
  id: string;
  level: Level;
  sensor: string;
  message: string;
  since: number;
  acknowledged: boolean;
  by?: string;
}

export interface AuditEntry {
  id: string;
  ts: number;
  user: string;
  role: Role;
  category: "control" | "config" | "alert";
  target: string;
  action: string;
  outcome: "ok" | "denied" | "rejected";
  detail?: string;
}

export type Profiles = Record<Shed, { crop: string; limits: Record<MetricId, { min: number; max: number }> }>;

export interface Snapshot {
  now: number;
  mode: OperatingMode;
  gateway: {
    id: "GW-01";
    online: boolean;
    awsLink: boolean;
    uptimeS: number;
    buffered: number;
    msgRate: number; // msgs/min
  };
  readings: Record<string, Reading>;
  nodes: Record<NodeId, { online: boolean; lastSeen: number; rssi: number; battery: number | null }>;
  actuators: ActuatorState[];
  commands: CommandRecord[];
  alerts: AlertItem[];
  audit: AuditEntry[];
  profiles: Profiles;
  /** What the signed-in role may do; the server enforces the same table. */
  permissions: Record<Action, boolean>;
  source: "simulator" | "aws-iot";
}

export type Action =
  | "ack"
  | "switch"
  | "editProfile"
  | "changeMode"
  | "viewAudit";
