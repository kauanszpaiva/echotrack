# EchoTrack — AI Studio → Production Parity Matrix

**Reference:** `echotrack---year-up-weekly--system (3).zip` (AI Studio export)
**Target:** `kauanszpaiva/echotrack` (production)
**Branch:** `claude/echotrack-production-migration-dzxsm2`
**Status:** `IN_PROGRESS`

---

## 0. Baseline measurement

| Metric | AI Studio | GitHub (before migration) |
|---|---|---|
| Prisma models | 35 | 17 |
| Route declarations | 190 | 61 |
| SPA routes | 51 | 30 |
| Datasource | SQLite (`prisma/dev.db` committed) | PostgreSQL (Supabase) |
| Auth | Firebase Auth + custom JWT + bcrypt | Clerk (server-verified) |
| Authorization | `roleMiddleware` + partial scopes | `authMiddleware` + `roleMiddleware` + `expandRoles` |
| Server routes file | `server/routes.ts` — 3762 lines, monolithic | 6 modular routers |
| Secrets in repo | `firebase-service-account.json` committed | none |

---

## 1. Critical finding — persistence reality of the AI Studio export

The AI Studio build is **not uniformly Prisma-backed**. Auditing every service and
router against `prisma/schema.prisma` shows three distinct tiers. This governs
what can be ported mechanically and what requires schema design.

| Tier | Domains | Backing store | Portability |
|---|---|---|---|
| **A — Real** | Student engagement, Standing/Contract Points, ClassStaffMembership, Chat | Prisma models, real reads/writes | Port additively |
| **B — Ephemeral** | Classroom stream, classwork, assignments, submissions, attendance | Module-level `let` arrays in `classroomRoutes.ts` | **Not portable.** Data dies on every serverless invocation. Requires new schema. |
| **C — Fabricated** | Classroom performance, PSM partners, internships, career profile, calendar | Hardcoded literals / client `useState` | **Not portable.** Forbidden by the brief. Requires schema + real data path. |

### Tier B/C evidence

- `server/routes/classroomRoutes.ts` — `streamPosts` and `assignments` are module
  scope arrays; `POST /classes/:classId/stream` pushes into memory only.
- `server/routes/classroomRoutes.ts:553` — `// Custom mock/fake trend profiles per
  class type for rich testing`, followed by nine hardcoded weekly `avgGrade`
  values and `totalStudents: 18` returned from a **production** endpoint.
- `server/services/partnerService.ts:37` — `const defaultPartners: PartnerAccount[] = [...]`.
- `server/services/internshipService.ts:36` — `const defaultOpenings: InternshipOpening[] = [...]`.
- `server/services/careerService.ts` — imports `prisma` but references **zero**
  Prisma models.
- `src/views/Classroom/CalendarView.tsx:31` — `// Default mock calendar events`.

### Latent defect inherited by the reference's own authorization layer

`server/authorization/scopes.ts:25` and `:44` issue `$queryRaw` against tables
`CoachStudentAssignment` and `PsmStudentAssignment` that **do not exist** in the
schema, with `.catch(() => [])`. Both lookups therefore always resolve to "no
assignment", silently. Ported logic must not carry this pattern forward.

---

## 2. Feature parity matrix

Legend — **Status**: `DONE` shipped this migration · `PARTIAL` · `DEFERRED` (with reason) · `REJECTED` (violates brief)

| Feature | AI Studio source | GitHub current | Gap | Data dependency | API dependency | Security scope | Target files | Status |
|---|---|---|---|---|---|---|---|---|
| **Student** |
| Daily Check-In | `DailyCheckInWidget.tsx`, routes `3618`–`3658` | absent | full | `DailyCheckIn` | `GET/POST /api/student/daily-checkin` | OWN only | `prisma/schema.prisma`, `server/routes/engagement.ts` | DONE |
| Weekly Goals | `WeeklyGoalsModule.tsx`, routes `3660`–`3770` | absent | full | `WeeklyGoal` | `GET/POST/PATCH/DELETE /api/student/weekly-goals` | OWN + coach read | same | DONE |
| Student Templates | routes `3381`–`3430` | absent | full | `StudentTemplate` | `GET/POST/DELETE /api/student/templates` | OWN only | same | DONE |
| Class-change requests | `ClassChangeRequest` model | absent | full | `ClassChangeRequest` | `/api/student/class-requests` | OWN create, staff approve | same | DONE |
| Student Dashboard enhancements | `StudentDashboard.tsx` | basic dashboard | partial | above | — | OWN | `src/views/Student/` | DEFERRED — UI slice |
| Career Profile | `StudentCareerProfile.tsx` | absent | full | **none (Tier C)** | — | OWN | — | DEFERRED — no schema |
| Standing & Points | `StudentStanding.tsx` | absent | full | Standing domain | `/api/standing/me` | OWN | — | DEFERRED — see §4 |
| Student Classes / Detail | `StudentClasses.tsx`, `StudentClassDetail.tsx` | absent | full | **Tier B** | — | enrollment | — | DEFERRED — no schema |
| Student Settings | `StudentSettings.tsx` | absent | full | `User`/`StudentProfile` | — | OWN | — | DEFERRED — UI slice |
| Weekly Report Wizard | `StudentReportWizard.tsx` | present | parity gap | existing | existing | OWN | — | PARTIAL |
| Report History | `StudentHistory.tsx` | present | minor | existing | existing | OWN | — | PARTIAL |
| **Coach** |
| Coaching Goals | routes `3457`–`3530` | absent | full | `CoachingGoal` | `/api/coaching-goals` | assigned students only | `server/routes/engagement.ts` | DONE |
| Annotations / internal notes | routes `3322`–`3380` | absent | full | `Annotation` | `/api/annotations` | report scope | same | DONE |
| Coach Student Detail | `CoachStudentDetail.tsx` | absent | full | existing | `/api/coach/students/:id` | **assigned only** | `server/authorization/` | PARTIAL — scope enforced, UI deferred |
| Coach Analytics | `CoachAnalytics.tsx` | absent | full | existing | — | assigned cohort | — | DEFERRED — UI slice |
| Coach Settings | `CoachSettings.tsx` | absent | full | `User` | — | OWN | — | DEFERRED — UI slice |
| AI Coach Insights | `AICoachInsightModule.tsx`, `geminiService.ts` | absent | full | existing | `/api/ai/coach-insights` | assigned only | — | DEFERRED — see §5 |
| Coach Dashboard / Students / Reports / Alerts | `Coach*.tsx` | present | minor | existing | existing | assigned | — | PARTIAL |
| **Program Manager / Admin** |
| Standing policy administration | `AdminStandingPolicy.tsx`, `standingRoutes.ts` | absent | full | 10 models | `/api/standing/*` | ADMIN/PM | — | DEFERRED — see §4 |
| Real-time activity feed | `RealTimeActivityFeed.tsx` | absent | full | `AuditLog` | `/api/admin/activity` | ADMIN/PM | — | DEFERRED — must be real-data only |
| Conduct / standing workflow | `ConductTracker.tsx` | `ConductEntry` present | divergent | see §4 | existing | ADMIN/PM | — | PARTIAL |
| Analytics / Audit / Settings / Targeted Questions | `Admin/*.tsx` | present | minor | existing | existing | ADMIN | — | PARTIAL |
| **Instructor / Classroom** |
| Class staff membership | `ClassStaffMembership`, `classMembershipService.ts` | absent | full | `ClassStaffMembership` | `/api/classes/:id/staff` | class membership | `prisma/schema.prisma` | DONE — schema + scope |
| Class Detail Workspace / Stream / Classwork | `ClassDetailWorkspace.tsx`, `StreamFeed.tsx` | absent | full | **Tier B — none** | — | class membership | — | DEFERRED — no schema |
| Assignments / submissions / grading | `GradebookSpreadsheet.tsx` | absent | full | **Tier B — none** | — | class membership | — | DEFERRED — no schema |
| Attendance | `classroomRoutes.ts` | absent | full | **Tier B — none** | — | class membership | — | DEFERRED — no schema |
| Class performance | `classroomRoutes.ts:548` | absent | — | **Tier C — fabricated** | — | — | — | REJECTED — fake benchmarks |
| **PSM / Internship** |
| `/psm`, `/psm/partners`, `/psm/internships`, `/psm/students`, `/psm/matching` | `PSM/*.tsx`, `psmRoutes.ts` | absent | full | **Tier C — none** | — | placement fields only | — | DEFERRED — no schema |
| PSM student scope isolation | `psmRoutes.ts` | `PSM` role exists via `expandRoles` | design gap | existing | — | **must not inherit coach access** | `server/authorization/` | PARTIAL — see §3 |
| **Chat** |
| Channels / messages / reactions | `ChatWorkspace.tsx`, routes `2228`–`2460` | absent | full | `ChatChannel`, `ChatMessage` | `/api/chat/*` | **membership required** | `prisma/schema.prisma` | PARTIAL — schema + membership model added, routes deferred |
| **Calendar** |
| Calendar view | `CalendarView.tsx` | absent | full | **Tier C — none** | — | — | — | DEFERRED — no schema |
| **Platform** |
| Transactional email | none (mock) | none | full | `NotificationDispatch` | — | server-only | `server/email/` | DONE |
| Report reminders | `server/cron.ts` (`node-cron`) | none | full | `NotificationDispatch` | `POST /api/cron/report-reminders` | cron secret | `server/routes/cron.ts` | DONE |

---

## 3. PSM isolation — explicit design decision

`shared/roles.ts` currently expands `COACH ⇒ PSM`, so any route gated on `COACH`
admits `PSM`. The brief requires the opposite: *"PSM não recebe acesso geral a
dados acadêmicos/coaching apenas por possuir role PSM."*

**Decision:** `expandRoles` is left intact (removing it would silently revoke
access that existing routes depend on, a regression). Isolation is instead
enforced at the **resource scope** layer in `server/authorization/scopes.ts`,
which distinguishes `COACH` from `PSM` when resolving student access. Routes
carrying confidential academic/coaching data call `assertStudentScope` with
`allowPsm: false`.

A follow-up slice should split `COACH_LEVEL` once every call site is audited.

---

## 4. ConductEntry vs the Standing domain — explicit strategy

The brief forbids destructive migrations and silent duplication. Three options
were considered:

1. Replace `ConductEntry` with `InfractionCase` — **rejected**, destructive.
2. Run both with no link — **rejected**, silent duplication.
3. **Chosen:** keep `ConductEntry` as the simplified live model. The Standing
   domain's `InfractionCase` already carries `legacyConductEntryId` in the AI
   Studio schema; that column is the documented bridge. When the Standing domain
   ships, a backfill maps each `ConductEntry` to an `InfractionCase` and stamps
   the link. Until then `ConductEntry` remains the single source of truth and no
   existing row is touched.

**Standing domain is DEFERRED in this slice.** It is 10 models plus an 848-line
service with a points ledger, idempotency keys, reversal chains and appeal state
machines. Shipping it half-built would put an unbalanced ledger in production.
It needs its own slice with its own reconciliation tests.

---

## 5. Consciously deferred, with reasons

| Deferred | Reason |
|---|---|
| Standing / Contract Points domain | 10 models + ledger with idempotency, reversals, appeals. Needs a dedicated slice and reconciliation tests. §4 |
| Classroom workspace | Source is Tier B (in-memory) — no schema exists to port. Requires designing stream/classwork/submission/attendance models from scratch. |
| Class performance analytics | Source is Tier C (hardcoded). Forbidden by the brief. Must be recomputed from real submissions once classroom persists. |
| PSM placement workspace | Source is Tier C (in-memory arrays). Requires designing partner/internship/match models and the placement field allowlist. |
| Career profile | Tier C. `careerService.ts` touches no Prisma model. |
| Calendar | Tier C. Client-side mock events only. |
| Chat routes | Schema + membership model shipped; routes held until the membership authorization tests land. |
| AI Coach Insights | Depends on coach→student scope, which ships here; endpoint follows in the AI slice. |
| Full UI parity / screenshots | Requires the deferred data domains to exist before pages can render real data. |

---

## 6. Prototype artifact sweep (Phase 8)

Sweep of the **production repo** for every forbidden marker:

| Marker | AI Studio | GitHub production | Action |
|---|---|---|---|
| `firebase` / `firestore` | `src/firebase.ts`, `server/firebase-admin.ts`, `firestore.rules`, `DRAFT_firestore.rules`, `firebase-blueprint.json`, `src/lib/seedFirestore.ts` | **0 occurrences** | never ported |
| `firebase-service-account.json` | committed with private key | **absent** | never ported |
| `bcrypt` / custom JWT | present | **0 occurrences** | already removed (commit `a8909c8`) |
| `JWT_SECRET` | present | 1 hit — historical note in `SUPABASE_SETUP.md:119` | documentation only, retained |
| `sqlite` / `prisma/dev.db` | `dev.db` committed | **absent** | never ported |
| `node-cron` | `server/cron.ts` | **absent** | replaced by Vercel Cron endpoint |
| `Math.random()` for metrics | present | **0 occurrences** | never ported |
| `Alex Student` fallback | present | **0 occurrences** | never ported |
| `origin: true` CORS | present | **absent** — explicit allowlist | never ported |
| Public `/seed` | present | **absent** | `prisma/seed.ts` is a CLI script, not an endpoint |
| Quick Demo Access / shared demo passwords | present | **0 occurrences** | never ported |

**Result: the production repo is already clean.** No removal work was required —
the risk is re-introduction, which this matrix exists to prevent.

---

## 7. Authorization matrix

See `server/authorization/scopes.ts` and the negative tests in
`server/__tests__/authorization.test.ts`.

| Actor | Resource | Expected |
|---|---|---|
| Unauthenticated | any protected `/api` route | `401` |
| Student | own check-in / goal / template | allow |
| Student | another student's private resource | `404` (existence not leaked) |
| Student | staff-only route | `403` |
| Coach | assigned student | allow |
| Coach | unassigned student | `404` |
| PSM | placement-scoped resource | allow |
| PSM | confidential academic/coaching resource | `404` |
| Instructor | class they are `ACTIVE` staff on | allow |
| Instructor | unrelated class | `404` |
| Instructor | role claim only, no membership | `404` |
| Program Manager | students in their program | allow |
| Admin / Dev | full scope by explicit policy | allow |
| Any | role supplied in body/query/header | **ignored** — role comes from Clerk only |

`404` rather than `403` is deliberate for cross-tenant reads: a `403` confirms the
resource exists, which is itself a disclosure on sequential-ID probing.
