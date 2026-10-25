import type { NextRequest } from "next/server";
import { ackAlert } from "@/lib/gateway";
import { fail, roleOf } from "@/lib/http";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.id !== "string") return fail(400, "Bad request");
  const r = ackAlert(roleOf(req), b.id);
  return r.ok ? Response.json({ ok: true }) : fail(r.status, r.error);
}
