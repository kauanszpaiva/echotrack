// Email dispatch — deduplication, persistence and failure isolation.
//
// Guarantees:
//
//   1. **One logical delivery.** `notification_dispatches.dedupe_key` is UNIQUE.
//      A SENT row is terminal and is never sent again.
//   2. **Safe retry, not blind retry.** Retryable provider attempts may be
//      replayed only while Resend's provider idempotency window is still safely
//      available. A no-op caused by missing configuration can be retried later
//      because no provider request happened. Ambiguous attempts outside the
//      window require operator reconciliation instead of risking a duplicate.
//   3. **Never break the caller.** A submitted weekly report is valid whether or
//      not its notification goes out. `dispatch` resolves rather than throws —
//      failures are recorded on the ledger row and contained here.

import prisma from '../prisma.js';
import type { EmailEvent, EmailProvider, EmailSendOutcome } from './types.js';
import { ResendEmailProvider } from './resendProvider.js';

let provider: EmailProvider = new ResendEmailProvider();

/** Keep below Resend's documented 24-hour idempotency retention window. */
const PROVIDER_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

/** Swap the provider. Tests use this; production never calls it. */
export function setEmailProvider(next: EmailProvider): void {
  provider = next;
}

export function getEmailProvider(): EmailProvider {
  return provider;
}

/** Absolute link into the app for a call to action. */
export function appUrl(path: string): string | null {
  const base = process.env.APP_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface DispatchResult {
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  dedupeKey: string;
  reason?: string;
}

interface LedgerMeta {
  subject?: string;
  actionUrl?: string | null;
  retryable?: boolean;
  providerAttempted?: boolean;
}

interface LedgerRow {
  id: string;
  status: string;
  attempts: number;
  payload: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function parseLedgerMeta(payload: string | null | undefined): LedgerMeta {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function ledgerPayload(event: EmailEvent, meta: Pick<LedgerMeta, 'retryable' | 'providerAttempted'>): string {
  return JSON.stringify({
    subject: event.subject,
    actionUrl: event.actionUrl ?? null,
    retryable: meta.retryable,
    providerAttempted: meta.providerAttempted,
  });
}

function retryDecision(row: LedgerRow): { retry: boolean; reason?: string } {
  if (row.status === 'SENT') return { retry: false, reason: 'already dispatched' };

  const meta = parseLedgerMeta(row.payload);
  if (meta.retryable !== true) {
    return { retry: false, reason: 'previous attempt is not retryable' };
  }

  // Nothing reached the provider (for example the deployment had no mail
  // credentials). This is safe to retry even after the provider window.
  if (meta.providerAttempted === false) return { retry: true };

  const lastAttempt = row.updatedAt ?? row.createdAt;
  if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < PROVIDER_RETRY_WINDOW_MS) {
    return { retry: true };
  }

  // The provider may have accepted an earlier request, but its idempotency key
  // is no longer guaranteed to exist. Prefer an operator reconciliation over a
  // duplicate message.
  return { retry: false, reason: 'retry window expired; reconciliation required' };
}

async function findDispatch(dedupeKey: string): Promise<LedgerRow | null> {
  return prisma.notificationDispatch.findUnique({
    where: { dedupeKey },
    select: {
      id: true,
      status: true,
      attempts: true,
      payload: true,
      createdAt: true,
      updatedAt: true,
    },
  }) as Promise<LedgerRow | null>;
}

/**
 * Send one logical event, at most once after a confirmed SENT outcome.
 *
 * The ledger row is created before the provider is called. Immediately before
 * the provider call it is marked as an active attempt. If the process dies after
 * that point, a retry is allowed only inside the provider idempotency window.
 */
export async function dispatch(event: EmailEvent): Promise<DispatchResult> {
  if (!event.to?.email) {
    return { status: 'SKIPPED', dedupeKey: event.dedupeKey, reason: 'recipient has no email address' };
  }

  let claimed: LedgerRow;
  try {
    claimed = (await prisma.notificationDispatch.create({
      data: {
        dedupeKey: event.dedupeKey,
        eventType: event.type,
        recipientId: event.to.id ?? null,
        recipientEmail: event.to.email,
        status: 'PENDING',
        attempts: 0,
        // If we crash before the mark-attempt update below, no provider request
        // was made and a future run may safely pick the row up again.
        payload: ledgerPayload(event, { retryable: true, providerAttempted: false }),
      },
      select: {
        id: true,
        status: true,
        attempts: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
      },
    })) as LedgerRow;
  } catch (err: any) {
    if (err?.code !== 'P2002') {
      console.error('[email] could not claim dispatch row:', err?.message ?? err);
      return { status: 'FAILED', dedupeKey: event.dedupeKey, reason: 'ledger unavailable' };
    }

    const existing = await findDispatch(event.dedupeKey).catch(() => null);
    if (!existing) {
      return { status: 'FAILED', dedupeKey: event.dedupeKey, reason: 'ledger unavailable' };
    }

    const decision = retryDecision(existing);
    if (!decision.retry) {
      return { status: 'SKIPPED', dedupeKey: event.dedupeKey, reason: decision.reason ?? 'already dispatched' };
    }
    claimed = existing;
  }

  // Mark the provider attempt before doing network I/O. This turns a crash after
  // the request leaves our process into an explicitly ambiguous PENDING row,
  // which is retryable only while provider idempotency is guaranteed.
  try {
    claimed = (await prisma.notificationDispatch.update({
      where: { id: claimed.id },
      data: {
        status: 'PENDING',
        attempts: (claimed.attempts ?? 0) + 1,
        error: null,
        payload: ledgerPayload(event, { retryable: true, providerAttempted: true }),
      },
      select: {
        id: true,
        status: true,
        attempts: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
      },
    })) as LedgerRow;
  } catch (err: any) {
    console.error('[email] could not mark provider attempt:', err?.message ?? err);
    return { status: 'FAILED', dedupeKey: event.dedupeKey, reason: 'ledger unavailable' };
  }

  let outcome: EmailSendOutcome;
  try {
    outcome = await provider.send(event);
  } catch {
    // A provider that throws instead of resolving must not escape either. The
    // error text is intentionally generic so logs/ledger do not collect PII.
    outcome = {
      status: 'FAILED',
      error: 'email provider threw before a definitive response',
      retryable: true,
      providerAttempted: true,
    };
  }

  const retryable = outcome.status !== 'SENT' && outcome.retryable === true;
  const providerAttempted =
    outcome.status === 'SENT' ? true : outcome.providerAttempted ?? outcome.status === 'FAILED';

  // A concurrent retry may have completed first. Never downgrade a confirmed
  // SENT row to FAILED/SKIPPED because another request received a later error.
  if (outcome.status !== 'SENT') {
    const current = await findDispatch(event.dedupeKey).catch(() => null);
    if (current?.status === 'SENT') {
      return { status: 'SKIPPED', dedupeKey: event.dedupeKey, reason: 'already dispatched concurrently' };
    }
  }

  try {
    await prisma.notificationDispatch.update({
      where: { id: claimed.id },
      data: {
        status: outcome.status,
        providerMessageId: outcome.status === 'SENT' ? outcome.providerMessageId : null,
        error: outcome.status === 'SENT' ? null : 'reason' in outcome ? outcome.reason : outcome.error,
        sentAt: outcome.status === 'SENT' ? new Date() : null,
        payload: ledgerPayload(event, { retryable, providerAttempted }),
      },
    });
  } catch (err: any) {
    console.error('[email] could not record dispatch outcome:', err?.message ?? err);
  }

  if (outcome.status === 'SENT') {
    return { status: 'SENT', dedupeKey: event.dedupeKey };
  }
  return {
    status: outcome.status,
    dedupeKey: event.dedupeKey,
    reason: 'reason' in outcome ? outcome.reason : outcome.error,
  };
}
