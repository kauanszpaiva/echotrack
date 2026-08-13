// Testes para os schemas de validação Zod
import { describe, expect, it } from 'vitest';
import {
  weeklyReportSchema,
  signupSchema,
  setupAccountSchema,
  registerStaffSchema,
  inviteSchema,
  pathwaySchema,
  classSchema,
  cycleSchema,
  settingsSchema,
  targetedQuestionSchema,
} from '../schemas.js';

describe('weeklyReportSchema', () => {
  it('validates a valid draft report', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'DRAFT',
      energy: 8,
      mood: 7,
      attendance: 100,
      confidence: 8,
      weeklyTopic: 'My week',
      highlights: 'Great week!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'REVIEWED', // Students can't set this
    });
    expect(result.success).toBe(false);
  });

  it('rejects energy out of range', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'DRAFT',
      energy: 11, // Max is 10
    });
    expect(result.success).toBe(false);
  });

  it('rejects mood out of range', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'DRAFT',
      mood: 0, // Min is 1
    });
    expect(result.success).toBe(false);
  });

  it('rejects attendance out of range', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'DRAFT',
      attendance: 101, // Max is 100
    });
    expect(result.success).toBe(false);
  });

  it('accepts challengesTags as array', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'DRAFT',
      challengesTags: ['tag1', 'tag2'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts challengesTags as JSON string', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'DRAFT',
      challengesTags: '["tag1", "tag2"]',
    });
    expect(result.success).toBe(true);
  });

  it('validates class ratings', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'DRAFT',
      classRatings: [
        { classId: 'class_1', rating: 'EXCEEDING', comment: 'Great!' },
        { classId: 'class_2', rating: 'MEETING' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid class rating value', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'DRAFT',
      classRatings: [{ classId: 'class_1', rating: 'INVALID' }],
    });
    expect(result.success).toBe(false);
  });

  it('validates targeted answers', () => {
    const result = weeklyReportSchema.safeParse({
      status: 'DRAFT',
      targetedAnswers: [
        { questionId: 'q1', answer: 'My answer' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('allows missing optional fields', () => {
    const result = weeklyReportSchema.safeParse({ status: 'DRAFT' });
    expect(result.success).toBe(true);
    if (result.data) {
      // Zod returns undefined for optional fields without defaults
      expect(result.data.energy).toBeUndefined();
      expect(result.data.mood).toBeUndefined();
      expect(result.data.attendance).toBeUndefined();
      expect(result.data.confidence).toBeUndefined();
      expect(result.data.needsSupport).toBe(false);
    }
  });
});

describe('signupSchema', () => {
  it('validates a valid signup', () => {
    const result = signupSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'securePass123',
      programManagerId: 'pm_1',
      coachId: 'coach_1',
      pathwayId: 'pathway_1',
      classIds: ['class_1', 'class_2'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = signupSchema.safeParse({
      name: 'John Doe',
      email: 'not-an-email',
      password: 'securePass123',
      programManagerId: 'pm_1',
      coachId: 'coach_1',
      pathwayId: 'pathway_1',
      classIds: ['class_1'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects password too short', () => {
    const result = signupSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'short',
      programManagerId: 'pm_1',
      coachId: 'coach_1',
      pathwayId: 'pathway_1',
      classIds: ['class_1'],
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one class', () => {
    const result = signupSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'securePass123',
      programManagerId: 'pm_1',
      coachId: 'coach_1',
      pathwayId: 'pathway_1',
      classIds: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('setupAccountSchema', () => {
  it('validates token and password', () => {
    const result = setupAccountSchema.safeParse({
      token: 'abc123',
      password: 'newpassword123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects short password', () => {
    const result = setupAccountSchema.safeParse({
      token: 'abc123',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });
});

describe('registerStaffSchema', () => {
  it('validates valid staff registration', () => {
    const result = registerStaffSchema.safeParse({
      name: 'Jane Smith',
      email: 'jane@example.com',
      password: 'password123',
      role: 'COACH',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid role', () => {
    const result = registerStaffSchema.safeParse({
      name: 'Jane Smith',
      email: 'jane@example.com',
      password: 'password123',
      role: 'INVALID_ROLE',
    });
    expect(result.success).toBe(false);
  });
});

describe('pathwaySchema', () => {
  it('validates a pathway', () => {
    const result = pathwaySchema.safeParse({
      name: 'Computer Science',
      description: 'CS pathway',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = pathwaySchema.safeParse({
      description: 'No name',
    });
    expect(result.success).toBe(false);
  });
});

describe('cycleSchema', () => {
  it('validates a cycle with ISO dates', () => {
    const result = cycleSchema.safeParse({
      name: 'Week 1',
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-01-07T23:59:59Z',
      status: 'OPEN',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid date format', () => {
    const result = cycleSchema.safeParse({
      name: 'Week 1',
      startDate: 'not-a-date',
      endDate: '2026-01-07T23:59:59Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('settingsSchema', () => {
  it('validates partial settings update', () => {
    const result = settingsSchema.safeParse({
      organizationName: 'New Name',
      alertThresholdEnergy: 4,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid threshold value', () => {
    const result = settingsSchema.safeParse({
      alertThresholdEnergy: 11, // Max is 10
    });
    expect(result.success).toBe(false);
  });
});

describe('targetedQuestionSchema', () => {
  it('validates a question', () => {
    const result = targetedQuestionSchema.safeParse({
      question: 'How was your week?',
      studentId: 'student_1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional cycleId', () => {
    const result = targetedQuestionSchema.safeParse({
      question: 'How was your week?',
      studentId: 'student_1',
      cycleId: 'cycle_1',
    });
    expect(result.success).toBe(true);
  });
});
