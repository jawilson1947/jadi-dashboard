import "./load-env";
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";
import { worksheetTotals, itemTypeLabel, CLEARANCE_THRESHOLD } from "../src/server/services/clearance-analysis";

const id = process.argv[2];
const drop = process.argv[3] ?? "2026-08-14";

async function main() {
  const p = new MssqlDataProvider();
  const [items, bio] = await Promise.all([p.getClearanceWorksheetItems(id, drop), p.getStudentBio(id)]);
  for (const r of items) console.log(`${itemTypeLabel(r).padEnd(6)} ${String(r.amount).padStart(9)}  ${r.description.trim()}`);
  const t = worksheetTotals(items);
  const eighty = Math.round(t.net * CLEARANCE_THRESHOLD * 100) / 100;
  const balance = bio?.accountBalance ?? 0;
  console.log(JSON.stringify(t));
  console.log(JSON.stringify({ balance, eightyPercentOfCharges: eighty, amountNeededToClear: Math.max(0, Math.round((balance + eighty) * 100) / 100) }));
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
