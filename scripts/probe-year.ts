import "./load-env";
/** List one year of a student's global history, newest first, as the card sees it. Read-only. */
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";

async function main() {
  const [id, year] = process.argv.slice(2);
  const rows = (await new MssqlDataProvider().getStudentTransactions(id, "global")).filter((r) => r.postedOn.startsWith(year));
  for (const r of rows) console.log(`${r.postedOn}  ${String(r.amount).padStart(10)}  ${(r.sourceCode || "--").padEnd(4)}  ${r.description.trim()}`);
  console.log(`${rows.length} rows in ${year}`);
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
