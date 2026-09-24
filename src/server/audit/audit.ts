import { randomUUID } from "node:crypto";
import type { Principal } from "../authz/permissions";

/**
 * Audit writer (Spec §18). Phase 1 keeps an in-memory ring buffer and structured
 * console output; U4 (USER-MANAGEMENT-PLAN) swaps the sink for dash.AuditEvent.
 *
 * Never log secrets, full query results, or export contents — only counts and filters.
 */
export type AuditAction =
  | "auth.sign_in"
  | "auth.sign_in_failed"
  | "auth.sign_out"
  | "dashboard.view"
  | "dashboard.refresh"
  | "student.list_view"
  | "student.profile_view"
  // Phase 5 — the Student subsystem is student-level end to end, so each card has its own action.
  | "student.search"
  | "student.pii_reveal"
  | "student.photo_view"
  | "student.transactions_view"
  | "student.clearance_analyze"
  | "ai.notice_draft"
  | "worksheet.view"
  | "export.create"
  | "ai.request"
  | "admin.change"
  | "job.manual_run"
  | "user.create"
  | "user.update"
  | "user.unlock"
  | "user.locked"
  | "credential.token_issued"
  | "credential.token_rejected"
  | "credential.set"
  | "credential.change"
  | "session.revoke";

export interface AuditEvent {
  id: string;
  createdAt: Date;
  actorUserId: string | null;
  actorEmail: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  correlationId: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async write(event: AuditEvent): Promise<void> {
    this.events.push(event);
    if (this.events.length > 5000) this.events.shift();
    if (process.env.NODE_ENV !== "test") {
      console.info(JSON.stringify({ level: "audit", ...event }));
    }
  }
}

let sink: AuditSink = new MemoryAuditSink();

export function setAuditSink(next: AuditSink): void {
  sink = next;
}

export function getMemoryAuditEvents(): AuditEvent[] {
  return sink instanceof MemoryAuditSink ? sink.events : [];
}

export function newCorrelationId(): string {
  return randomUUID();
}

export async function audit(
  actor: Principal | null,
  action: AuditAction,
  details: Omit<AuditEvent, "id" | "createdAt" | "actorUserId" | "actorEmail" | "action" | "correlationId"> & { correlationId?: string } = {},
): Promise<string> {
  const correlationId = details.correlationId ?? newCorrelationId();
  await sink.write({
    id: randomUUID(),
    createdAt: new Date(),
    actorUserId: actor?.userId ?? null,
    actorEmail: actor?.email ?? null,
    action,
    targetType: details.targetType,
    targetId: details.targetId,
    metadata: details.metadata,
    correlationId,
  });
  return correlationId;
}
