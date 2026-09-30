/*
  scripts/run-sql.mjs — run a read-only .sql file against the chosen target and print the results.

  Usage:  node scripts/run-sql.mjs db/sql/AI_Q7_SpringAttribution.sql [--target staging|production]

  WHY THIS EXISTS: the diagnostics in db/sql/ answer questions the plan depends on, and there was no
  way to run one without opening SSMS. This is a reader, not a migration tool.

  SAFETY: it refuses anything that is not a SELECT. The staging login is read-only in any case, but
  a file with a stray UPDATE should fail here rather than at the server. It never prints the
  connection string, and it never writes.
*/
import { readFileSync } from "node:fs";
import path from "node:path";
import sql from "mssql";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/run-sql.mjs <file.sql> [--target staging|production]"); process.exit(2); }

const tIdx = process.argv.indexOf("--target");
const target = (tIdx > -1 ? process.argv[tIdx + 1] : "staging").toUpperCase();

// .env.local, read here rather than pulling in a dependency.
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim();
}
const conn = env[`OUSADB_CONNECTION_STRING_${target}`] || env.OUSADB_CONNECTION_STRING;
if (!conn) { console.error(`No OUSADB_CONNECTION_STRING_${target} in .env.local`); process.exit(2); }

const text = readFileSync(file, "utf8");
// Comment-stripped copy for the guard, so a SELECT-only file whose header mentions UPDATE passes.
const executable = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const forbidden = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE)\b/i.exec(executable);
if (forbidden) { console.error(`Refusing to run: file contains ${forbidden[1]}. This runner is SELECT-only.`); process.exit(3); }

const host = /(?:Server|Data Source)\s*=\s*([^;]+)/i.exec(conn);
console.log(`target=${target.toLowerCase()} host=${host ? host[1] : "unknown"} file=${path.basename(file)}\n`);

const pool = await sql.connect(conn);
try {
  const r = await pool.request().query(executable);
  const sets = r.recordsets?.length ? r.recordsets : [r.recordset].filter(Boolean);
  sets.forEach((rows, i) => {
    console.log(`--- result ${i + 1} (${rows.length} row${rows.length === 1 ? "" : "s"}) ---`);
    if (rows.length) console.table(rows);
    console.log("");
  });
} finally {
  await pool.close();
}
