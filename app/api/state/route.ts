import type { NextRequest } from "next/server";
import { snapshot } from "@/lib/gateway";
import { roleOf } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return Response.json(snapshot(roleOf(req)));
}
