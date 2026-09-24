const sql = require('C:/jadiDashboard/node_modules/mssql');
const cs = 'Server=10.1.0.171;Database=ousadb;User Id=DataOps;Password=DanaDenyse32;Encrypt=false;TrustServerCertificate=true';
(async () => {
  const p = await sql.connect(cs);
  const r = await p.request().query(`SELECT TOP 5 ID_NUM, COUNT(*) AS n FROM ousadb.dbo.tblFCA_TRANS_HIST WHERE SOURCE_CDE IN ('@F','@C') GROUP BY ID_NUM HAVING COUNT(*) > 5 ORDER BY ID_NUM`);
  console.log(JSON.stringify(r.recordset));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
