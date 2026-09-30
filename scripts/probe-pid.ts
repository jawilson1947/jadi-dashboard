import "./load-env";
/** Map a PID (tblStudent.pid, what the Bio card shows) to the idnumber the other queries use. */
import sql from "mssql";
import { getSourcePool } from "../src/server/db/mssql";

async function main() {
  const pool = await getSourcePool();
  const r = await pool.request().input("pid", sql.Int, Number(process.argv[2])).query("SELECT TOP (5) idnumber, pid FROM dbo.tblStudent WHERE pid = @pid");
  console.log(JSON.stringify(r.recordset));
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.name + ":", e.message); process.exit(1); });
