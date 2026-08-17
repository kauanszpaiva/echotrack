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
   * Application-level idempotency key. Two events with the same key are one
   * logical delivery, enforced by notification_dispatches.dedupe_key. The
   * Resend adapter also derives its provider idempotency key from this value so
   * an ambiguous network retry cannot create a duplicate provider send inside
   * Resend's idempotency window.
   *
   * Include the period for recurring events, e.g.
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
  | {
      status: 'SKIPPED';
      reason: string;
      /** True only when a later attempt is both useful and safe. */
      retryable?: boolean;
      /** False when no provider request was made (for example missing config). */
      providerAttempted?: boolean;
    }
  | {
      status: 'FAILED';
      error: string;
      /** True for transient/ambiguous failures that may be retried safely. */
      retryable?: boolean;
      /** Normally true for provider/network failures. */
      providerAttempted?: boolean;
    };

/** The provider seam. `ResendEmailProvider` in production, a fake in tests. */
export interface EmailProvider {
  readonly name: string;
  send(event: EmailEvent): Promise<EmailSendOutcome>;
}
