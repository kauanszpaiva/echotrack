import { vi } from 'vitest';

/**
 * Minimal in-memory stand-in for the Prisma client, good enough for the auth
 * and authorization paths. Only the models/methods those paths touch are
 * implemented; anything else throws loudly rather than silently returning
 * undefined and hiding a bug in a test.
 */
export interface SeedUser {
  id: string;
  clerkUserId?: string | null;
  email: string;
  name?: string;
  role: string;
  accountStatus?: string;
  isActive?: boolean;
}

export const store: { users: any[]; failNextQuery: boolean } = { users: [], failNextQuery: false };

export function resetStore(users: SeedUser[] = []) {
  store.failNextQuery = false;
  store.users = users.map((u) => ({
    clerkUserId: null,
    name: u.email.split('@')[0],
    accountStatus: 'ACTIVE',
    isActive: true,
    inviteToken: null,
    inviteExpires: null,
    managerId: null,
    createdAt: new Date(),
    ...u,
  }));
}

function matches(user: any, where: any): boolean {
  return Object.entries(where).every(([key, value]) => user[key] === value);
}

function guard() {
  if (store.failNextQuery) {
    store.failNextQuery = false;
    throw new Error('connect ECONNREFUSED 10.0.0.1:5432 — database unavailable');
  }
}

function project(user: any, select?: Record<string, boolean>) {
  if (!user) return null;
  if (!select) return { ...user };
  return Object.fromEntries(Object.keys(select).map((key) => [key, user[key]]));
}

/**
 * Row store for every model other than `user` (which keeps its bespoke store
 * because the identity-mirror tests reach into it directly).
 */
export const tables: Record<string, any[]> = {};

export function seedTable(name: string, rows: any[]) {
  tables[name] = rows.map((r) => ({ createdAt: new Date(), ...r }));
}

export function resetTables() {
  for (const key of Object.keys(tables)) delete tables[key];
}

/** Supports the subset of Prisma `where` the ported handlers actually use. */
function matchWhere(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const c: any = condition;
      if (Array.isArray(c.in)) return c.in.includes(row[key]);
      if (c.gte !== undefined) return row[key] >= c.gte;
      if (c.lte !== undefined) return row[key] <= c.lte;
      // Relation filters (e.g. `studentProfile: { pathwayId }`) are not modelled;
      // treat them as satisfied so the surrounding scalar conditions still apply.
      return true;
    }
    return row[key] === condition;
  });
}

function applyOrder(rows: any[], orderBy: any) {
  if (!orderBy) return rows;
  const [field, direction] = Object.entries(orderBy)[0] as [string, string];
  return [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === bv) return 0;
    return (av > bv ? 1 : -1) * (direction === 'desc' ? -1 : 1);
  });
}

/**
 * An in-memory Prisma model delegate.
 *
 * `include` is not simulated — seed the related object directly on the row when
 * a handler reads through one (e.g. `annotation.report.studentId`).
 */
function collection(name: string) {
  const rows = () => (tables[name] ??= []);
  return {
    findUnique: vi.fn(async ({ where, select }: any) => {
      guard();
      return project(rows().find((r) => matchWhere(r, where)), select);
    }),
    findFirst: vi.fn(async ({ where, select }: any = {}) => {
      guard();
      return project(rows().find((r) => matchWhere(r, where)), select);
    }),
    findMany: vi.fn(async ({ where, select, orderBy, take, skip }: any = {}) => {
      guard();
      let found = rows().filter((r) => matchWhere(r, where));
      found = applyOrder(found, orderBy);
      if (skip) found = found.slice(skip);
      if (take) found = found.slice(0, take);
      return found.map((r) => project(r, select));
    }),
    create: vi.fn(async ({ data, select }: any) => {
      guard();
      const uniques = uniqueFields[name] ?? [];
      for (const field of uniques) {
        if (data[field] !== undefined && rows().some((r) => r[field] === data[field])) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
      }
      const created = { id: `${name}-${rows().length + 1}`, createdAt: new Date(), ...data };
      rows().push(created);
      return project(created, select);
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      guard();
      const row = rows().find((r) => matchWhere(r, where));
      if (!row) throw new Error(`Record to update not found in ${name}`);
      Object.assign(row, data);
      return project(row, select);
    }),
    delete: vi.fn(async ({ where }: any) => {
      guard();
      const index = rows().findIndex((r) => matchWhere(r, where));
      if (index === -1) throw new Error(`Record to delete not found in ${name}`);
      return rows().splice(index, 1)[0];
    }),
    count: vi.fn(async ({ where }: any = {}) => {
      guard();
      return rows().filter((r) => matchWhere(r, where)).length;
    }),
    groupBy: vi.fn(async () => { guard(); return []; }),
  };
}

/** Columns carrying a UNIQUE constraint, so create() can raise P2002 like Postgres. */
const uniqueFields: Record<string, string[]> = {
  notificationDispatch: ['dedupeKey'],
};

export const prismaMock = {
  user: {
    findUnique: vi.fn(async ({ where, select }: any) => {
      guard();
      return project(store.users.find((u) => matches(u, where)), select);
    }),
    findFirst: vi.fn(async ({ where, select }: any) => {
      guard();
      return project(store.users.find((u) => matches(u, where)), select);
    }),
    findMany: vi.fn(async ({ select }: any = {}) => {
      guard();
      return store.users.map((u) => project(u, select));
    }),
    create: vi.fn(async ({ data, select }: any) => {
      guard();
      if (store.users.some((u) => u.email === data.email || (data.id && u.id === data.id))) {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      const created = {
        clerkUserId: null,
        accountStatus: 'ACTIVE',
        isActive: true,
        createdAt: new Date(),
        ...data,
      };
      store.users.push(created);
      return project(created, select);
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      guard();
      const user = store.users.find((u) => matches(u, where));
      if (!user) throw new Error('Record to update not found');
      if (data.email && store.users.some((u) => u !== user && u.email === data.email)) {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      Object.assign(user, data);
      return project(user, select);
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      guard();
      const hits = store.users.filter((u) => matches(u, where));
      hits.forEach((u) => Object.assign(u, data));
      return { count: hits.length };
    }),
    count: vi.fn(async () => store.users.length),
  },
  auditLog: {
    create: vi.fn(async () => ({})),
    findMany: vi.fn(async () => { guard(); return []; }),
  },
  conductEntry: collection('conductEntry'),
  classModel: collection('classModel'),
  studentProfile: collection('studentProfile'),
  reportCycle: collection('reportCycle'),
  weeklyReport: collection('weeklyReport'),
  alert: collection('alert'),
  classRating: collection('classRating'),
  pathway: collection('pathway'),
  appSettings: {
    findUnique: vi.fn(async () => ({ id: 'singleton' })),
    create: vi.fn(async () => ({ id: 'singleton' })),
  },
  // ── Student engagement domain ────────────────────────────────────────────
  // Backed by `tables`, so a test can seed rows and assert on what a handler
  // wrote without standing up Postgres.
  dailyCheckIn: collection('dailyCheckIn'),
  weeklyGoal: collection('weeklyGoal'),
  studentTemplate: collection('studentTemplate'),
  coachingGoal: collection('coachingGoal'),
  annotation: collection('annotation'),
  classChangeRequest: collection('classChangeRequest'),
  classStaffMembership: collection('classStaffMembership'),
  studentClassEnrollment: collection('studentClassEnrollment'),
  community: collection('community'),
  chatChannelMember: collection('chatChannelMember'),
  notificationDispatch: collection('notificationDispatch'),
};

export function resetPrismaMock() {
  resetTables();
  Object.values(prismaMock).forEach((model: any) =>
    Object.values(model).forEach((fn: any) => fn.mockClear?.()),
  );
}
