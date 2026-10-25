import type { NextRequest } from "next/server";
import { setMode } from "@/lib/gateway";
import { fail, roleOf } from "@/lib/http";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || !["manual", "rule", "ml"].includes(b.mode)) return fail(400, "Bad request");
  const r = setMode(roleOf(req), b.mode);
  return r.ok ? Response.json({ ok: true }) : fail(r.status, r.error);
}
