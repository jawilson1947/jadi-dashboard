import { getDataProvider } from "@/server/repositories";

/** Readiness probe (Spec §19): confirms configuration parses and the data provider answers. */
export async function GET() {
  try {
    const info = await getDataProvider().getSourceInfo();
    return Response.json({ status: "ready", provider: info.provider });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}
