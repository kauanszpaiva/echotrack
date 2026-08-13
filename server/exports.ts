import { createElement } from 'react';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { renderToStream } from '@react-pdf/renderer';
import { Document as PdfDocument, Page as PdfPage, Text as PdfText, View as PdfView, StyleSheet } from '@react-pdf/renderer';

// This module is deliberately JSX-free and lives in a `.ts` file, not `.tsx`.
// Vercel's Node builder compiles the `.ts` files it traces into the serverless
// bundle but skips `.tsx`, so as `exports.tsx` this file never reached the
// lambda: `import './exports.js'` in routes.ts then threw ERR_MODULE_NOT_FOUND
// at module load, killing the whole function. Every /api/* route — health check
// included — answered with Vercel's plain-text FUNCTION_INVOCATION_FAILED page
// rather than JSON. Keep the PDF tree built with createElement.

export async function generateDocx(report: any): Promise<Buffer> {
    const doc = new Document({
        sections: [
            {
                properties: {},
                children: [
                    new Paragraph({
                        text: "Weekly Status Report",
                        heading: HeadingLevel.HEADING_1,
                    }),
                    new Paragraph({
                        text: `EchoTrack / KSP Dominion Group · ${report.cycle?.name || 'Cycle'} · ${new Date(report.submittedAt || new Date()).toLocaleDateString()}`,
                    }),
                    new Paragraph({ text: "" }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: "Good afternoon, ", bold: true }),
                            new TextRun(report.student?.coach?.name || 'Coach'),
                            new TextRun(",\n\nI hope you're having a wonderful day. I am eager to chat with you about "),
                            new TextRun({ text: report.weeklyTopic || 'my week', bold: true }),
                            new TextRun("."),
                        ],
                    }),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "Highlights:", heading: HeadingLevel.HEADING_2 }),
                    ...(report.highlights ? report.highlights.split('\n').map((h: string) => new Paragraph({ text: `• ${h}` })) : []),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "Academic Progress:", heading: HeadingLevel.HEADING_2 }),
                    new Paragraph({ text: report.academicProgress || '' }),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "Class Experience:", heading: HeadingLevel.HEADING_2 }),
                    new Paragraph({ text: report.classExperience || '' }),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "Challenges:", heading: HeadingLevel.HEADING_2 }),
                    new Paragraph({ text: `Tags: ${report.challengesTags}` }),
                    new Paragraph({ text: report.challengesText || '' }),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "Support Needed:", heading: HeadingLevel.HEADING_2 }),
                    new Paragraph({ text: report.supportNeeded || 'None' }),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "In Closing:", heading: HeadingLevel.HEADING_2 }),
                    new Paragraph({ text: report.reflection || '' }),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "Goals for Next Week:", heading: HeadingLevel.HEADING_2 }),
                    new Paragraph({ text: report.goals || '' }),
                    new Paragraph({ text: "" }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: `Name: ${report.student?.name}`, break: 1 }),
                            new TextRun({ text: `Email: ${report.student?.email}`, break: 1 }),
                        ]
                    })
                ],
            },
        ],
    });

    return await Packer.toBuffer(doc);
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica' },
  heading: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  subheading: { fontSize: 14, marginBottom: 20, color: '#6B7280' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 20, marginBottom: 10 },
  text: { fontSize: 12, marginBottom: 5 },
  bold: { fontWeight: 'bold' }
});

export const ReportPdf = ({ report }: { report: any }) =>
  createElement(
    PdfDocument,
    null,
    createElement(
      PdfPage,
      { size: 'A4', style: styles.page },
      createElement(PdfText, { style: styles.heading }, 'Weekly Status Report'),
      createElement(PdfText, { style: styles.subheading }, 'EchoTrack / KSP Dominion Group'),

      createElement(PdfText, { style: styles.text }, 'Good afternoon,'),
      createElement(PdfText, { style: styles.text }, `I am eager to chat with you about ${report.weeklyTopic}.`),

      createElement(PdfText, { style: styles.sectionTitle }, 'Highlights'),
      createElement(PdfText, { style: styles.text }, report.highlights),

      createElement(PdfText, { style: styles.sectionTitle }, 'Class Experience'),
      createElement(PdfText, { style: styles.text }, report.classExperience),

      createElement(PdfText, { style: styles.sectionTitle }, 'In Closing'),
      createElement(PdfText, { style: styles.text }, report.reflection),

      createElement(PdfText, { style: styles.text }, `\nName: ${report.student?.name}`),
      createElement(PdfText, { style: styles.text }, `Email: ${report.student?.email}`)
    )
  );

export async function generatePdf(report: any) {
  return await renderToStream(createElement(ReportPdf, { report }));
}

/* ───────────────────────── member resume export ───────────────────────── */

const BRAND = '#FF7A00';

const resumeStyles = StyleSheet.create({
  page: { paddingVertical: 42, paddingHorizontal: 48, fontFamily: 'Helvetica', color: '#0A0A0A' },
  name: { fontSize: 24, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  headline: { fontSize: 12, color: '#374151', marginBottom: 8 },
  contact: { fontSize: 9, color: '#6B7280', marginBottom: 2 },
  rule: { borderBottomWidth: 2, borderBottomColor: BRAND, marginTop: 14, marginBottom: 16 },
  sectionTitle: {
    fontSize: 10, fontFamily: 'Helvetica-Bold', color: BRAND,
    letterSpacing: 1.4, marginTop: 18, marginBottom: 8,
  },
  entry: { marginBottom: 12 },
  entryTitle: { fontSize: 11.5, fontFamily: 'Helvetica-Bold' },
  entryMeta: { fontSize: 9.5, color: '#4B5563', marginTop: 2 },
  entryDates: { fontSize: 9, color: '#9CA3AF', marginTop: 2 },
  body: { fontSize: 10, color: '#374151', lineHeight: 1.5, marginTop: 4 },
  skills: { fontSize: 10, color: '#374151', lineHeight: 1.6 },
  footer: {
    position: 'absolute', bottom: 24, left: 48, right: 48,
    fontSize: 8, color: '#9CA3AF', textAlign: 'center',
  },
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthYear(value: any): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function dateRange(start: any, end: any, isCurrent: boolean): string {
  const from = monthYear(start);
  const to = isCurrent ? 'Present' : monthYear(end);
  if (!from && !to) return '';
  if (!from) return to;
  return to ? `${from} — ${to}` : from;
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: 'Full-time', PART_TIME: 'Part-time', INTERNSHIP: 'Internship',
  APPRENTICESHIP: 'Apprenticeship', CONTRACT: 'Contract', FREELANCE: 'Freelance',
  VOLUNTEER: 'Volunteer', SELF_EMPLOYED: 'Self-employed',
};
const LOCATION_LABELS: Record<string, string> = {
  ON_SITE: 'On-site', HYBRID: 'Hybrid', REMOTE: 'Remote',
};

/** Joins the parts of a metadata line, skipping anything the member left blank. */
const joinParts = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

/**
 * Built with createElement rather than JSX for the reason at the top of this
 * file: as a `.tsx` file this module never reaches the Vercel lambda.
 */
const section = (title: string, ...children: any[]) =>
  createElement(
    PdfView,
    { key: title },
    createElement(PdfText, { style: resumeStyles.sectionTitle }, title),
    ...children,
  );

const entryBlock = (key: string, title: string, meta: string, dates: string, description?: string | null) =>
  createElement(
    PdfView,
    { key, style: resumeStyles.entry, wrap: false },
    createElement(PdfText, { style: resumeStyles.entryTitle }, title),
    meta ? createElement(PdfText, { style: resumeStyles.entryMeta }, meta) : null,
    dates ? createElement(PdfText, { style: resumeStyles.entryDates }, dates) : null,
    description ? createElement(PdfText, { style: resumeStyles.body }, description) : null,
  );

export const ResumePdf = ({ profile, member }: { profile: any; member: any }) => {
  const experiences = profile.workExperiences ?? [];
  const education = profile.education ?? [];
  const certifications = profile.certifications ?? [];
  const skills = (profile.skills ?? []).map((skill: any) => skill.name);

  const contactLines = [
    joinParts(member.email, profile.location),
    joinParts(profile.linkedinUrl, profile.websiteUrl),
    joinParts(member.community?.name, member.pathway?.name),
  ].filter(Boolean);

  return createElement(
    PdfDocument,
    { title: `${member.name} — Resume`, author: 'EchoTrack · KSP Dominion Group' },
    createElement(
      PdfPage,
      { size: 'A4', style: resumeStyles.page },
      createElement(PdfText, { style: resumeStyles.name }, member.name),
      profile.headline ? createElement(PdfText, { style: resumeStyles.headline }, profile.headline) : null,
      ...contactLines.map((line, index) =>
        createElement(PdfText, { key: `contact-${index}`, style: resumeStyles.contact }, line),
      ),
      createElement(PdfView, { style: resumeStyles.rule }),

      profile.about
        ? section('ABOUT', createElement(PdfText, { style: resumeStyles.body }, profile.about))
        : null,

      experiences.length
        ? section(
            'EXPERIENCE',
            ...experiences.map((entry: any) =>
              entryBlock(
                entry.id,
                entry.title,
                joinParts(
                  entry.company,
                  EMPLOYMENT_LABELS[entry.employmentType] ?? entry.employmentType,
                  entry.location,
                  LOCATION_LABELS[entry.locationType] ?? entry.locationType,
                ),
                dateRange(entry.startDate, entry.endDate, entry.isCurrent),
                entry.description,
              ),
            ),
          )
        : null,

      education.length
        ? section(
            'EDUCATION',
            ...education.map((entry: any) =>
              entryBlock(
                entry.id,
                entry.school,
                joinParts(entry.degree, entry.fieldOfStudy),
                dateRange(entry.startDate, entry.endDate, entry.isCurrent),
                entry.description,
              ),
            ),
          )
        : null,

      certifications.length
        ? section(
            'LICENSES & CERTIFICATIONS',
            ...certifications.map((entry: any) =>
              entryBlock(
                entry.id,
                entry.name,
                joinParts(entry.issuer, entry.credentialId ? `Credential ID ${entry.credentialId}` : null),
                joinParts(
                  entry.issueDate ? `Issued ${monthYear(entry.issueDate)}` : null,
                  entry.expiryDate ? `Expires ${monthYear(entry.expiryDate)}` : null,
                ),
              ),
            ),
          )
        : null,

      skills.length
        ? section('SKILLS', createElement(PdfText, { style: resumeStyles.skills }, skills.join(' · ')))
        : null,

      createElement(PdfText, {
        style: resumeStyles.footer,
        fixed: true,
        render: ({ pageNumber, totalPages }: any) =>
          `EchoTrack · KSP Dominion Group — page ${pageNumber} of ${totalPages}`,
      }),
    ),
  );
};

export async function generateResumePdf({ profile, member }: { profile: any; member: any }) {
  return await renderToStream(ResumePdf({ profile, member }));
}
