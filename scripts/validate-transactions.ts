import "./load-env";
/**
 * Phase 5c/5d validation harness (A-24). Samples students with a positive balance, pulls the GLOBAL
 * history through the app's own provider, and reports per student: row counts, query time, year
 * span, unmapped source codes, and how far the transaction history sits from the authoritative
 * AccountBalance (A-18). Read-only; prints no PII beyond the id.
 */
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";
import { getTransactionsView } from "../src/server/services/transactions";
import { analyzePayments } from "../src/server/services/payment-analysis";
import { MemoryAppStore } from "../src/server/store/memory";

const limit = Number(process.argv[2] ?? 10);

async function main() {
  const provider = new MssqlDataProvider();
  const store = new MemoryAppStore();
  const all = await provider.searchStudents({ by: "name", lastName: "", limit: 400 });
  const sample = all.filter((s) => s.accountBalance > 0).slice(0, limit);
  console.log(`sampled ${sample.length} students with a positive balance (of ${all.length} returned)`);

  const unmapped = new Set<string>();
  let slowest = { id: "", ms: 0, rows: 0 };

  for (const s of sample) {
    const t0 = Date.now();
    const view = await getTransactionsView(s.idnumber, { scope: "global" }, provider, store);
    const ms = Date.now() - t0;
    if (ms > slowest.ms) slowest = { id: s.idnumber, ms, rows: view.allRows };
    view.unmappedCodes.forEach((c) => unmapped.add(c));

    const rows = view.rows.length ? await provider.getStudentTransactions(s.idnumber, "global") : [];
    const pa = analyzePayments(rows, s.accountBalance);
    console.log(
      JSON.stringify({
        id: s.idnumber,
        rows: view.allRows,
        ms,
        years: view.years.length,
        span: view.years.length ? `${view.years.at(-1)!.year}-${view.years[0]!.year}` : null,
        balance: pa.balance,
        debits: pa.totalDebits,
        credits: pa.totalCredits,
        recon: pa.reconciliationDifference,
        outstanding: pa.outstanding,
        daysSinceCredit: pa.daysSinceLastCredit,
        collections: pa.collectionsRecommended,
        unmapped: view.unmappedCodes,
      }),
    );
  }

  console.log(JSON.stringify({ slowest, unmappedCodesSeen: [...unmapped].sort() }));
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
