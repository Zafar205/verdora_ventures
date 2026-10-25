import { snapshot } from "@/lib/surveillance";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(snapshot());
}
