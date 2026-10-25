import type { Level } from "@/lib/model";

export const levelColor: Record<Level, string> = { ok: "text-ok", warn: "text-warn", crit: "text-crit" };
export const levelBg: Record<Level, string> = { ok: "bg-ok", warn: "bg-warn", crit: "bg-crit" };

export function Card({ title, right, children, className = "" }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" | "crit" | "info" }) {
  const t = {
    muted: "bg-panel2 text-muted",
    ok: "bg-accentsoft text-ok",
    warn: "bg-warn/15 text-warn",
    crit: "bg-crit/15 text-crit",
    info: "bg-info/15 text-info",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });
export const fmtUptime = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`);
