import "./load-env";
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";

const id = process.argv[2];

async function main() {
  const p = new MssqlDataProvider();
  const t0 = Date.now();
  const rows = await p.getStudentTransactions(id, "global");
  const ms = Date.now() - t0;
  const years = [...new Set(rows.map((r) => r.postedOn.slice(0, 4)))].sort();
  console.log(JSON.stringify({ rows: rows.length, ms, years, oldest: rows.at(-1)?.postedOn, newest: rows[0]?.postedOn }));
  console.log(JSON.stringify(rows.slice(0, 3)));
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
