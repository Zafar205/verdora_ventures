"use client";
import { useEffect, useState } from "react";
import { POSITIONS, type MetricDef, type NodeId } from "@/lib/model";

type Pt = [number, number];
type Series = Record<string, Pt[]>;

const COLORS: Record<string, string> = { A: "var(--accent)", M: "var(--info)", B: "var(--series3)" };

export function TrendChart({ node, metric, limits, tick }: { node: NodeId; metric: MetricDef; limits: { min: number; max: number }; tick: number }) {
  const [data, setData] = useState<Series | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/history?node=${node}&metric=${metric.id}`)
      .then((r) => r.json())
      .then((d: Series) => live && setData(d))
      .catch(() => {});
    return () => { live = false; };
  }, [node, metric.id, tick]);

  const W = 960, H = 240, L = 54, R = 12, T = 12, B = 24;
  const all = data ? POSITIONS.flatMap((p) => data[p.id] ?? []) : [];
  const vals = all.map((p) => p[1]).filter(Number.isFinite);
  if (vals.length < 6) return <div className="grid h-[240px] place-items-center text-sm text-muted">Collecting data…</div>;

  let lo = Math.min(...vals, limits.min), hi = Math.max(...vals, limits.max);
  const pad = (hi - lo) * 0.1 || 1;
  lo -= pad; hi += pad;
  const t0 = data!.A[0][0], t1 = data!.A[data!.A.length - 1][0];
  const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const fmt = (n: number) => n.toFixed(metric.decimals);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);

  const path = (pts: Pt[]) => {
    let d = "", pen = false; // break the line across sensor-fault gaps
    for (const [t, v] of pts) {
      if (!Number.isFinite(v)) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-4 text-xs text-muted">
        {POSITIONS.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: COLORS[p.id] }} />{p.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-warn" />profile limits</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${metric.label} at three stations over the last 30 minutes`}>
        <rect x={L} width={W - L - R} y={y(Math.min(limits.max, hi))} height={Math.max(0, y(Math.max(limits.min, lo)) - y(Math.min(limits.max, hi)))} fill="var(--accent)" opacity="0.07" />
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="num">{fmt(v)}</text>
          </g>
        ))}
        {[limits.min, limits.max].map((v, i) => (
          <line key={i} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--warn)" strokeDasharray="4 4" />
        ))}
        {POSITIONS.map((p) => (
          <path key={p.id} d={path(data![p.id])} fill="none" stroke={COLORS[p.id]} strokeWidth="1.75" strokeLinejoin="round" />
        ))}
        <text x={L} y={H - 6} fontSize="11" fill="var(--muted)">30 min ago</text>
        <text x={W - R} y={H - 6} textAnchor="end" fontSize="11" fill="var(--muted)">now</text>
      </svg>
    </div>
  );
}
