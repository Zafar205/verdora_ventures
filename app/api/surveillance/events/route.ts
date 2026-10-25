import type { NextRequest } from "next/server";
import { EVENT_TYPES, SHEDS, ingest, type EventType } from "@/lib/surveillance";
import { can } from "@/lib/rbac";
import { fail, roleOf } from "@/lib/http";
import type { Shed } from "@/lib/model";

/**
 * Ingestion endpoint for the computer-vision service.
 *   POST /api/surveillance/events   header: x-cv-token: $SURVEILLANCE_TOKEN
 *   { "type": "door_open", "shed": "aeroponic", "camera": "CAM-AER-DOOR", "confidence": 0.94 }
 * Outside production, a signed-in operator/admin may also post events from the UI to simulate detections.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || !EVENT_TYPES.includes(b.type) || !SHEDS.includes(b.shed)) return fail(400, "Bad request");

  const token = process.env.SURVEILLANCE_TOKEN;
  const viaCv = !!token && req.headers.get("x-cv-token") === token;
  const simulated = process.env.NODE_ENV !== "production" && can(roleOf(req), "switch") && b.type !== "round_overdue";
  if (!viaCv && !simulated) return fail(403, "Not allowed to report surveillance events");

  ingest(
    {
      type: b.type as EventType,
      shed: b.shed as Shed,
      camera: typeof b.camera === "string" ? b.camera : undefined,
      detail: typeof b.detail === "string" ? b.detail.slice(0, 200) : viaCv ? undefined : "Simulated",
      confidence: typeof b.confidence === "number" ? b.confidence : undefined,
    },
    viaCv,
  );
  return Response.json({ ok: true });
}
