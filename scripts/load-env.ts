/**
 * Loads .env.local (then .env) into process.env for the command-line scripts.
 *
 * Next.js does this for the web app and the worker, which is why `npm run dev` finds
 * DASH_CONNECTION_STRING while `npm run db:migrate` did not. Import this FIRST in any script:
 *   import "./load-env";
 *
 * Rules: real environment variables always win (so CI and one-off overrides still work), values are
 * split on the FIRST "=" only — connection strings are full of them — surrounding quotes are dropped,
 * and CRLF line endings are handled, since these files are edited on Windows. Nothing is printed:
 * these files hold secrets.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Applies the files in order; the first definition of a key wins, and a real env var beats both. */
export function loadEnvFiles(cwd: string = process.cwd(), files: string[] = [".env.local", ".env"]): string[] {
  const loaded: string[] = [];
  for (const file of files) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    loaded.push(file);
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
  return loaded;
}

loadEnvFiles();
