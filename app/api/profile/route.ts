import type { NextRequest } from "next/server";
import { setLimits } from "@/lib/gateway";
import { fail, roleOf } from "@/lib/http";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.metric !== "string" || typeof b.shed !== "string" || typeof b.min !== "number" || typeof b.max !== "number")
    return fail(400, "Bad request");
  const r = setLimits(roleOf(req), b.shed, b.metric, b.min, b.max);
  return r.ok ? Response.json({ ok: true }) : fail(r.status, r.error);
}
