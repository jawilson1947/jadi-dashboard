/** Liveness probe (Spec §19). No sensitive data. */
export function GET() {
  return Response.json({ status: "ok" });
}
