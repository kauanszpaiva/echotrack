// Schemas de validação para as rotas da API
// Usa Zod (já em dependências) para substituir validação manual

import { z } from 'zod';

// ── Schemas base ────────────────────────────────────────────────────────────

export const signupSchema = z.object({
  name: z.string().min(1).max(128),
  email: z.string().email().max(256),
  password: z.string().min(8).max(128),
  programManagerId: z.string().min(1).max(128),
  coachId: z.string().min(1).max(128),
  pathwayId: z.string().min(1).max(128),
  classIds: z.array(z.string().min(1).max(128)).min(1).max(20),
});

export const setupAccountSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(8).max(128),
});

export const registerStaffSchema = z.object({
  name: z.string().min(1).max(128),
  email: z.string().email().max(256),
  password: z.string().min(8).max(128),
  role: z.enum(['PROGRAM_MANAGER', 'COACH', 'PSM', 'INSTRUCTOR', 'INTERN']),
});

export const inviteSchema = z.object({
  name: z.string().min(1).max(128),
  email: z.string().email().max(256),
});

// ── Weekly Report ──────────────────────────────────────────────────────────

export const classRatingSchema = z.object({
  classId: z.string().min(1).max(128),
  rating: z.enum(['EXCEEDING', 'MEETING', 'APPROACHING', 'BEGINNING']),
  comment: z.string().max(1000).optional().nullable(),
});

export const targetedAnswerSchema = z.object({
  questionId: z.string().min(1).max(128),
  answer: z.string().min(1).max(4000),
});

export const weeklyReportSchema = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED']),
  energy: z.number().int().min(1).max(10).optional().nullable(),
  mood: z.number().int().min(1).max(10).optional().nullable(),
  attendance: z.number().int().min(0).max(100).optional().nullable(),
  confidence: z.number().int().min(1).max(10).optional().nullable(),
  weeklyTopic: z.string().max(256).optional().nullable(),
  highlights: z.string().max(5000).optional().nullable(),
  academicProgress: z.string().max(5000).optional().nullable(),
  classExperience: z.string().max(5000).optional().nullable(),
  instructorSupport: z.string().max(2000).optional().nullable(),
  events: z.string().max(2000).optional().nullable(),
  upcomingEvents: z.string().max(2000).optional().nullable(),
  challengesTags: z.union([
    z.array(z.string().max(64)).max(10),
    z.string(),
  ]).optional(),
  challengesText: z.string().max(5000).optional().nullable(),
  needsSupport: z.boolean().optional().default(false),
  supportNeeded: z.string().max(2000).optional().nullable(),
  reflection: z.string().max(5000).optional().nullable(),
  goals: z.string().max(2000).optional().nullable(),
  classRatings: z.array(classRatingSchema).optional(),
  targetedAnswers: z.array(targetedAnswerSchema).optional(),
});

// ── Admin schemas ──────────────────────────────────────────────────────────

export const pathwaySchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional().nullable(),
});

export const classSchema = z.object({
  name: z.string().min(1).max(256),
  pathwayId: z.string().min(1).max(128),
  instructorId: z.string().min(1).max(128).optional().nullable(),
  schedule: z.string().max(500).optional().nullable(),
});

export const communitySchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional().nullable(),
  programManagerId: z.string().min(1).max(128).optional().nullable(),
});

export const cycleSchema = z.object({
  name: z.string().min(1).max(256),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  status: z.enum(['OPEN', 'CLOSED']).optional().default('OPEN'),
  pathwayId: z.string().min(1).max(128).optional().nullable(),
});

export const updateCycleSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']),
});

export const settingsSchema = z.object({
  organizationName: z.string().min(1).max(256).optional(),
  productName: z.string().min(1).max(256).optional(),
  primaryColor: z.string().max(32).optional(),
  weeklyDueDay: z.number().int().min(0).max(6).optional(),
  weeklyDueHour: z.number().int().min(0).max(23).optional(),
  autoCloseCycles: z.boolean().optional(),
  alertThresholdEnergy: z.number().int().min(1).max(10).optional(),
  alertThresholdMood: z.number().int().min(1).max(10).optional(),
  alertThresholdAttend: z.number().int().min(0).max(100).optional(),
  alertThresholdConf: z.number().int().min(1).max(10).optional(),
  outlookEnabled: z.boolean().optional(),
  brightspaceEnabled: z.boolean().optional(),
});

export const targetedQuestionSchema = z.object({
  question: z.string().min(1).max(1000),
  studentId: z.string().min(1).max(128),
  cycleId: z.string().min(1).max(128).optional().nullable(),
});

export const reviewReportSchema = z.object({
  feedback: z.string().min(1).max(5000).optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type SetupAccountInput = z.infer<typeof setupAccountSchema>;
export type RegisterStaffInput = z.infer<typeof registerStaffSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type WeeklyReportInput = z.infer<typeof weeklyReportSchema>;
export type PathwayInput = z.infer<typeof pathwaySchema>;
export type ClassInput = z.infer<typeof classSchema>;
export type CommunityInput = z.infer<typeof communitySchema>;
export type CycleInput = z.infer<typeof cycleSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type TargetedQuestionInput = z.infer<typeof targetedQuestionSchema>;
