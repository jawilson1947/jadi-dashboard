/*
  scripts/ai-analysis-once.ts — run every Phase 8a analysis against the real database and print
  the computed half.

  Usage:  npm run ai:once            (staging)
          npm run ai:once:prod

  WHY: the modules are unit-tested against the mock, which proves the shapes. This proves the
  ARITHMETIC against real data, and is how the figures in FINDINGS section 9 stay checkable. It
  prints only what the page would print -- aggregates -- and never touches a model.
*/
import "./load-env";
import { closePools } from "../src/server/db/mssql";
import { ANALYSIS_MODULES, getAnalysisView } from "../src/server/services/ai/analysis";

async function main(): Promise<void> {
  for (const summary of ANALYSIS_MODULES) {
    const view = await getAnalysisView(summary.key);
    if (!view) continue;
    console.log(`\n${"=".repeat(78)}\n${view.ref} — ${view.title}\n${"=".repeat(78)}`);
    console.log(`\n${view.presentation.headline}\n`);
    for (const f of view.presentation.figures) {
      console.log(`  ${f.label.padEnd(38)} ${f.value}${f.hint ? `   (${f.hint})` : ""}`);
    }
    for (const t of view.presentation.tables) {
      console.log(`\n  ${t.caption}`);
      console.log(`  ${t.columns.join(" | ")}`);
      for (const row of t.rows.slice(0, 30)) console.log(`  ${row.join(" | ")}`);
      if (t.rows.length > 30) console.log(`  ... ${t.rows.length - 30} more rows`);
    }
    if (view.confidence.length) {
      console.log("\n  What this cannot support:");
      for (const c of view.confidence) console.log(`   - ${c.subject}: ${c.effect}`);
    }
    console.log(`\n  ${view.dark ? `[dark: ${view.dark.reason} — ${view.dark.assumption}]` : `[narrated by ${view.narrative?.model}]`}`);
  }
  await closePools();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
