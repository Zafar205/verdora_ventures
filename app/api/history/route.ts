import type { NextRequest } from "next/server";
import { history } from "@/lib/gateway";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/history?node=AER-01&metric=temp → { A: [...], M: [...], B: [...] } */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const h = history(q.get("node") ?? "", q.get("metric") ?? "");
  return h ? Response.json(h) : fail(404, "Unknown sensor");
}
