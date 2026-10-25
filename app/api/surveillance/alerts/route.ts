import type { NextRequest } from "next/server";
import { ackSurv } from "@/lib/surveillance";
import { can } from "@/lib/rbac";
import { fail, roleOf } from "@/lib/http";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.id !== "string") return fail(400, "Bad request");
  if (!can(roleOf(req), "ack")) return fail(403, "Not allowed to acknowledge alerts");
  return ackSurv(b.id) ? Response.json({ ok: true }) : fail(404, "Alert no longer active");
}
