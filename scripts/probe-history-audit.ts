import "./load-env";
/**
 * Why is a student's global history bigger than it should be? Groups the SAME recordset the card
 * shows, so the answer is about the data the app displays, not a different query. Read-only.
 */
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";

const id = process.argv[2];
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const p = new MssqlDataProvider();
  const rows = await p.getStudentTransactions(id, "global");
  const debits = rows.filter((r) => r.amount > 0);
  const credits = rows.filter((r) => r.amount < 0);
  console.log(JSON.stringify({
    rows: rows.length,
    grossDebits: r2(debits.reduce((t, r) => t + r.amount, 0)),
    grossCredits: r2(credits.reduce((t, r) => t + Math.abs(r.amount), 0)),
    net: r2(rows.reduce((t, r) => t + r.amount, 0)),
    span: `${rows.at(-1)?.postedOn} .. ${rows[0]?.postedOn}`,
  }));

  // exact duplicates: same date, description and amount appearing more than once
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.postedOn}|${r.amount}|${r.description.trim()}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  console.log(`exact duplicate lines: ${dupes.length}`);
  for (const [k, n] of dupes.slice(0, 10)) console.log(`   x${n}  ${k}`);

  // reversal pairs: a debit and a credit of the same magnitude and description
  let reversed = 0;
  for (const d of debits) {
    if (credits.some((c) => Math.abs(c.amount) === d.amount && c.description.trim() === d.description.trim())) reversed = r2(reversed + d.amount);
  }
  console.log(`debit value matched by a same-description credit (possible reversals/refunds): ${reversed}`);

  // by source code, and by year
  const by = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { n: number; debit: number; credit: number }>();
    for (const r of rows) {
      const e = m.get(key(r)) ?? { n: 0, debit: 0, credit: 0 };
      e.n += 1;
      if (r.amount > 0) e.debit = r2(e.debit + r.amount); else e.credit = r2(e.credit + Math.abs(r.amount));
      m.set(key(r), e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  console.log("by source code:");
  for (const [k, v] of by((r) => r.sourceCode || "(blank)")) console.log(`   ${k.padEnd(8)} n=${String(v.n).padStart(4)} debit=${String(v.debit).padStart(12)} credit=${String(v.credit).padStart(12)}`);
  console.log("by year:");
  for (const [k, v] of by((r) => r.postedOn.slice(0, 4))) console.log(`   ${k} n=${String(v.n).padStart(4)} debit=${String(v.debit).padStart(12)} credit=${String(v.credit).padStart(12)}`);
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
