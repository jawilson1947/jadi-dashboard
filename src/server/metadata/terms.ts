import { getDataProvider } from "../repositories";
import type { DataProvider, TermMetadata } from "../repositories/types";
import { resolveTerms } from "../repositories/types";
import { getAppStore } from "../store";
import type { AppStore } from "../store/types";

/**
 * Single source of truth for Current and Previous semester (Spec §15, §14.3; ASSUMPTIONS A-16, A-20):
 * tblOUSA rows with isCurrent = 1 / wasCurrent = 1. The app reads them, never writes them.
 *
 * Preference order: latest `terms` snapshot (cheap, captured nightly at 21:05) → live provider read
 * (tblOUSA is a 28-row table, so the fallback is fast even on mssql).
 */
export interface CurrentTerms {
  current: TermMetadata;
  previous: TermMetadata;
  /** Keys whose LastCleared population defines the current receivable (Spec §6.2). */
  currentKeys: string[];
  previousKeys: string[];
  label: string;
  /** Where the metadata came from, for the header. */
  source: { kind: "snapshot" | "live"; capturedAt: Date };
  all: TermMetadata[];
}

export async function getCurrentTerms(store: AppStore = getAppStore(), provider: DataProvider = getDataProvider()): Promise<CurrentTerms> {
  const snap = await store.latestSnapshot<TermMetadata[]>("terms");
  let all: TermMetadata[];
  let source: CurrentTerms["source"];
  if (snap) {
    all = snap.payload.map(reviveTerm);
    source = { kind: "snapshot", capturedAt: snap.capturedAt };
  } else {
    all = await provider.getTermMetadata();
    source = { kind: "live", capturedAt: new Date() };
  }
  const r = resolveTerms(all);
  return { ...r, label: r.current.semesterName, source, all };
}

/** Snapshots are JSON; restore Date fields. */
function reviveTerm(t: TermMetadata): TermMetadata {
  const d = (v: unknown) => (v ? new Date(v as string) : null);
  return { ...t, semesterBegins: d(t.semesterBegins)!, semesterEnds: d(t.semesterEnds)!, dropClassesDate: d(t.dropClassesDate) };
}

/**
 * Academic year for a tblOUSA row (Spec §9.1): Fall YYYY + Spring YYYY+1.
 * Summer is grouped with the academic year that just ended (pending confirmation, FINDINGS §3).
 */
export function academicYearOf(t: TermMetadata): string {
  const y = Number(t.yearCode);
  if (t.semesterName.startsWith("Fall")) return `${y}-${y + 1}`;
  return `${y - 1}-${y}`;
}
