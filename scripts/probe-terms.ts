import "./load-env";
/** Group a student's tuition-related charges (CG) by posting date — one cluster per term billing. */
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";

async function main() {
  const rows = (await new MssqlDataProvider().getStudentTransactions(process.argv[2], "global")).filter((r) => (r.sourceCode ?? "").trim().toUpperCase() === "CG");
  const byDate = new Map<string, { n: number; total: number }>();
  for (const r of rows) {
    const e = byDate.get(r.postedOn) ?? { n: 0, total: 0 };
    e.n += 1;
    e.total = Math.round((e.total + r.amount) * 100) / 100;
    byDate.set(r.postedOn, e);
  }
  let grand = 0;
  for (const [d, v] of [...byDate.entries()].sort()) {
    grand = Math.round((grand + v.total) * 100) / 100;
    console.log(`${d}  lines=${String(v.n).padStart(2)}  ${String(v.total).padStart(10)}`);
  }
  console.log(`${byDate.size} billing dates, ${rows.length} CG lines, total ${grand}`);
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
