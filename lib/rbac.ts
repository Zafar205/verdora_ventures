import type { ActuatorDef, Action, Role } from "./model";

type Grant = "yes" | "limited" | "no";

// Mirrors the "Initial role based access matrix" in the design report.
const MATRIX: Record<Action, Record<Role, Grant>> = {
  ack: { admin: "yes", operator: "yes", specialist: "yes", technician: "yes", viewer: "no" },
  switch: { admin: "yes", operator: "yes", specialist: "limited", technician: "limited", viewer: "no" },
  editProfile: { admin: "yes", operator: "no", specialist: "yes", technician: "no", viewer: "no" },
  changeMode: { admin: "yes", operator: "no", specialist: "no", technician: "no", viewer: "no" },
  viewAudit: { admin: "yes", operator: "limited", specialist: "limited", technician: "limited", viewer: "no" },
};

// "Limited" = within an assigned scope. Specialists handle water delivery,
// technicians handle pumps/fans for maintenance.
const SCOPE: Partial<Record<Role, ActuatorDef["group"][]>> = {
  specialist: ["irrigation"],
  technician: ["pumps", "climate"],
};

export const ROLES: { id: Role; label: string; user: string }[] = [
  { id: "admin", label: "Manager / Admin", user: "m.hamza" },
  { id: "operator", label: "Greenhouse operator", user: "m.ali" },
  { id: "specialist", label: "Crop specialist", user: "verdora.crop" },
  { id: "technician", label: "Maintenance technician", user: "verdora.maint" },
  { id: "viewer", label: "Viewer", user: "guest" },
];

export function parseRole(v: string | null): Role | null {
  return ROLES.find((r) => r.id === v)?.id ?? null;
}

export function userFor(role: Role) {
  return ROLES.find((r) => r.id === role)!.user;
}

export function can(role: Role, action: Action, actuator?: ActuatorDef): boolean {
  const g = MATRIX[action][role];
  if (g === "no") return false;
  if (g === "yes") return true;
  if (action === "switch" && actuator) return SCOPE[role]?.includes(actuator.group) ?? false;
  return true; // limited, unscoped (e.g. the UI asking "any switching at all?")
}

export function permissionsFor(role: Role): Record<Action, boolean> {
  return Object.fromEntries(
    (Object.keys(MATRIX) as Action[]).map((a) => [a, can(role, a)]),
  ) as Record<Action, boolean>;
}
