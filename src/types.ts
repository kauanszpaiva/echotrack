export type { UserRole } from '../shared/roles';
import type { UserRole } from '../shared/roles';
export type AccountStatus = 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
export type ReportStatus = 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'REVIEWED';
export type CycleStatus = 'OPEN' | 'CLOSED';
export type PerformanceLevel = 'EXCEEDING' | 'MEETING' | 'APPROACHING' | 'BEGINNING';
export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlertType =
  | 'LOW_ENERGY' | 'LOW_MOOD' | 'LOW_CONFIDENCE' | 'LOW_ATTENDANCE'
  | 'MISSED_REPORT' | 'CHALLENGE_FLAGGED' | 'SUPPORT_NEEDED'
  | 'LOW_PERFORMANCE' | 'GENERAL';

export const PERFORMANCE_LEVELS: { value: PerformanceLevel; label: string; color: string; bg: string }[] = [
  { value: 'EXCEEDING',   label: 'Exceeding',   color: '#16A34A', bg: '#F0FDF4' },
  { value: 'MEETING',     label: 'Meeting',     color: '#2563EB', bg: '#EFF6FF' },
  { value: 'APPROACHING', label: 'Approaching', color: '#EA580C', bg: '#FFF7ED' },
  { value: 'BEGINNING',   label: 'Beginning',   color: '#DC2626', bg: '#FEF2F2' },
];

export const ROLE_BADGE: Record<UserRole, { bg: string; text: string; border: string; label: string }> = {
  DEV:             { bg: 'bg-gray-900/5', text: 'text-gray-900',    border: 'border-gray-300',    label: 'Dev' },
  ADMIN:           { bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-200',     label: 'Admin' },
  PROGRAM_MANAGER: { bg: 'bg-purple-50',  text: 'text-purple-600',  border: 'border-purple-200',  label: 'Program Manager' },
  INSTRUCTOR:      { bg: 'bg-orange-50',  text: 'text-orange-600',  border: 'border-orange-200',  label: 'Instructor' },
  COACH:           { bg: 'bg-blue-50',    text: 'text-blue-600',    border: 'border-blue-200',    label: 'Coach' },
  PSM:             { bg: 'bg-sky-50',     text: 'text-sky-600',     border: 'border-sky-200',     label: 'PSM' },
  STUDENT:         { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', label: 'Student' },
  INTERN:          { bg: 'bg-teal-50',    text: 'text-teal-600',    border: 'border-teal-200',    label: 'Intern' },
};

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export type ConductEntryType = 'INFRACTION' | 'CONVERSATION';
export type ConductEntryStatus = 'PENDING' | 'APPROVED' | 'CLEARED';

export interface ConductEntry {
  id: string;
  type: ConductEntryType;
  points: number;
  summary: string;
  followUp: string;
  status: ConductEntryStatus;
  createdAt: string;
  student: { id: string; name: string; email: string };
  author: { id: string; name: string; role: UserRole };
  reviewer?: { id: string; name: string } | null;
}

/* ─────────────────────────── member profiles ─────────────────────────── */

export type EmploymentType =
  | 'FULL_TIME' | 'PART_TIME' | 'INTERNSHIP' | 'APPRENTICESHIP'
  | 'CONTRACT' | 'FREELANCE' | 'VOLUNTEER' | 'SELF_EMPLOYED';

export type LocationType = 'ON_SITE' | 'HYBRID' | 'REMOTE';

export const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: 'FULL_TIME',      label: 'Full-time' },
  { value: 'PART_TIME',      label: 'Part-time' },
  { value: 'INTERNSHIP',     label: 'Internship' },
  { value: 'APPRENTICESHIP', label: 'Apprenticeship' },
  { value: 'CONTRACT',       label: 'Contract' },
  { value: 'FREELANCE',      label: 'Freelance' },
  { value: 'VOLUNTEER',      label: 'Volunteer' },
  { value: 'SELF_EMPLOYED',  label: 'Self-employed' },
];

export const LOCATION_TYPE_OPTIONS: { value: LocationType; label: string }[] = [
  { value: 'ON_SITE', label: 'On-site' },
  { value: 'HYBRID',  label: 'Hybrid' },
  { value: 'REMOTE',  label: 'Remote' },
];

export interface WorkExperience {
  id: string;
  title: string;
  company: string;
  employmentType: EmploymentType | null;
  location: string | null;
  locationType: LocationType | null;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
}

export interface Certification {
  id: string;
  name: string;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  credentialId: string | null;
  credentialUrl: string | null;
}

export interface MemberProfile {
  id: string;
  userId: string;
  headline: string | null;
  about: string | null;
  location: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  isPublished: boolean;
  workExperiences: WorkExperience[];
  education: EducationEntry[];
  certifications: Certification[];
  skills: { id: string; name: string }[];
}

/** The account a profile belongs to, plus its cohort context. */
export interface ProfileMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
  community: { id: string; name: string } | null;
  pathway: { id: string; name: string } | null;
}

export interface DirectoryMember extends ProfileMember {
  headline: string | null;
  location: string | null;
  currentRole: { title: string; company: string } | null;
  skills: string[];
}
