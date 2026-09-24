const sql = require('C:/jadiDashboard/node_modules/mssql');
const cs = 'Server=10.1.0.171;Database=ousadb;User Id=DataOps;Password=DanaDenyse32;Encrypt=false;TrustServerCertificate=true';
(async () => {
  const p = await sql.connect(cs);
  const r = await p.request().query(`
    SELECT TOP 5 a.ID_NUM
    FROM ousadb.dbo.tblFCA_TRANS_HIST a
    JOIN ousadb.dbo.tblFCA_TRANS_HIST b ON b.ID_NUM = a.ID_NUM AND b.TRANS_DESC LIKE 'Federally Unsub Stafford Loan%' AND ABS(b.TRANS_AMT) = 990
    WHERE a.TRANS_DESC LIKE 'Tuition - Fall%' AND ABS(a.TRANS_AMT) = 805`);
  console.log(JSON.stringify(r.recordset));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
