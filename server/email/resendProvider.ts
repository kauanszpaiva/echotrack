// Resend adapter — the only file in the codebase that knows Resend exists.
//
// Uses Resend's REST endpoint over `fetch` rather than the SDK: one less
// dependency in the serverless bundle, and it keeps the timeout under our
// control. Credentials are read from the environment at call time; none are
// baked into the source.

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

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  async send(event: EmailEvent): Promise<EmailSendOutcome> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    // A deployment without mail configured must degrade to a no-op, not an
    // error: email is never the reason a valid submission fails.
    if (!apiKey || !from) {
      return { status: 'SKIPPED', reason: 'RESEND_API_KEY or EMAIL_FROM is not configured' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
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
        // Read the provider's message for the ledger, but never surface it to a
        // client — it can echo the recipient address back.
        const detail = await response.text().catch(() => '');
        return { status: 'FAILED', error: `Resend responded ${response.status}: ${detail.slice(0, 300)}` };
      }

      const payload = (await response.json().catch(() => null)) as { id?: string } | null;
      return { status: 'SENT', providerMessageId: payload?.id ?? null };
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? `timed out after ${DEFAULT_TIMEOUT_MS}ms` : String(err?.message ?? err);
      return { status: 'FAILED', error: reason };
    } finally {
      clearTimeout(timeout);
    }
  }
}
