import "./load-env";
/** Show sample transactions for source codes the A-28 map does not cover. Read-only, per student. */
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";

const ids = process.argv.slice(2);
const KNOWN = new Set(["FA", "RC", "CG", "BN", "LB", "IV", "MS"]);

async function main() {
  const p = new MssqlDataProvider();
  const seen = new Map<string, { n: number; total: number; samples: string[] }>();
  for (const id of ids) {
    for (const r of await p.getStudentTransactions(id, "global")) {
      const code = (r.sourceCode ?? "").trim().toUpperCase();
      if (!code || KNOWN.has(code)) continue;
      const e = seen.get(code) ?? { n: 0, total: 0, samples: [] };
      e.n += 1;
      e.total = Math.round((e.total + r.amount) * 100) / 100;
      if (e.samples.length < 5) e.samples.push(`${r.postedOn} ${r.amount} ${r.description.trim()}`);
      seen.set(code, e);
    }
  }
  for (const [code, e] of seen) console.log(code, JSON.stringify(e, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
