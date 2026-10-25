"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { Role } from "@/lib/model";
import { ROLES } from "@/lib/rbac";

const RoleCtx = createContext<{ role: Role; setRole: (r: Role) => void }>({ role: "operator", setRole: () => {} });
export const useRole = () => useContext(RoleCtx);

const NAV = [
  { href: "/", label: "Monitoring & control" },
  { href: "/surveillance", label: "Surveillance" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>("operator");
  const [alerts, setAlerts] = useState(0);
  const path = usePathname();

  // Badge: unacknowledged surveillance alerts, visible from every page.
  useEffect(() => {
    const load = () =>
      fetch("/api/surveillance", { headers: { "x-role": role }, cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setAlerts(d.alerts.filter((a: { acknowledged: boolean }) => !a.acknowledged).length))
        .catch(() => {});
    const first = setTimeout(load, 0);
    const id = setInterval(load, 5000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [role]);

  return (
    <RoleCtx.Provider value={{ role, setRole }}>
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line py-4">
          <div>
            <div className="text-xl font-semibold tracking-tight">Sustain Agro</div>
            <div className="text-sm text-muted">Greenhouse operations</div>
          </div>
          <nav aria-label="Main" className="mr-auto flex gap-1">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-accentsoft text-ok" : "text-muted hover:text-fg"}`}>
                  {n.label}
                  {n.href === "/surveillance" && alerts > 0 && (
                    <span className="rounded-full bg-crit px-1.5 text-xs font-semibold text-white">{alerts}</span>
                  )}
                </Link>
              );
            })}
          </nav>
          <label className="flex items-center gap-2 text-sm text-muted">
            Signed in as
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-md border border-line bg-panel px-2 py-1.5 text-fg">
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {children}
    </RoleCtx.Provider>
  );
}
