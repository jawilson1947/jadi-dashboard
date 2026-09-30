import { getDataProvider } from "../repositories";
import { DataSourceUnavailableError, type DataProvider, type ClearanceCheckOutcome } from "../repositories/types";
import { audit } from "../audit/audit";
import type { Principal } from "../authz/permissions";
import { normalizeId } from "./reclaim";

/**
 * Confirming a student's clearance against the source view (A-34).
 *
 * `tblStudent.ClearedCurrentSession` is a stored flag, and the clearance actions in
 * `VIEW_OURM_CLEARED` are the record of what actually happened. The flag can lag behind them — a
 * clearance recorded after the nightly roll, a reclaimed student whose row was built from Jenzabar
 * analogs. This reconciles the flag with the actions for one student, on demand.
 *
 * It only ever moves in one direction. A student with no clearance action is reported as not
 * cleared and nothing is written (J. Wilson, 2026-09-30): an empty view is not evidence that a
 * stored clearance was wrong, and an unattended un-clear on a billing record is unrecoverable from
 * here.
 *
 * The write goes through `dbo.usp_CheckStudentClearance`, a dbo-owned procedure the application
 * holds EXECUTE on. The DENY on SCHEMA::dbo stays in force for everything else. Nothing here
 * constructs an UPDATE, and nothing here reads the source view directly.
 */

export type ClearanceCheckStatus = ClearanceCheckOutcome | "unavailable";

export interface ClearanceCheckAttempt {
  status: ClearanceCheckStatus;
  /** The semester named on the record after the write, when one happened. */
  lastCleared: string | null;
  /** YYYYMMDD as written to tblStudent.ClearedOn. */
  clearedOn: string | null;
  message: string;
}

export const CLEARANCE_CHECK_MESSAGES: Record<ClearanceCheckStatus, string> = {
  cleared: "Clearance confirmed from the source records — the student is now marked cleared for the current semester.",
  // Not an error: this IS the answer. The student has no clearance action, so the flag was right.
  no_clearance_record:
    "No clearance action found for this student in the current semester, so the record is unchanged.",
  no_student: "That student is no longer in tblStudent.",
  invalid_id: "That ID is not a valid student number.",
  unavailable:
    "The clearance check procedure is not installed on this database yet. Ask a DBA to run db/production/12_usp_check_clearance.sql.",
};

export interface ClearanceCheckDeps {
  provider?: DataProvider;
}

/**
 * Whether the Check Clearance button should appear.
 *
 * Only for a student the record says is NOT cleared. A student already flagged cleared has nothing
 * to reconcile, and offering the button there would invite someone to press it expecting the
 * opposite action — the one this deliberately does not perform.
 */
export function canCheckClearance(clearedCurrentSession: boolean): boolean {
  return !clearedCurrentSession;
}

export async function checkStudentClearance(
  actor: Principal,
  rawId: string,
  correlationId: string,
  deps: ClearanceCheckDeps = {},
): Promise<ClearanceCheckAttempt> {
  const id = normalizeId(rawId);
  if (!id) {
    return { status: "invalid_id", lastCleared: null, clearedOn: null, message: CLEARANCE_CHECK_MESSAGES.invalid_id };
  }

  const provider = deps.provider ?? getDataProvider();
  let result;
  try {
    result = await provider.checkStudentClearance(id, actor.email);
  } catch (err) {
    if (err instanceof DataSourceUnavailableError) {
      await audit(actor, "student.clearance_check", {
        correlationId,
        targetType: "student",
        targetId: id,
        metadata: { outcome: "unavailable" },
      });
      return { status: "unavailable", lastCleared: null, clearedOn: null, message: CLEARANCE_CHECK_MESSAGES.unavailable };
    }
    throw err;
  }

  /**
   * The no-op case is audited too, not just the write. "Someone asked whether this student was
   * cleared and the answer was no" is the fact that explains why a balance stayed in the collection
   * population, and it is the only record that the question was ever asked.
   *
   * clearedBy is the operator named on the SOURCE action, which is a different fact from the
   * dashboard user in `actor` — that distinction is the point of keeping both.
   */
  await audit(actor, "student.clearance_check", {
    correlationId,
    targetType: "student",
    targetId: id,
    metadata: {
      outcome: result.outcome,
      lastCleared: result.lastCleared,
      clearedOn: result.clearedOn,
      sourceClearedBy: result.clearedBy,
      rowsUpdated: result.rowsUpdated,
    },
  });

  return {
    status: result.outcome,
    lastCleared: result.lastCleared,
    clearedOn: result.clearedOn,
    message: CLEARANCE_CHECK_MESSAGES[result.outcome],
  };
}
