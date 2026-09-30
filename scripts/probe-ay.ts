import "./load-env";
import { MssqlDataProvider } from "../src/server/repositories/mssql/provider";
import { getTransactionsView } from "../src/server/services/transactions";
import { MemoryAppStore } from "../src/server/store/memory";

async function main() {
  const v = await getTransactionsView(process.argv[2], { scope: "global" }, new MssqlDataProvider(), new MemoryAppStore());
  for (const y of v.academicYears) console.log(`${y.label}  charges=${String(y.charges).padStart(10)}  credits=${String(y.credits).padStart(10)}  net=${String(y.net).padStart(10)}`);
  console.log("net total", v.academicYears.reduce((t, y) => Math.round((t + y.net) * 100) / 100, 0));
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
