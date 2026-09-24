const sql = require('C:/jadiDashboard/node_modules/mssql');
const cs = 'Server=192.168.0.6;Database=ousadb;User Id=DataOps;Password=DanaDenyse32;Encrypt=false;TrustServerCertificate=true';
(async () => {
  const p = await sql.connect(cs);
  const d = await p.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.Sp_GetFCWorksheetItems')) AS d");
  console.log('=== DEFINITION ===');
  console.log((d.recordset[0] && d.recordset[0].d) || '(none)');
  const t = await p.request().query('SELECT TOP 1 CONVERT(varchar(10), DropClassesDate, 23) AS dcd FROM dbo.tblOUSA WHERE isCurrent = 1');
  console.log('=== DROPDATE ===', JSON.stringify(t.recordset[0]));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
