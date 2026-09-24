import "./load-env";
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";
import { getTransactionsView } from "../src/server/services/transactions";
import { MemoryAppStore } from "../src/server/store/memory";

const id = process.argv[2];
async function main() {
  const p = new MssqlDataProvider();
  const store = new MemoryAppStore();
  const v1 = await getTransactionsView(id, { scope: "global" }, p, store);
  const v2 = await getTransactionsView(id, { scope: "global", year: v1.year ?? undefined, page: 2 }, p, store);
  console.log(JSON.stringify({
    year: v1.year, pageSize: v1.pageSize, totalRowsInYear: v1.totalRows, allRows: v1.allRows,
    pageCount: Math.ceil(v1.totalRows / v1.pageSize),
    page1: v1.rows.length, page1First: v1.rows[0]?.postedOn, page1Last: v1.rows.at(-1)?.postedOn,
    page2: v2.rows.length, page2First: v2.rows[0]?.postedOn,
    overlap: v1.rows.some((r) => v2.rows.some((x) => x.postedOn === r.postedOn && x.amount === r.amount && x.description === r.description)),
  }));
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
