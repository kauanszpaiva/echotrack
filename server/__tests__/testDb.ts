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
  auditLog: { create: vi.fn(async () => ({})) },
  conductEntry: { findMany: vi.fn(async () => []) },
  classModel: { findMany: vi.fn(async () => []) },
  studentProfile: { findUnique: vi.fn(async () => null) },
  appSettings: {
    findUnique: vi.fn(async () => ({ id: 'singleton' })),
    create: vi.fn(async () => ({ id: 'singleton' })),
  },
};

export function resetPrismaMock() {
  Object.values(prismaMock).forEach((model: any) =>
    Object.values(model).forEach((fn: any) => fn.mockClear?.()),
  );
}
