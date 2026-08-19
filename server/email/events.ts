// Event builders — the API business logic actually calls.
//
// Each builder owns its subject, copy and dedupe key so callers never hand-roll
// a key (the one mistake that would silently break at-most-once delivery).

import type { EmailEvent, EmailRecipient } from './types.js';
import { appUrl } from './dispatcher.js';

const PRODUCT = 'EchoTrack';

/** Weekly report is open and not yet submitted. Deduped per student per cycle. */
export function reportReminder(to: EmailRecipient, cycle: { id: string; name: string; endDate: Date }): EmailEvent {
  const due = cycle.endDate.toISOString().slice(0, 10);
  return {
    type: 'REPORT_REMINDER',
    to,
    dedupeKey: `REPORT_REMINDER:${to.id ?? to.email}:${cycle.id}`,
    subject: `${PRODUCT} — your weekly report for ${cycle.name} is due`,
    body:
      `Hi ${to.name ?? 'there'},\n\n` +
      `Your weekly report for ${cycle.name} has not been submitted yet. ` +
      `The cycle closes on ${due}.\n\n` +
      `It takes a few minutes, and it is what your coach reads before your next check-in.`,
    actionUrl: appUrl('/student/report'),
    actionLabel: 'Complete my report',
  };
}

/** A coach or program manager reviewed a submitted report. */
export function reportReviewed(to: EmailRecipient, report: { id: string; cycleName: string }): EmailEvent {
  return {
    type: 'REPORT_REVIEWED',
    to,
    dedupeKey: `REPORT_REVIEWED:${report.id}`,
    subject: `${PRODUCT} — your ${report.cycleName} report has been reviewed`,
    body:
      `Hi ${to.name ?? 'there'},\n\n` +
      `Your weekly report for ${report.cycleName} has been reviewed by your coach.`,
    actionUrl: appUrl(`/student/reports/${report.id}`),
    actionLabel: 'Read the review',
  };
}

/** New written feedback on a report. Keyed on the feedback row, not the report. */
export function coachFeedback(to: EmailRecipient, feedback: { id: string; reportId: string; coachName: string }): EmailEvent {
  return {
    type: 'COACH_FEEDBACK',
    to,
    dedupeKey: `COACH_FEEDBACK:${feedback.id}`,
    subject: `${PRODUCT} — ${feedback.coachName} left you feedback`,
    body: `Hi ${to.name ?? 'there'},\n\n${feedback.coachName} left feedback on your weekly report.`,
    actionUrl: appUrl(`/student/reports/${feedback.reportId}`),
    actionLabel: 'Read the feedback',
  };
}

/** A staff member asked this student a targeted question. */
export function targetedQuestion(to: EmailRecipient, question: { id: string }): EmailEvent {
  return {
    type: 'TARGETED_QUESTION',
    to,
    dedupeKey: `TARGETED_QUESTION:${question.id}`,
    subject: `${PRODUCT} — a new question for your next report`,
    body:
      `Hi ${to.name ?? 'there'},\n\n` +
      `Your coaching team added a question to your next weekly report. ` +
      `You will see it when you fill the report in.`,
    actionUrl: appUrl('/student/report'),
    actionLabel: 'Open my report',
  };
}

/** A student flagged that they need support — routed to their coach. */
export function needsAttention(
  to: EmailRecipient,
  context: { reportId: string; studentName: string },
): EmailEvent {
  return {
    type: 'NEEDS_ATTENTION',
    to,
    dedupeKey: `NEEDS_ATTENTION:${context.reportId}`,
    subject: `${PRODUCT} — ${context.studentName} asked for support`,
    body:
      `Hi ${to.name ?? 'there'},\n\n` +
      `${context.studentName} flagged that they need support in their latest weekly report.`,
    actionUrl: appUrl(`/coach/reports/${context.reportId}`),
    actionLabel: 'Open the report',
  };
}

/** Classroom / assignment event. `eventKey` distinguishes repeat events. */
export function classroomEvent(
  to: EmailRecipient,
  context: { eventKey: string; classId: string; className: string; summary: string },
): EmailEvent {
  return {
    type: 'CLASSROOM_EVENT',
    to,
    dedupeKey: `CLASSROOM_EVENT:${context.eventKey}`,
    subject: `${PRODUCT} — ${context.className}`,
    body: `Hi ${to.name ?? 'there'},\n\n${context.summary}`,
    actionUrl: appUrl(`/student/classes/${context.classId}`),
    actionLabel: 'Open the class',
  };
}

/** Internship / matching event. */
export function internshipEvent(
  to: EmailRecipient,
  context: { eventKey: string; summary: string },
): EmailEvent {
  return {
    type: 'INTERNSHIP_EVENT',
    to,
    dedupeKey: `INTERNSHIP_EVENT:${context.eventKey}`,
    subject: `${PRODUCT} — an update on your placement`,
    body: `Hi ${to.name ?? 'there'},\n\n${context.summary}`,
    actionUrl: appUrl('/student/career'),
    actionLabel: 'Open my placement',
  };
}
