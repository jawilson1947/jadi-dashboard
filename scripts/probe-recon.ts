import "./load-env";
/** Why does the global history differ from tblStudent.AccountBalance? Read-only diagnosis. */
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";

const ids = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);

async function main() {
  const p = new MssqlDataProvider();
  for (const id of ids) {
    const [rows, cur, bio] = await Promise.all([
      p.getStudentTransactions(id, "global"),
      p.getStudentTransactions(id, "current"),
      p.getStudentBio(id),
    ]);
    const balance = bio?.accountBalance ?? 0;
    const net = round2(rows.reduce((t, r) => t + r.amount, 0));
    const future = rows.filter((r) => r.postedOn > today);
    const futureNet = round2(future.reduce((t, r) => t + r.amount, 0));
    const netExFuture = round2(net - futureNet);
    console.log(
      JSON.stringify({
        id,
        balance,
        historyNet: net,
        diff: round2(balance - net),
        futureRows: future.length,
        futureNet,
        netExcludingFuture: netExFuture,
        diffExcludingFuture: round2(balance - netExFuture),
        cnp: bio?.cnp ?? null,
        currentRows: cur.length,
        currentNet: round2(cur.reduce((t, r) => t + r.amount, 0)),
      }),
    );
    // rows the co-located jadi copy has that the AR-filtered linked server does not
    const key = (r: { postedOn: string; amount: number; description: string }) => `${r.postedOn}|${r.amount}|${r.description.trim()}`;
    const globalKeys = new Set(rows.map(key));
    for (const r of cur) if (!globalKeys.has(key(r))) console.log("   ONLY-IN-CURRENT", r.postedOn, r.amount, r.sourceCode, r.description.trim());
    for (const r of future) console.log("   FUTURE", r.postedOn, r.amount, r.sourceCode, r.description.trim());
  }
  process.exit(0);
}
function round2(n: number) { return Math.round(n * 100) / 100; }
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
