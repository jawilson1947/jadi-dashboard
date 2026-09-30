import { getDataProvider } from "../repositories";
import { DataSourceUnavailableError, type DataProvider, type SemesterUpdateOutcome } from "../repositories/types";
import { audit } from "../audit/audit";
import type { Principal } from "../authz/permissions";
import { normalizeId } from "./reclaim";

/**
 * Setting a student's semester from their Jenzabar registration (A-33).
 *
 * A student whose `lastcleared` is the `XX0000` sentinel — every reclaimed student, among others —
 * reads as "No semester on record" everywhere, and falls outside every current-term population.
 * Where Jenzabar shows a current-term registration, this fills that in.
 *
 * The write goes through `dbo.usp_UpdateStudentSemester`, a dbo-owned procedure the application
 * holds EXECUTE on. The DENY on SCHEMA::dbo stays in force for everything else. Nothing here
 * constructs an UPDATE.
 */

export type SemesterUpdateStatus = SemesterUpdateOutcome | "unavailable";

export interface SemesterUpdateAttempt {
  status: SemesterUpdateStatus;
  /** The semester written, when one was. */
  lastCleared: string | null;
  message: string;
  /** True when the Bio card should now relabel to "No Semester Info found" (step 4). */
  noInfoFound: boolean;
}

export const SEMESTER_UPDATE_MESSAGES: Record<SemesterUpdateStatus, string> = {
  updated: "Semester updated from the Jenzabar registration.",
  // Not an error: the student simply is not registered for the current term. This is the case
  // step 4 asks for — the label changes so the answer is visible rather than the button just
  // appearing to do nothing.
  no_registration: "No current-term registration found in Jenzabar, so there is no semester to set.",
  no_student: "That student is no longer in tblStudent.",
  invalid_id: "That ID is not a valid student number.",
  unavailable:
    "The semester update procedure is not installed on this database yet. Ask a DBA to run db/production/11_usp_update_student_semester.sql.",
};

export interface SemesterUpdateDeps {
  provider?: DataProvider;
}

/**
 * Whether the Update Semester button should appear.
 *
 * Two cases, both of which leave the student outside every current-term population:
 *   - the XX0000 sentinel, rendered "No semester on record" (what a reclaimed student carries);
 *   - a stored code that matches no tblOUSA row, rendered "<code> (unknown term)".
 *
 * A resolvable semester is left alone: the button fills a gap, it does not overwrite a good value
 * with a guess.
 */
export function canUpdateSemester(lastCleared: string | null | undefined, label: string): boolean {
  if (!lastCleared) return true;
  return label === "No semester on record" || label.endsWith("(unknown term)");
}

export async function updateStudentSemester(
  actor: Principal,
  rawId: string,
  correlationId: string,
  deps: SemesterUpdateDeps = {},
): Promise<SemesterUpdateAttempt> {
  const id = normalizeId(rawId);
  if (!id) {
    return { status: "invalid_id", lastCleared: null, message: SEMESTER_UPDATE_MESSAGES.invalid_id, noInfoFound: false };
  }

  const provider = deps.provider ?? getDataProvider();
  let result;
  try {
    result = await provider.updateStudentSemester(id, actor.email);
  } catch (err) {
    if (err instanceof DataSourceUnavailableError) {
      await audit(actor, "student.semester_update", {
        correlationId,
        targetType: "student",
        targetId: id,
        metadata: { outcome: "unavailable" },
      });
      return { status: "unavailable", lastCleared: null, message: SEMESTER_UPDATE_MESSAGES.unavailable, noInfoFound: false };
    }
    throw err;
  }

  // The semester written is recorded, not just that something was written: this change moves a
  // student into current-term populations, so "which semester" is the part someone will need later.
  await audit(actor, "student.semester_update", {
    correlationId,
    targetType: "student",
    targetId: id,
    metadata: { outcome: result.outcome, lastCleared: result.lastCleared, exPeriod: result.exPeriod, rowsUpdated: result.rowsUpdated },
  });

  return {
    status: result.outcome,
    lastCleared: result.lastCleared,
    message: SEMESTER_UPDATE_MESSAGES[result.outcome],
    noInfoFound: result.outcome === "no_registration",
  };
}
