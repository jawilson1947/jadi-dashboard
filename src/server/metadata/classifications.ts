/**
 * Classification mappings (Spec §7.3). Seeded here and mirrored into the
 * dash.ClassificationMapping table (Phase 3); at runtime the admin-managed
 * table is the source of truth (Phase 2). Nothing in UI code references codes directly.
 */
export interface ClassificationMapping {
  sourceCode: string;
  displayName: string;
  sortOrder: number;
}

export const DEFAULT_CLASSIFICATION_MAPPINGS: ClassificationMapping[] = [
  { sourceCode: "FR", displayName: "Freshmen", sortOrder: 10 },
  { sourceCode: "FF", displayName: "Freshmen", sortOrder: 10 },
  { sourceCode: "SO", displayName: "Sophomore", sortOrder: 20 },
  { sourceCode: "JR", displayName: "Junior", sortOrder: 30 },
  { sourceCode: "SR", displayName: "Senior", sortOrder: 40 },
  { sourceCode: "GR", displayName: "Graduate", sortOrder: 50 },
  { sourceCode: "TR", displayName: "Transfer Student", sortOrder: 60 },
  { sourceCode: "INCOMING TRANSFER", displayName: "Transfer Student", sortOrder: 60 },
  { sourceCode: "AE", displayName: "LEAP", sortOrder: 70 },
  { sourceCode: "AD", displayName: "Academy", sortOrder: 80 },
  { sourceCode: "SP", displayName: "Special", sortOrder: 90 },
  { sourceCode: "EM", displayName: "Employee", sortOrder: 100 },
  { sourceCode: "DI", displayName: "Dietetic", sortOrder: 110 },
  { sourceCode: "XX", displayName: "Unclassified", sortOrder: 999 },
  { sourceCode: "", displayName: "Unclassified", sortOrder: 999 },
];

/**
 * Normalize a raw source code (Spec §15: blank/null/unknown handled consistently;
 * §7.3: "Incoming Transfer" is treated as TR before FF/FR are combined as Freshmen).
 */
export function normalizeClassificationCode(raw: string | null | undefined): string {
  const code = (raw ?? "").trim().toUpperCase();
  if (code === "INCOMING TRANSFER") return "TR";
  return code;
}

export function classificationDisplayName(
  raw: string | null | undefined,
  isIncomingTransfer = false,
  mappings: ClassificationMapping[] = DEFAULT_CLASSIFICATION_MAPPINGS,
): { displayName: string; sortOrder: number; mapped: boolean } {
  // A-19: "Incoming Transfer" is TEL_WEB_GRP_CDE = 22, not a class code; it overrides cCode
  // BEFORE FF/FR are combined as Freshmen (Spec §7.3).
  if (isIncomingTransfer) return { displayName: "Transfer Student", sortOrder: 60, mapped: true };
  const code = normalizeClassificationCode(raw);
  const hit = mappings.find((m) => m.sourceCode === code);
  if (hit) return { displayName: hit.displayName, sortOrder: hit.sortOrder, mapped: true };
  // Unknown but non-blank code: surface it rather than silently folding into Unclassified.
  return { displayName: code ? `Unmapped (${code})` : "Unclassified", sortOrder: 998, mapped: false };
}
