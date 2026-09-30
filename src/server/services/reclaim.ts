import { getDataProvider } from "../repositories";
import { DataSourceUnavailableError, type DataProvider, type ReclaimDiagnostic, type ReclaimOutcome } from "../repositories/types";
import { getAppStore } from "../store";
import type { AppStore, ReclaimedStudentRecord } from "../store/types";
import { audit } from "../audit/audit";
import type { Principal } from "../authz/permissions";

/**
 * Reclaiming a student that Jenzabar knows about and tblStudent does not
 * (docs/STUDENT-RECLAIM-PLAN.md).
 *
 * The nightly loader (db/sql/CreateNewStudentFromJenzabar.sql) inner-joins student_master,
 * name_master, biograph_master and a LHP/CUR/EML address row, so a student missing any one of
 * those is skipped silently. This turns "No students match that search" into an explanation and,
 * for an administrator, an offer.
 *
 * The write is the application's only write to source data and goes through a dbo-owned stored
 * procedure the app holds EXECUTE on; the DENY on SCHEMA::dbo stays in force for everything else
 * (A-32, S-D1). Nothing here constructs an INSERT.
 */

export interface ReclaimDeps {
  provider?: DataProvider;
  store?: AppStore;
  now?: Date;
}

/** What the not-found card should show. Three distinct situations, not one message. */
export type NotFoundKind =
  /** Searched by name, or the id is not well formed — nothing to diagnose. */
  | "no-match"
  /**
   * The search found nothing, but the student IS in tblStudent. Not a contradiction: the search
   * compares idnumber as TEXT while the diagnostic compares it numerically, so a record stored
   * padded ('0123456') is missed by a search for '123456' and found here. Offering to create them
   * would be wrong; pointing at the existing profile is what the user actually needs.
   */
  | "already-present"
  /** Not in tblStudent and not in Jenzabar either. Almost always a mistyped id. */
  | "not-in-jenzabar"
  /** In Jenzabar, absent from tblStudent: reclaimable, subject to the rules below. */
  | "reclaimable";

export interface ReclaimView {
  kind: NotFoundKind;
  idnumber: string;
  diagnostic: ReclaimDiagnostic | null;
  /** Artifact-by-artifact, in the order the loader needs them. */
  artifacts: { key: string; label: string; found: boolean; detail: string | null }[];
  /** True when at least one artifact the loader requires is missing. */
  hasGaps: boolean;
  /** A reclaim would be refused: no name record means no defensible identity (S-D2). */
  blocked: boolean;
  blockedReason: string | null;
  /** The procedure is not installed or not granted — the diagnostic still stands. */
  writeUnavailable: boolean;
}

/**
 * student_master.ID_NUM is numeric and tblStudent.idnumber is varchar, so '0123456' and '123456'
 * are the same student to Jenzabar and different strings to tblStudent. Normalising here is what
 * stops a padded id reading as "not in Jenzabar" for a student who is plainly there.
 */
export function normalizeId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d{1,18}$/.test(trimmed)) return null;
  return String(Number(trimmed));
}

export function buildArtifacts(d: ReclaimDiagnostic): ReclaimView["artifacts"] {
  const name = [d.proposed.lastName, d.proposed.firstName].filter(Boolean).join(", ");
  return [
    { key: "student_master", label: "Jenzabar student record", found: d.hasStudentMaster, detail: null },
    { key: "name_master", label: "Name record", found: d.hasNameRecord, detail: d.hasNameRecord ? name || null : "no name on file" },
    {
      key: "biograph_master",
      label: "Biographical record",
      found: d.hasBiograph,
      detail: d.hasBiograph ? null : "no date of birth, SSN or gender",
    },
    {
      key: "address_master",
      label: "Address with a code the loader reads",
      found: d.qualifyingAddressRows > 0,
      // The line that usually explains the miss: an address exists, under a code nobody loads.
      detail:
        d.qualifyingAddressRows > 0
          ? d.addressCodes
          : d.addressRows > 0
            ? `${d.addressRows} address row${d.addressRows === 1 ? "" : "s"}, code${d.addressRows === 1 ? "" : "s"} ${d.addressCodes ?? "unknown"} — the loader reads only LHP, CUR and EML`
            : "no address rows at all",
    },
  ];
}

/**
 * Diagnose one id. Read-only and sub-second: four existence checks against a bound id. This never
 * runs the set-wide DiagnoseMissingStudents.sql, which answers a different question and would be a
 * 40-second answer to a one-student question.
 */
export async function getReclaimView(rawId: string, deps: ReclaimDeps = {}): Promise<ReclaimView> {
  const id = normalizeId(rawId);
  const empty: ReclaimView = {
    kind: "no-match",
    idnumber: rawId.trim(),
    diagnostic: null,
    artifacts: [],
    hasGaps: false,
    blocked: false,
    blockedReason: null,
    writeUnavailable: false,
  };
  if (!id) return empty;

  const provider = deps.provider ?? getDataProvider();
  let d: ReclaimDiagnostic;
  try {
    d = await provider.getReclaimDiagnostic(id);
  } catch {
    // The lookup page must not fail because a diagnostic could not run; the caller renders the
    // plain not-found message plus a note that the Jenzabar check was unavailable.
    return empty;
  }

  // Checked before hasStudentMaster: whether Jenzabar knows them is beside the point once we know
  // the record they were looking for already exists.
  if (d.inTblStudent) return { ...empty, kind: "already-present", idnumber: id, diagnostic: d };
  if (!d.hasStudentMaster) return { ...empty, kind: "not-in-jenzabar", idnumber: id, diagnostic: d };

  const artifacts = buildArtifacts(d);
  return {
    kind: "reclaimable",
    idnumber: id,
    diagnostic: d,
    artifacts,
    hasGaps: artifacts.some((a) => !a.found),
    blocked: !d.hasNameRecord,
    blockedReason: d.hasNameRecord ? null : "There is no name record for this student, so a record cannot be created from what Jenzabar holds.",
    writeUnavailable: false,
  };
}

/** The values a reclaim would write, for the confirm panel. Shown, not summarised. */
export interface ProposedRecord {
  label: string;
  value: string;
  missing: boolean;
}

export function buildProposed(d: ReclaimDiagnostic): ProposedRecord[] {
  const p = d.proposed;
  const name = [p.lastName, p.firstName, p.middleName].filter(Boolean).join(", ");
  const place = [p.city, p.stateCode].filter(Boolean).join(", ");
  return [
    { label: "Name", value: name || "—", missing: !p.lastName },
    // S-D3: the real address from name_master, not the batch script's 'none@oakwood.edu', which
    // the mail-merge reports would export as though a letter could reach it.
    { label: "Email", value: p.email ?? "—", missing: !p.email },
    { label: "Address", value: place || "—", missing: d.qualifyingAddressRows === 0 },
    { label: "Date of birth, SSN, gender", value: d.hasBiograph ? "from Jenzabar" : "—", missing: !d.hasBiograph },
    { label: "Balance", value: "0.00", missing: false },
    { label: "Classification", value: "NA", missing: false },
    { label: "Last cleared", value: "XX0000", missing: false },
  ];
}

export interface ReclaimAttempt {
  outcome: ReclaimOutcome | "unavailable";
  /** True when the caller should be sent to the Bio Card. */
  landOnProfile: boolean;
  message: string;
}

export const RECLAIM_MESSAGES: Record<ReclaimOutcome | "unavailable", string> = {
  inserted: "Record created.",
  // Someone else got there first. That is a success from the user's point of view, not an error.
  already_exists: "This student already exists in tblStudent.",
  not_in_jenzabar: "There is no record for this ID in Jenzabar, so there is nothing to reclaim.",
  no_name_record: "There is no name record in Jenzabar, so a student record cannot be created.",
  partial_not_allowed: "Source records are missing. Confirm again to create an incomplete record.",
  invalid_id: "That ID is not a valid student number.",
  unavailable: "The reclaim procedure is not installed on this database yet. Ask a DBA to run db/production/10_usp_reclaim_student.sql.",
};

/**
 * Perform the reclaim. Every path writes an audit row carrying the artifacts found and missing, so
 * the log explains the state of the record it created rather than only that one was created.
 */
export async function reclaimStudent(
  actor: Principal,
  rawId: string,
  allowPartial: boolean,
  correlationId: string,
  deps: ReclaimDeps = {},
): Promise<ReclaimAttempt> {
  const id = normalizeId(rawId);
  if (!id) return { outcome: "invalid_id", landOnProfile: false, message: RECLAIM_MESSAGES.invalid_id };

  const provider = deps.provider ?? getDataProvider();
  const store = deps.store ?? getAppStore();

  let result;
  try {
    result = await provider.reclaimStudent(id, actor.email, allowPartial);
  } catch (err) {
    if (err instanceof DataSourceUnavailableError) {
      await audit(actor, "student.reclaim", {
        correlationId,
        targetType: "student",
        targetId: id,
        metadata: { outcome: "unavailable", allowPartial },
      });
      return { outcome: "unavailable", landOnProfile: false, message: RECLAIM_MESSAGES.unavailable };
    }
    throw err;
  }

  await audit(actor, "student.reclaim", {
    correlationId,
    targetType: "student",
    targetId: id,
    metadata: {
      outcome: result.outcome,
      allowPartial,
      hadNameRecord: result.hasNameRecord,
      hadBiograph: result.hasBiograph,
      hadQualifyingAddress: result.hasQualifyingAddress,
      rowsInserted: result.rowsInserted,
    },
  });

  if (result.outcome === "inserted") {
    // The procedure writes dash.ReclaimedStudent inside its own transaction. This is a fallback
    // for stores that are not the ousadb dash schema (memory mode, tests) so the incomplete-record
    // banner behaves identically there; a duplicate is a no-op.
    const record: ReclaimedStudentRecord = {
      idnumber: id,
      reclaimedAt: deps.now ?? new Date(),
      reclaimedBy: actor.email,
      hadNameRecord: result.hasNameRecord,
      hadBiograph: result.hasBiograph,
      hadQualifyingAddress: result.hasQualifyingAddress,
      source: "procedure",
      resolvedAt: null,
      resolvedBy: null,
    };
    try {
      if (!(await store.getReclaimedStudent(id))) await store.recordReclaimedStudent(record);
    } catch {
      // The record exists either way; a failed log write must not undo a successful reclaim.
    }
  }

  return {
    outcome: result.outcome,
    landOnProfile: result.outcome === "inserted" || result.outcome === "already_exists",
    message: RECLAIM_MESSAGES[result.outcome],
  };
}

/** Banner text for a reclaimed record, or null when the student was not reclaimed by this app. */
export function describeGaps(record: ReclaimedStudentRecord): string | null {
  const gaps: string[] = [];
  if (!record.hadBiograph) gaps.push("date of birth, SSN and gender");
  if (!record.hadQualifyingAddress) gaps.push("address and phone");
  if (gaps.length === 0) return null;
  return `This record was created from Jenzabar and is incomplete: ${gaps.join("; ")} could not be filled because the source records were missing.`;
}
