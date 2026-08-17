// Email dispatch — deduplication, persistence and failure isolation.
//
// Two guarantees this layer exists to provide:
//
//   1. **At-most-once.** `notification_dispatches.dedupe_key` is UNIQUE. A
//      concurrent second dispatch loses the insert race (P2002) and returns
//      `SKIPPED` instead of sending a duplicate. This is what makes the cron
//      endpoint safe to retry.
//
//   2. **Never break the caller.** A submitted weekly report is valid whether or
//      not its notification goes out. `dispatch` therefore resolves rather than
//      throws — every failure is recorded on the ledger row and swallowed.

import prisma from '../prisma.js';
import type { EmailEvent, EmailProvider, EmailSendOutcome } from './types.js';
import { ResendEmailProvider } from './resendProvider.js';

let provider: EmailProvider = new ResendEmailProvider();

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

/**
 * Send one event, at most once.
 *
 * The ledger row is claimed *before* the provider is called, so a crash between
 * claim and send leaves a PENDING row — visible and retryable — rather than an
 * invisible double-send.
 */
export async function dispatch(event: EmailEvent): Promise<DispatchResult> {
  if (!event.to?.email) {
    return { status: 'SKIPPED', dedupeKey: event.dedupeKey, reason: 'recipient has no email address' };
  }

  let claimed: { id: string };
  try {
    claimed = await prisma.notificationDispatch.create({
      data: {
        dedupeKey: event.dedupeKey,
        eventType: event.type,
        recipientId: event.to.id ?? null,
        recipientEmail: event.to.email,
        status: 'PENDING',
        attempts: 1,
        payload: JSON.stringify({ subject: event.subject, actionUrl: event.actionUrl ?? null }),
      },
      select: { id: true },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Already dispatched (or in flight) for this key — the whole point.
      return { status: 'SKIPPED', dedupeKey: event.dedupeKey, reason: 'already dispatched' };
    }
    console.error('[email] could not claim dispatch row:', err?.message ?? err);
    return { status: 'FAILED', dedupeKey: event.dedupeKey, reason: 'ledger unavailable' };
  }

  let outcome: EmailSendOutcome;
  try {
    outcome = await provider.send(event);
  } catch (err: any) {
    // A provider that throws instead of resolving must not escape either.
    outcome = { status: 'FAILED', error: String(err?.message ?? err) };
  }

  try {
    await prisma.notificationDispatch.update({
      where: { id: claimed.id },
      data: {
        status: outcome.status,
        providerMessageId: outcome.status === 'SENT' ? outcome.providerMessageId : null,
        error: outcome.status === 'SENT' ? null : 'reason' in outcome ? outcome.reason : outcome.error,
        sentAt: outcome.status === 'SENT' ? new Date() : null,
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
