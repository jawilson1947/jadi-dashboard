const sql = require('C:/jadiDashboard/node_modules/mssql');
const cs = 'Server=10.1.0.171;Database=ousadb;User Id=DataOps;Password=DanaDenyse32;Encrypt=false;TrustServerCertificate=true';
(async () => {
  const p = await sql.connect(cs);
  const r = await p.request().query(`SELECT TOP 5 ID_NUM FROM ousadb.dbo.tblFCA_TRANS_HIST WHERE TRANS_DESC LIKE '14 Meal Plan 300 Acorn%' AND ABS(TRANS_AMT)=2986`);
  console.log(JSON.stringify(r.recordset));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
