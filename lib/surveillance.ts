// CCTV / computer-vision module state. Your CV service reports detections by POSTing
// to /api/surveillance/events; until then the page can simulate them (see README).
import type { Level, Shed } from "./model";

export type EventType = "person_detected" | "round_completed" | "door_open" | "door_closed" | "round_overdue";
export const EVENT_TYPES: EventType[] = ["person_detected", "round_completed", "door_open", "door_closed", "round_overdue"];
export const SHEDS: Shed[] = ["aeroponic", "hydroponic"];

/** A round check is expected at least this often per shed. */
export const ROUND_INTERVAL_MIN = 60;
/** Door open longer than this is a warning, longer than the second value is critical. */
export const DOOR_WARN_S = 60;
export const DOOR_CRIT_S = 300;

export interface CameraDef {
  id: string;
  name: string;
  shed: Shed;
  view: "door" | "interior";
  /** Real stream (MJPEG/snapshot image or mp4/webm video URL), from env; empty = simulated feed. */
  streamUrl?: string;
}

const env = (k: string) => process.env[k] || undefined;

export const CAMERAS: CameraDef[] = [
  { id: "CAM-AER-DOOR", name: "Aeroponic shed · entrance", shed: "aeroponic", view: "door", streamUrl: env("CAM_AER_DOOR_URL") },
  { id: "CAM-AER-INT", name: "Aeroponic shed · interior", shed: "aeroponic", view: "interior", streamUrl: env("CAM_AER_INT_URL") },
  { id: "CAM-HYD-DOOR", name: "Hydroponic shed · entrance", shed: "hydroponic", view: "door", streamUrl: env("CAM_HYD_DOOR_URL") },
  { id: "CAM-HYD-INT", name: "Hydroponic shed · interior", shed: "hydroponic", view: "interior", streamUrl: env("CAM_HYD_INT_URL") },
];

export interface SurvEvent {
  id: string;
  ts: number;
  type: EventType;
  shed: Shed;
  camera?: string;
  detail?: string;
  confidence?: number;
}

export interface SurvAlert {
  id: string;
  level: Level;
  shed: Shed;
  kind: "door_open" | "round_overdue";
  message: string;
  since: number;
  acknowledged: boolean;
}

export interface SurvSnapshot {
  now: number;
  source: "simulator" | "cv";
  config: { roundIntervalMin: number; doorWarnS: number; doorCritS: number };
  cameras: (CameraDef & { online: boolean; person: boolean; doorOpen: boolean })[];
  sheds: Record<Shed, { doorOpenSince: number | null; lastRound: number | null; nextDue: number | null; overdue: boolean }>;
  alerts: SurvAlert[];
  events: SurvEvent[];
}

interface Store {
  doorOpenSince: Record<Shed, number | null>;
  lastRound: Record<Shed, number | null>;
  lastPerson: Record<Shed, number>;
  overdueLogged: Record<Shed, number | null>;
  acked: Set<string>;
  events: SurvEvent[];
  seq: number;
  fromCv: boolean;
}

const g = globalThis as unknown as { __sustainSurv?: Store };

function store(): Store {
  if (!g.__sustainSurv) {
    const now = Date.now();
    g.__sustainSurv = {
      doorOpenSince: { aeroponic: null, hydroponic: null },
      // Demo start: aeroponic checked recently, hydroponic overdue, so the alert path is visible.
      lastRound: { aeroponic: now - 14 * 60000, hydroponic: now - 71 * 60000 },
      lastPerson: { aeroponic: 0, hydroponic: 0 },
      overdueLogged: { aeroponic: null, hydroponic: null },
      acked: new Set(),
      events: [],
      seq: 1,
      fromCv: false,
    };
  }
  return g.__sustainSurv;
}

export function ingest(e: { type: EventType; shed: Shed; camera?: string; detail?: string; confidence?: number }, viaCv: boolean) {
  const st = store();
  const ts = Date.now();
  if (viaCv) st.fromCv = true;
  if (e.type === "door_open" && st.doorOpenSince[e.shed] == null) st.doorOpenSince[e.shed] = ts;
  if (e.type === "door_closed") st.doorOpenSince[e.shed] = null;
  if (e.type === "round_completed") st.lastRound[e.shed] = ts;
  if (e.type === "person_detected" || e.type === "round_completed") st.lastPerson[e.shed] = ts;
  push(st, { ts, ...e });
}

function push(st: Store, e: Omit<SurvEvent, "id">) {
  st.events.unshift({ id: `e${st.seq++}`, ...e });
  if (st.events.length > 100) st.events.pop();
}

export function ackSurv(id: string) {
  const st = store();
  if (!snapshot().alerts.some((a) => a.id === id)) return false;
  st.acked.add(id);
  return true;
}

export function snapshot(): SurvSnapshot {
  const st = store();
  const now = Date.now();
  const alerts: SurvAlert[] = [];
  const sheds = {} as SurvSnapshot["sheds"];

  for (const shed of SHEDS) {
    const open = st.doorOpenSince[shed];
    const last = st.lastRound[shed];
    const nextDue = last == null ? null : last + ROUND_INTERVAL_MIN * 60000;
    const overdue = nextDue == null || now > nextDue;
    sheds[shed] = { doorOpenSince: open, lastRound: last, nextDue, overdue };

    if (open != null) {
      const s = Math.floor((now - open) / 1000);
      if (s >= DOOR_WARN_S) {
        alerts.push({
          id: `door:${shed}:${open}`, level: s >= DOOR_CRIT_S ? "crit" : "warn", shed, kind: "door_open", since: open,
          message: `${shed === "aeroponic" ? "Aeroponic" : "Hydroponic"} shed door has been left open for ${Math.floor(s / 60)} min ${s % 60}s`,
          acknowledged: st.acked.has(`door:${shed}:${open}`),
        });
      }
    }
    if (overdue) {
      const mins = last == null ? null : Math.floor((now - last) / 60000);
      const id = `round:${shed}:${last ?? 0}`;
      alerts.push({
        id, level: "crit", shed, kind: "round_overdue", since: nextDue ?? now,
        message: `${shed === "aeroponic" ? "Aeroponic" : "Hydroponic"} shed: no round check detected ${mins == null ? "yet" : `for ${mins} min`} (due every ${ROUND_INTERVAL_MIN} min)`,
        acknowledged: st.acked.has(id),
      });
      if (st.overdueLogged[shed] !== (last ?? 0)) {
        st.overdueLogged[shed] = last ?? 0;
        push(st, { ts: nextDue ?? now, type: "round_overdue", shed, detail: "Routine round check not detected in time" });
      }
    }
  }

  const cameras = CAMERAS.map((c) => ({
    ...c,
    online: true,
    person: now - st.lastPerson[c.shed] < 20000,
    doorOpen: st.doorOpenSince[c.shed] != null,
  }));
  alerts.sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || (a.level === b.level ? 0 : a.level === "crit" ? -1 : 1));

  return {
    now,
    source: st.fromCv ? "cv" : "simulator",
    config: { roundIntervalMin: ROUND_INTERVAL_MIN, doorWarnS: DOOR_WARN_S, doorCritS: DOOR_CRIT_S },
    cameras,
    sheds,
    alerts,
    events: st.events.slice(0, 40),
  };
}
