const sql = require('C:/jadiDashboard/node_modules/mssql');
const cs = 'Server=10.1.0.171;Database=ousadb;User Id=DataOps;Password=DanaDenyse32;Encrypt=false;TrustServerCertificate=true';
const id = process.argv[2];
const dropDate = process.argv[3] || '2026-08-14';
(async () => {
  const p = await sql.connect(cs);
  // exactly how the app calls it
  const r = await p.request()
    .input('id', sql.VarChar(50), id)
    .input('dropDate', sql.Date, new Date(dropDate + 'T00:00:00Z'))
    .query('EXEC dbo.Sp_GetFCWorksheetItems @ID_NUM = @id, @DropClassesDate = @dropDate;');
  console.log('recordsets:', r.recordsets.length, 'lengths:', r.recordsets.map(s => s.length).join(','));
  const last = r.recordsets[r.recordsets.length - 1];
  console.log('columns of last set:', JSON.stringify(Object.keys(last[0] || {})));
  console.log('first 3 rows:');
  for (const row of last.slice(0, 3)) console.log(JSON.stringify(row));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
