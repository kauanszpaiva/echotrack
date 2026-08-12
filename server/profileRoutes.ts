import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { authMiddleware, AuthRequest } from './auth.js';
import prisma from './prisma.js';
import {
  isAdminLevel, isCoachLevel, STUDENT_LEVEL,
  STAFF_FUNCTIONS, STAFF_FUNCTION_ROLES,
} from '../shared/roles.js';
import { generateResumePdf } from './exports.js';

const router = Router();

/* ─────────────────────────── validation helpers ─────────────────────────── */

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw httpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw httpError(400, `${field} is too long (max ${maxLength})`);
  return trimmed;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const text = optionalText(value, field, maxLength);
  if (!text) throw httpError(400, `${field} is required`);
  return text;
}

function optionalUrl(value: unknown, field: string): string | null {
  const text = optionalText(value, field, 512);
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    new URL(withScheme);
  } catch {
    throw httpError(400, `${field} must be a valid URL`);
  }
  return withScheme;
}

/**
 * Accepts "YYYY-MM" (what the month inputs submit) or a full ISO date, and
 * normalises to midnight UTC on the first of the month so ordering is stable
 * regardless of the submitter's timezone.
 */
function optionalDate(value: unknown, field: string): Date | null {
  const text = optionalText(value, field, 32);
  if (!text) return null;
  const iso = /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : text;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00.000Z` : iso);
  if (Number.isNaN(parsed.getTime())) throw httpError(400, `${field} must be a valid date`);
  return parsed;
}

function requiredDate(value: unknown, field: string): Date {
  const date = optionalDate(value, field);
  if (!date) throw httpError(400, `${field} is required`);
  return date;
}

function boolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function oneOf(value: unknown, field: string, allowed: string[]): string | null {
  const text = optionalText(value, field, 32);
  if (!text) return null;
  if (!allowed.includes(text)) throw httpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return text;
}

const EMPLOYMENT_TYPES = [
  'FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'APPRENTICESHIP',
  'CONTRACT', 'FREELANCE', 'VOLUNTEER', 'SELF_EMPLOYED',
];
const LOCATION_TYPES = ['ON_SITE', 'HYBRID', 'REMOTE'];

/** A date range is only coherent if it ends after it starts. */
function assertRange(start: Date | null, end: Date | null, isCurrent: boolean) {
  if (isCurrent && end) throw httpError(400, 'A current position cannot also have an end date');
  if (start && end && end < start) throw httpError(400, 'End date must be after the start date');
}

/* ──────────────────────────── profile plumbing ──────────────────────────── */

const PROFILE_INCLUDE: Prisma.MemberProfileInclude = {
  // Current roles first, then most recent — the order a reader expects.
  workExperiences: { orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }] },
  education: { orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }] },
  certifications: { orderBy: { issueDate: 'desc' } },
  skills: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
};

/** Every member has exactly one profile; create it on first touch. */
async function getOrCreateProfile(userId: string) {
  const existing = await prisma.memberProfile.findUnique({
    where: { userId },
    include: PROFILE_INCLUDE,
  });
  if (existing) return existing;

  await prisma.memberProfile.create({ data: { userId } });
  return prisma.memberProfile.findUniqueOrThrow({
    where: { userId },
    include: PROFILE_INCLUDE,
  });
}

/** Resolves the profile the caller owns, for any write. Writes are owner-only. */
async function ownProfileId(req: AuthRequest): Promise<string> {
  const profile = await getOrCreateProfile(req.user.id);
  return profile.id;
}

/**
 * Cohort membership lives on the student profile. Staff have no cohort of their
 * own, so they inherit the cohorts of the students they serve: program managers
 * through the communities they run and the students they oversee, coaches
 * through their assigned students, instructors through the students enrolled in
 * the classes they teach.
 */
async function communityIdsForUser(userId: string, role: string): Promise<string[]> {
  const student = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { communityId: true },
  });
  if (student?.communityId) return [student.communityId];

  const servedStudents: Prisma.StudentProfileWhereInput | null =
    role === 'PROGRAM_MANAGER' ? { programManagerId: userId }
      : isCoachLevel(role) ? { coachId: userId }
      : role === 'INSTRUCTOR'
        ? { classEnrollments: { some: { isActive: true, classModel: { instructorId: userId } } } }
        : null;

  const ids = new Set<string>();

  if (servedStudents) {
    const profiles = await prisma.studentProfile.findMany({
      where: { ...servedStudents, communityId: { not: null } },
      select: { communityId: true },
      distinct: ['communityId'],
    });
    for (const profile of profiles) {
      if (profile.communityId) ids.add(profile.communityId);
    }
  }

  if (role === 'PROGRAM_MANAGER') {
    const managed = await prisma.community.findMany({
      where: { programManagerId: userId, isActive: true },
      select: { id: true },
    });
    for (const community of managed) ids.add(community.id);
  }

  return [...ids];
}

/**
 * The rest of the cohort: the learning communities that share a cohort with the
 * ones given, excluding those themselves. A cohort runs two learning
 * communities per cycle, so this is normally the single sibling LC. Learning
 * communities not yet assigned to a cohort simply have no siblings.
 */
async function cohortSiblingCommunityIds(communityIds: string[]): Promise<string[]> {
  if (!communityIds.length) return [];

  const homes = await prisma.community.findMany({
    where: { id: { in: communityIds } },
    select: { cohortId: true },
  });
  const cohortIds = [...new Set(homes.map((c) => c.cohortId).filter(Boolean))] as string[];
  if (!cohortIds.length) return [];

  const siblings = await prisma.community.findMany({
    where: { cohortId: { in: cohortIds }, id: { notIn: communityIds }, isActive: true },
    select: { id: true },
  });
  return siblings.map((community) => community.id);
}

/**
 * The staff attached to a set of learning communities — the mirror of the rule above: the
 * program managers who run them, the coaches assigned to their students, and
 * the instructors teaching the classes those students take.
 */
async function staffIdsForCommunities(communityIds: string[]): Promise<string[]> {
  const [communities, profiles] = await Promise.all([
    prisma.community.findMany({
      where: { id: { in: communityIds } },
      select: { programManagerId: true },
    }),
    prisma.studentProfile.findMany({
      where: { communityId: { in: communityIds } },
      select: {
        coachId: true,
        programManagerId: true,
        classEnrollments: {
          where: { isActive: true },
          select: { classModel: { select: { instructorId: true } } },
        },
      },
    }),
  ]);

  const ids = new Set<string>();
  for (const community of communities) {
    if (community.programManagerId) ids.add(community.programManagerId);
  }
  for (const profile of profiles) {
    if (profile.coachId) ids.add(profile.coachId);
    if (profile.programManagerId) ids.add(profile.programManagerId);
    for (const enrollment of profile.classEnrollments) {
      if (enrollment.classModel?.instructorId) ids.add(enrollment.classModel.instructorId);
    }
  }
  return [...ids];
}

/**
 * Someone can hold more than one title at once — a PSM who also coaches, or a
 * coach who teaches a class. `role` stays the single authoritative value for
 * access control; these extra titles are display-only and derived from the work
 * the person actually does, so they never drift from the relational data.
 */
const TITLE_ORDER = [
  'PROGRAM_MANAGER', 'COACH', 'PSM', 'INSTRUCTOR',
  'CORPORATE_ENGAGEMENT_MANAGER', 'INTERNSHIP_SERVICES_SPECIALIST',
  'SITE_OPERATIONS', 'STUDENT_SERVICES', 'DEVELOPMENT_FINANCE',
  'ADMIN', 'DEV', 'STUDENT', 'INTERN',
];

function titlesForUser(user: any): string[] {
  const titles = new Set<string>();
  if (user.role) titles.add(user.role);

  const counts = user._count ?? {};
  if (counts.classesTaught > 0) titles.add('INSTRUCTOR');
  if (counts.assignedStudents > 0) titles.add('COACH');
  if (counts.managedCommunities > 0 || counts.pmStudents > 0) titles.add('PROGRAM_MANAGER');

  // Their account role always leads; the rest follow a stable order.
  return [...titles].sort((a, b) => {
    if (a === user.role) return -1;
    if (b === user.role) return 1;
    return TITLE_ORDER.indexOf(a) - TITLE_ORDER.indexOf(b);
  });
}

function serialiseMember(user: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    titles: titlesForUser(user),
    avatarUrl: user.avatarUrl,
    community: user.studentProfile?.community
      ? { id: user.studentProfile.community.id, name: user.studentProfile.community.name }
      : null,
    pathway: user.studentProfile?.pathway
      ? { id: user.studentProfile.pathway.id, name: user.studentProfile.pathway.name }
      : null,
  };
}

const MEMBER_SELECT: Prisma.UserSelect = {
  id: true, name: true, email: true, role: true, avatarUrl: true,
  studentProfile: {
    select: {
      community: { select: { id: true, name: true } },
      pathway: { select: { id: true, name: true } },
    },
  },
  // Drives the derived titles in `titlesForUser` — one query, no extra round trips.
  _count: {
    select: {
      classesTaught: true,
      assignedStudents: true,
      managedCommunities: true,
      pmStudents: true,
    },
  },
};

/** The member fields plus the profile preview each directory card renders. */
const DIRECTORY_SELECT: Prisma.UserSelect = {
  ...MEMBER_SELECT,
  memberProfile: {
    select: {
      headline: true,
      location: true,
      skills: { select: { name: true }, orderBy: { sortOrder: 'asc' }, take: 5 },
      workExperiences: {
        where: { isCurrent: true },
        select: { title: true, company: true },
        orderBy: { startDate: 'desc' },
        take: 1,
      },
    },
  },
};

function serialiseDirectoryEntry(user: any) {
  return {
    ...serialiseMember(user),
    headline: user.memberProfile?.headline ?? null,
    location: user.memberProfile?.location ?? null,
    currentRole: user.memberProfile?.workExperiences?.[0] ?? null,
    skills: (user.memberProfile?.skills ?? []).map((skill: any) => skill.name),
  };
}

/* ──────────────────────────────── routes ────────────────────────────────── */

/** The signed-in member's own profile. Always returns one (created on demand). */
router.get('/profiles/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    const member = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.id },
      select: MEMBER_SELECT,
    });
    res.json({ profile, member: serialiseMember(member), isOwner: true });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to load your profile' });
  }
});

router.patch('/profiles/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const body = req.body ?? {};
    const data: Record<string, unknown> = {};

    if ('headline' in body) data.headline = optionalText(body.headline, 'headline', 160);
    if ('about' in body) data.about = optionalText(body.about, 'about', 4000);
    if ('location' in body) data.location = optionalText(body.location, 'location', 160);
    if ('linkedinUrl' in body) data.linkedinUrl = optionalUrl(body.linkedinUrl, 'linkedinUrl');
    if ('websiteUrl' in body) data.websiteUrl = optionalUrl(body.websiteUrl, 'websiteUrl');
    if ('isPublished' in body) data.isPublished = boolean(body.isPublished);

    const id = await ownProfileId(req);
    await prisma.memberProfile.update({ where: { id }, data });
    res.json({ profile: await getOrCreateProfile(req.user.id) });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to save your profile' });
  }
});

/**
 * Cohort directory. Members browse the community they belong to; admins may
 * pass any communityId. Unpublished profiles never appear here.
 */
router.get('/profiles/directory', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const requested = optionalText(req.query.communityId, 'communityId', 64);
    const search = optionalText(req.query.q, 'q', 120);
    const admin = isAdminLevel(req.user.role);

    // Members are pinned to the learning communities they belong to; admins may
    // browse any.
    const own = admin ? [] : await communityIdsForUser(req.user.id, req.user.role);
    let homeIds: string[];
    if (admin) {
      homeIds = requested ? [requested] : [];
    } else {
      if (requested && !own.includes(requested)) {
        return res.status(403).json({ error: 'You can only browse your own learning community' });
      }
      homeIds = requested ? [requested] : own;
      if (homeIds.length === 0) {
        return res.json({
          cohort: null, communityId: null, communities: [],
          members: [], peers: [], staff: [],
        });
      }
    }

    // The rest of the cohort: the sibling learning community (there are two per
    // cycle). Staff are resolved across the whole cohort, since placement and
    // site staff serve the intake rather than a single learning community.
    const peerIds = await cohortSiblingCommunityIds(homeIds);
    const cohortIds = [...homeIds, ...peerIds];

    // Everyone listed must be an active account that has opted into the directory.
    const listable: Prisma.UserWhereInput = {
      isActive: true,
      accountStatus: 'ACTIVE',
      memberProfile: { isPublished: true },
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };

    const staffIds = cohortIds.length ? await staffIdsForCommunities(cohortIds) : [];

    const studentsIn = (communityIds: string[]) =>
      prisma.user.findMany({
        where: {
          ...listable,
          // With a learning community selected, only students carry one; without
          // one (admins browsing everything) fall back to the student roles.
          ...(communityIds.length
            ? { studentProfile: { communityId: { in: communityIds } } }
            : { role: { in: STUDENT_LEVEL } }),
        },
        select: DIRECTORY_SELECT,
        orderBy: { name: 'asc' },
        take: 200,
      });

    const [members, peers, staff] = await Promise.all([
      studentsIn(homeIds),
      peerIds.length ? studentsIn(peerIds) : Promise.resolve([]),
      prisma.user.findMany({
        where: {
          ...listable,
          ...(cohortIds.length ? { id: { in: staffIds } } : { role: { in: STAFF_FUNCTION_ROLES } }),
        },
        select: DIRECTORY_SELECT,
        orderBy: { name: 'asc' },
        take: 200,
      }),
    ]);

    // Admins get the full picker; members only ever see their own communities.
    const communities = await prisma.community.findMany({
      where: admin ? { isActive: true } : { id: { in: own } },
      select: { id: true, name: true, cohort: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    // Group staff by operating function, dropping functions nobody fills.
    const staffEntries = staff.map(serialiseDirectoryEntry);
    const staffGroups = STAFF_FUNCTIONS.map((fn) => ({
      key: fn.key,
      label: fn.label,
      description: fn.description,
      people: staffEntries.filter((person: any) => fn.roles.includes(person.role)),
    })).filter((group) => group.people.length > 0);

    const home = homeIds.length
      ? await prisma.community.findUnique({
          where: { id: homeIds[0] },
          select: { id: true, name: true, cohort: { select: { id: true, name: true } } },
        })
      : null;

    res.json({
      cohort: home?.cohort ?? null,
      communityId: home?.id ?? null,
      communityName: home?.name ?? null,
      communities,
      members: members.map(serialiseDirectoryEntry),
      peers: peers.map(serialiseDirectoryEntry),
      staff: staffGroups,
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to load the directory' });
  }
});

/** Read another member's profile. Unpublished profiles are owner/admin only. */
router.get('/profiles/:userId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const isOwner = userId === req.user.id;

    if (isOwner) {
      const profile = await getOrCreateProfile(userId);
      const member = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: MEMBER_SELECT });
      return res.json({ profile, member: serialiseMember(member), isOwner: true });
    }

    const member = await prisma.user.findUnique({ where: { id: userId }, select: MEMBER_SELECT });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const profile = await prisma.memberProfile.findUnique({
      where: { userId },
      include: PROFILE_INCLUDE,
    });
    if (!profile || (!profile.isPublished && !isAdminLevel(req.user.role))) {
      return res.status(404).json({ error: 'This member has not published a profile yet' });
    }

    res.json({ profile, member: serialiseMember(member), isOwner: false });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to load this profile' });
  }
});

/* ── work experience ── */

function workExperienceData(body: any) {
  const isCurrent = boolean(body.isCurrent);
  const startDate = requiredDate(body.startDate, 'startDate');
  const endDate = isCurrent ? null : optionalDate(body.endDate, 'endDate');
  assertRange(startDate, endDate, isCurrent);

  return {
    title: requiredText(body.title, 'title', 160),
    company: requiredText(body.company, 'company', 160),
    employmentType: oneOf(body.employmentType, 'employmentType', EMPLOYMENT_TYPES),
    location: optionalText(body.location, 'location', 160),
    locationType: oneOf(body.locationType, 'locationType', LOCATION_TYPES),
    startDate,
    endDate,
    isCurrent,
    description: optionalText(body.description, 'description', 4000),
  };
}

router.post('/profiles/me/experience', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profileId = await ownProfileId(req);
    const entry = await prisma.workExperience.create({
      data: { profileId, ...workExperienceData(req.body ?? {}) },
    });
    res.json({ entry });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to add this position' });
  }
});

router.patch('/profiles/me/experience/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profileId = await ownProfileId(req);
    const { count } = await prisma.workExperience.updateMany({
      where: { id: req.params.id, profileId },
      data: workExperienceData(req.body ?? {}),
    });
    if (!count) return res.status(404).json({ error: 'Position not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update this position' });
  }
});

router.delete('/profiles/me/experience/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profileId = await ownProfileId(req);
    const { count } = await prisma.workExperience.deleteMany({ where: { id: req.params.id, profileId } });
    if (!count) return res.status(404).json({ error: 'Position not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to remove this position' });
  }
});

/* ── education ── */

function educationData(body: any) {
  const isCurrent = boolean(body.isCurrent);
  const startDate = optionalDate(body.startDate, 'startDate');
  const endDate = isCurrent ? null : optionalDate(body.endDate, 'endDate');
  assertRange(startDate, endDate, isCurrent);

  return {
    school: requiredText(body.school, 'school', 160),
    degree: optionalText(body.degree, 'degree', 160),
    fieldOfStudy: optionalText(body.fieldOfStudy, 'fieldOfStudy', 160),
    startDate,
    endDate,
    isCurrent,
    description: optionalText(body.description, 'description', 4000),
  };
}

router.post('/profiles/me/education', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profileId = await ownProfileId(req);
    const entry = await prisma.educationEntry.create({
      data: { profileId, ...educationData(req.body ?? {}) },
    });
    res.json({ entry });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to add this education entry' });
  }
});

router.patch('/profiles/me/education/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profileId = await ownProfileId(req);
    const { count } = await prisma.educationEntry.updateMany({
      where: { id: req.params.id, profileId },
      data: educationData(req.body ?? {}),
    });
    if (!count) return res.status(404).json({ error: 'Education entry not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update this education entry' });
  }
});

router.delete('/profiles/me/education/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profileId = await ownProfileId(req);
    const { count } = await prisma.educationEntry.deleteMany({ where: { id: req.params.id, profileId } });
    if (!count) return res.status(404).json({ error: 'Education entry not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to remove this education entry' });
  }
});

/* ── certifications ── */

function certificationData(body: any) {
  const issueDate = optionalDate(body.issueDate, 'issueDate');
  const expiryDate = optionalDate(body.expiryDate, 'expiryDate');
  if (issueDate && expiryDate && expiryDate < issueDate) {
    throw httpError(400, 'Expiry date must be after the issue date');
  }

  return {
    name: requiredText(body.name, 'name', 200),
    issuer: optionalText(body.issuer, 'issuer', 160),
    issueDate,
    expiryDate,
    credentialId: optionalText(body.credentialId, 'credentialId', 160),
    credentialUrl: optionalUrl(body.credentialUrl, 'credentialUrl'),
  };
}

router.post('/profiles/me/certifications', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profileId = await ownProfileId(req);
    const entry = await prisma.certification.create({
      data: { profileId, ...certificationData(req.body ?? {}) },
    });
    res.json({ entry });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to add this certification' });
  }
});

router.patch('/profiles/me/certifications/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profileId = await ownProfileId(req);
    const { count } = await prisma.certification.updateMany({
      where: { id: req.params.id, profileId },
      data: certificationData(req.body ?? {}),
    });
    if (!count) return res.status(404).json({ error: 'Certification not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update this certification' });
  }
});

router.delete('/profiles/me/certifications/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profileId = await ownProfileId(req);
    const { count } = await prisma.certification.deleteMany({ where: { id: req.params.id, profileId } });
    if (!count) return res.status(404).json({ error: 'Certification not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to remove this certification' });
  }
});

/* ── skills (replace-the-whole-list, matching the tag editor UI) ── */

router.put('/profiles/me/skills', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const raw = req.body?.skills;
    if (!Array.isArray(raw)) throw httpError(400, 'skills must be an array');
    if (raw.length > 50) throw httpError(400, 'A profile can list at most 50 skills');

    // De-duplicate case-insensitively while keeping the order the member chose.
    const seen = new Set<string>();
    const skills: string[] = [];
    for (const value of raw) {
      const name = requiredText(value, 'skill', 60);
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(name);
    }

    const profileId = await ownProfileId(req);
    await prisma.$transaction([
      prisma.profileSkill.deleteMany({ where: { profileId } }),
      prisma.profileSkill.createMany({
        data: skills.map((name, index) => ({ profileId, name, sortOrder: index })),
      }),
    ]);

    res.json({ skills });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to save your skills' });
  }
});

/* ── resume export ── */

router.get('/profiles/:userId/resume-pdf', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const isOwner = userId === req.user.id;

    const member = await prisma.user.findUnique({ where: { id: userId }, select: MEMBER_SELECT });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const profile = await prisma.memberProfile.findUnique({
      where: { userId },
      include: PROFILE_INCLUDE,
    });
    if (!profile || (!profile.isPublished && !isOwner && !isAdminLevel(req.user.role))) {
      return res.status(404).json({ error: 'This member has not published a profile yet' });
    }

    const stream = await generateResumePdf({ profile, member: serialiseMember(member) });
    const filename = `${member.name.replace(/[^a-z0-9]+/gi, '_')}_Resume.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  } catch (e: any) {
    console.error('[resume-pdf]', e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to generate the resume' });
  }
});

export default router;
