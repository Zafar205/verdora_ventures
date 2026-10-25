import type { NextRequest } from "next/server";
import { parseRole } from "./rbac";
import type { Role } from "./model";

/**
 * DEMO AUTH: the role comes from an `x-role` header. Replace with a verified
 * session/JWT (e.g. Cognito) before exposing this beyond a lab network.
 * Permissions are still enforced server-side per request.
 */
export function roleOf(req: NextRequest): Role {
  return parseRole(req.headers.get("x-role")) ?? "viewer";
}

export const fail = (status: number, error: string) => Response.json({ error }, { status });
