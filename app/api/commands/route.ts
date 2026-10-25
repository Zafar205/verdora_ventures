import type { NextRequest } from "next/server";
import { sendCommand } from "@/lib/gateway";
import { fail, roleOf } from "@/lib/http";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.actuator !== "string" || !["on", "off", "auto"].includes(b.action)) return fail(400, "Bad request");
  const r = sendCommand(roleOf(req), b.actuator, b.action);
  return r.ok ? Response.json({ ok: true }) : fail(r.status, r.error);
}
