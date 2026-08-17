// Transactional email — event contract.
//
// Business logic emits a typed *event*, never an SDK call. Nothing outside
// `server/email/` imports Resend, so the provider can be swapped, stubbed in
// tests, or disabled in an environment without touching a single caller.

export type EmailEventType =
  | 'REPORT_REMINDER'
  | 'REPORT_REVIEWED'
  | 'COACH_FEEDBACK'
  | 'TARGETED_QUESTION'
  | 'NEEDS_ATTENTION'
  | 'CLASSROOM_EVENT'
  | 'INTERNSHIP_EVENT';

export interface EmailRecipient {
  /** Mirror user id, when the recipient is a known user. Used for audit joins. */
  id?: string | null;
  email: string;
  name?: string | null;
}

export interface EmailEvent {
  type: EmailEventType;
  to: EmailRecipient;
  /**
   * Idempotency key. Two events with the same key are delivered at most once,
   * ever — enforced by a unique index on `notification_dispatches.dedupe_key`,
   * not by in-process state. Include the period for anything recurring, e.g.
   * `REPORT_REMINDER:<userId>:<cycleId>`.
   */
  dedupeKey: string;
  subject: string;
  /** Plain-text body. Rendered to minimal HTML by the adapter. */
  body: string;
  /** Optional deep link surfaced as a call to action. */
  actionUrl?: string | null;
  actionLabel?: string | null;
}

export type EmailSendOutcome =
  | { status: 'SENT'; providerMessageId: string | null }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; error: string };

/** The provider seam. `ResendEmailProvider` in production, a fake in tests. */
export interface EmailProvider {
  readonly name: string;
  send(event: EmailEvent): Promise<EmailSendOutcome>;
}
