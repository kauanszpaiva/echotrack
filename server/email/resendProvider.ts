// Resend adapter — the only file in the codebase that knows Resend exists.
//
// Uses Resend's REST endpoint over `fetch` rather than the SDK: one less
// dependency in the serverless bundle, and it keeps timeout + retry semantics
// explicit. Credentials are read from the environment at call time; none are
// baked into the source.

import { createHash } from 'crypto';
import type { EmailEvent, EmailProvider, EmailSendOutcome } from './types.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_TIMEOUT_MS = 10_000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal, client-safe HTML. No remote assets, no tracking pixels. */
export function renderHtml(event: EmailEvent): string {
  const paragraphs = event.body
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const action =
    event.actionUrl && event.actionLabel
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(event.actionUrl)}" ` +
        `style="background:#FF7A00;color:#fff;padding:12px 20px;border-radius:6px;` +
        `text-decoration:none;display:inline-block">${escapeHtml(event.actionLabel)}</a></p>`
      : '';

  return (
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;` +
    `font-size:15px;color:#1f2937;max-width:560px">${paragraphs}${action}</div>`
  );
}

/**
 * Provider-level key derived from the application's stable logical-delivery key.
 * Hashing keeps it deterministic while staying comfortably below Resend's
 * 256-character maximum even if a future event key contains long identifiers.
 */
export function resendIdempotencyKey(event: EmailEvent): string {
  const digest = createHash('sha256').update(event.dedupeKey).digest('hex');
  return `echotrack/${digest}`;
}

function resendErrorCode(detail: string): string | null {
  try {
    const parsed = JSON.parse(detail) as any;
    return (
      (typeof parsed?.name === 'string' && parsed.name) ||
      (typeof parsed?.code === 'string' && parsed.code) ||
      (typeof parsed?.error?.name === 'string' && parsed.error.name) ||
      null
    );
  } catch {
    return null;
  }
}

function retryableResponse(status: number, code: string | null): boolean {
  if (status === 429 || status >= 500) return true;
  // Resend explicitly documents this 409 as safe to retry later with the same
  // idempotency key. `invalid_idempotent_request` is deliberately NOT retryable.
  return status === 409 && code === 'concurrent_idempotent_requests';
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  async send(event: EmailEvent): Promise<EmailSendOutcome> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    // A deployment without mail configured must degrade to a no-op, not an
    // error: email is never the reason a valid submission fails. Because no
    // provider request occurred, this row is safe to retry later after config.
    if (!apiKey || !from) {
      return {
        status: 'SKIPPED',
        reason: 'mail provider is not configured',
        retryable: true,
        providerAttempted: false,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': resendIdempotencyKey(event),
        },
        body: JSON.stringify({
          from,
          to: [event.to.email],
          subject: event.subject,
          text: event.body,
          html: renderHtml(event),
          ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Parse only the provider's machine error code. Do not persist the raw
        // response body because provider errors may echo recipient PII.
        const detail = await response.text().catch(() => '');
        const code = resendErrorCode(detail);
        return {
          status: 'FAILED',
          error: code ? `Resend responded ${response.status} (${code})` : `Resend responded ${response.status}`,
          retryable: retryableResponse(response.status, code),
          providerAttempted: true,
        };
      }

      const payload = (await response.json().catch(() => null)) as { id?: string } | null;
      return { status: 'SENT', providerMessageId: payload?.id ?? null };
    } catch (err: any) {
      const reason =
        err?.name === 'AbortError'
          ? `Resend request timed out after ${DEFAULT_TIMEOUT_MS}ms`
          : 'Resend request failed before a definitive response';
      return {
        status: 'FAILED',
        error: reason,
        retryable: true,
        providerAttempted: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
