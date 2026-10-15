# Diviyata Saviyak — Implementation Plan

2026-09-28 · Janindu Pramod

> **Status:** draft. This PLAN breaks the [SPEC](SPEC.md) into phases to build one at a time. Each task names the SPEC requirements it delivers (for example `CASE-5`) and each phase ends with the acceptance checks (`AC-n`) that must pass before the next phase starts.

## How we work

- **One phase at a time.** A phase is done only when its "Done when" checks pass. The next phase does not start before that.
- **One branch per phase** (`phase-1-foundation`, …), merged into `main` when the phase is done. Commit after each task.
- **Tests come with the code.** Every task that adds a rule adds its tests in the same commit. CI must be green before merging.
- **No real data in the repository.** Tests, seeds and demos use made-up people only (SEC-11).
- **Keep the documents in step.** When a requirement changes, update the PRD, SPEC and this PLAN together. After Phase 1, record the build, lint and test commands in `CLAUDE.md`.
- **Deferred questions** use the defaults in [SPEC section 13](SPEC.md#13-deferred-questions-and-the-defaults-used). When the Ministry answers one, change only the places listed there.

## Phases at a glance

| Phase | What it delivers | Depends on | Size |
| --- | --- | --- | --- |
| 1. Foundation | Project, database, Sinhala layout, CI | — | M |
| 2. Sign-in and permissions | Login, roles, data-access layer, audit log | 1 | M |
| 3. Admin | Accounts and lists screens | 2 | M |
| 4. Cases | New case, drafts, duplicate NIC, DS home | 3 | L |
| 5. Check and release | Head Office queues, decisions, Rs. 2M release | 4 | M |
| 6. Installments and progress | Installments, stages, photos, stop and reopen, history | 5 | L |
| 7. Dashboard and exports | Head Office dashboard, Excel exports, notifications | 6 | M |
| 8. Sheet import | Built, then removed on 2026-10-06 | 6 | — |
| 9. Go-live | AWS EC2 server with automatic deploys from GitHub, backups, alerts, security and performance checks, training | 7 | M |

Sizes are relative: S is a few days, M about one to two weeks, and L about two to three weeks of one developer's time.

## Target folder layout

```
src/
  app/
    (auth)/login, change-password
    ds/                 DS officer screens
    ho/                 Head Office screens
    admin/              admin screens
    files/[id]/route.ts protected file downloads
  components/           ui/ (shadcn), shell/ (header, menu), forms/
  server/               data-access layer: context, permissions, audit, one folder per area
  lib/                  nic.ts, phone.ts, dates.ts, money.ts, validation/ (Zod schemas)
  i18n/                 next-intl setup
messages/si.json        every screen string
prisma/                 schema.prisma, migrations/, seed.ts
data/                   seed lists (places and stages only, no personal data)
scripts/                seed-load.ts, seed-demo.ts, create-admin.ts
tests/e2e/              Playwright tests
docker/                 Dockerfile (the app and tools images)
deploy/                 the server: compose.yml, caddy/Caddyfile, server-setup.sh, scripts/ (deploy, backup, restore, monitor)
docker-compose.dev.yml  the development database
```

## Phase 1 — Foundation

**Goal:** an empty Sinhala application that builds, tests and runs against PostgreSQL, with the prototype's layout.

| # | Task | SPEC | Files |
| --- | --- | --- | --- |
| 1.1 | Create the Next.js app: TypeScript strict, App Router, `src/`, ESLint and Prettier; pin exact versions | STK-1 | `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs` |
| 1.2 | Add Tailwind and shadcn/ui; set the colours from the prototype (#0E5A4B and the neutrals) | UI-4 | `src/app/globals.css`, `src/components/ui/*` |
| 1.3 | Serve Noto Sans Sinhala from the app with `next/font/local`; 16 px base, line height 1.5 | UI-4, STK-2 | `src/app/fonts/*`, `src/app/layout.tsx` |
| 1.4 | Set up next-intl with the `si` locale and `messages/si.json`; date and money helpers (`YYYY.MM.DD`, `රු. 2,000,000`) | UI-1, UI-3 | `src/i18n/*`, `messages/si.json`, `src/lib/dates.ts`, `src/lib/money.ts` |
| 1.5 | PostgreSQL in `docker-compose.dev.yml`; Prisma with Province, District, DsOffice and AuditLog | Section 5 | `docker-compose.dev.yml`, `prisma/schema.prisma` |
| 1.6 | Seed the 9 provinces, 25 districts, the DS offices known so far, and the new-house stages | LST-1, LST-4 | `prisma/seed.ts`, `data/places.json`, `data/stages.json` |
| 1.7 | Page shells for the three roles: header, menu and "sample data" banner as in the prototype | UI-7 | `src/components/shell/*`, `src/app/{ds,ho,admin}/layout.tsx` |
| 1.8 | Vitest (with a test database) and Playwright; GitHub Actions running lint, type check, tests, build and `npm audit` | SEC-12 | `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml` |
| 1.9 | A check that fails CI when a component contains hard-coded screen text | UI-1 | `eslint.config.mjs` (i18n rule) or `scripts/check-strings.ts` |

**Tests:** date and money formatting; the seed creates 9 provinces and 25 districts; a Playwright smoke test opens each shell and finds Sinhala text only.

**Done when:**
- `npm run dev` shows the Sinhala shell for each role.
- `npm test` and the Playwright smoke test pass, and CI is green on `main`.
- `CLAUDE.md` lists the commands to run the app, the tests and a single test.

## Phase 2 — Sign-in and permissions

**Goal:** people sign in with the right role, and every server call goes through one permission layer that also writes the audit log.

| # | Task | SPEC | Files |
| --- | --- | --- | --- |
| 2.1 | Better Auth with username and password, sessions in PostgreSQL, the admin plugin; User fields from section 5. Its HTTP endpoints are not mounted: sign-in, sign-out and password changes go through Server Actions (ARC-1) | AUTH-1, AUTH-6 | `src/lib/auth.ts`, `src/app/(auth)/actions.ts`, `prisma/schema.prisma` |
| 2.2 | Sign-in page in Sinhala; lock after 5 wrong passwords for 15 minutes; 10 attempts per minute per IP | AUTH-2, SEC-4 | `src/app/(auth)/login/*`, `src/server/auth/limits.ts` |
| 2.3 | Forced "set a new password" page for temporary passwords | AUTH-3 | `src/app/(auth)/change-password/*` |
| 2.4 | Session limits: 30 minutes idle, 12 hours maximum; disabled accounts stop working at once | AUTH-4, AUTH-5 | `src/lib/auth.ts` |
| 2.5 | Data-access layer: `getContext()` (user, role, office), `requireRole()`, office scoping, and "not found" for anything out of scope | ARC-2, PRM-1–3 | `src/server/context.ts`, `src/server/permissions.ts` |
| 2.6 | Audit writer used inside the same transaction as each change; a database trigger that refuses any change or removal of audit rows | ARC-4, HIS-1, HIS-3 | `src/server/audit.ts`, `prisma/migrations/*` |
| 2.7 | Proxy (Next.js 16's name for middleware) that only redirects signed-out users; role home pages; the "not found" page | ARC-3, ERR-2 | `src/proxy.ts`, `src/app/not-found.tsx` |
| 2.8 | Security headers, Server Actions origin check, error page with a reference code, logging without personal data | SEC-5, SEC-6, SEC-8, ERR-6 | `next.config.ts`, `src/app/error.tsx`, `src/server/log.ts` |
| 2.9 | Resetting a forgotten password by email (added 2026-10-14; the request to the admin built earlier that day was replaced, first by a code sent by SMS, then the same day by email): "මුරපදය අමතකද?" on the sign-in page opens `/forgot-password`, three steps on one page (username, code, new password); migration `reset_password_by_sms` drops `app_user.new_password_asked_at` and adds `password_reset_code`; the code goes to the account's email address (`contact_email`, which the account form now says) through the mail server in `SMTP_HOST` (nodemailer), or into a file in development and CI; limits 5 per 15 minutes per IP, 5 codes per account a day, 5 tries per code; the sign-in page's notice; the account history's two new entries | AUTH-7, SEC-4, SEC-9, STK-2, AC-31 | `src/app/(auth)/forgot-password/*`, `src/app/(auth)/actions.ts`, `src/app/(auth)/login/page.tsx`, `src/server/auth/{password-reset,rate-limit}.ts`, `src/server/mail.ts`, `src/app/admin/users/account-form.tsx`, `src/app/admin/users/[id]/edit/account-history.tsx`, `messages/*.json`, `deploy/ec2/{stack/compose.yml,setup/env.example}` |

**Tests:** permission helpers for every role and office combination; an audit row is written with each change and rolled back with it; e2e for sign-in, lockout and the forced password change.

**Done when:**
- AC-4 passes.
- Each role lands on its own home page, and opening another role's page shows "not found".
- A test user created by the seed can sign in and must change their password.

## Phase 3 — Admin: accounts and lists

**Goal:** the admin can set up every office's officers and keep the lists, matching the prototype's admin screens.

| # | Task | SPEC | Files |
| --- | --- | --- | --- |
| 3.1 | Users list with search and role filter | ADM-1 | `src/app/admin/users/page.tsx`, `src/server/users/*` |
| 3.2 | Create account: form, district → DS choice, usernames, 12-character temporary password shown once, one active DS officer (the Child Rights Promotion Officer) per office, enforced by the database too (until 2026-10-14, see 3.7) | ADM-2, ADM-3 | `src/app/admin/users/*`, `src/lib/validation/user.ts`, `prisma/migrations/*` |
| 3.3 | Edit account and transfer to another office, with history | ADM-4, PRM-3 | `src/server/users/*` |
| 3.4 | Reset password, disable and enable, with the "last admin" and "not yourself" rules | ADM-5, ADM-6, ADM-7 | `src/server/users/*` |
| 3.5 | Lists: districts and DS offices (add, rename, deactivate) | LST-2, LST-3 | `src/app/admin/lists/*`, `src/server/lists/*` |
| 3.6 | Lists: stages per kind (add, rename, reorder, deactivate), on a second tab of the lists page (`/admin/lists?tab=stages`) | LST-4 | `src/app/admin/lists/*`, `src/server/lists/*` |
| 3.7 | Several DS officers per office (added 2026-10-14): migration `several_officers_per_office` drops the one-officer index; the account commands take any active office; the form offers every office, by name only; the lists screen names every officer; the demo data tells every officer of an office; the role is renamed Divisional Secretariat Officer (ප්‍රාදේශීය ලේකම් කාර්යාල නිලධාරී), since an office's officers are not all Child Rights Promotion Officers | ADM-3, NTF-1, AC-23 | `prisma/migrations/*`, `src/server/users/*`, `src/app/admin/users/account-form.tsx`, `src/server/lists/queries.ts`, `src/app/admin/lists/page.tsx`, `scripts/seed-{demo,load}.ts`, `messages/*.json` |

**Tests:** unit tests for username generation and the account rules; database tests for every account and list command and its audit record; e2e for creating a DS officer who then signs in (AC-3), a second officer at the same office (AC-23), transfer, reset and disable, adding an office and a stage, and a Head Office officer trying an admin page (not found).

**Done when:**
- AC-3 and AC-23 pass.
- An admin can create, reset, transfer and disable accounts, and every step shows in the audit log.

## Phase 4 — Cases: entry, drafts and the DS home

**Goal:** DS officers (and Head Office) can enter cases, save drafts and submit them, and DS officers see their own list.

| # | Task | SPEC | Files |
| --- | --- | --- | --- |
| 4.1 | Prisma: Case, Decision, File (which knows its case) and the case-number counter; statuses and categories as enums; `version` column | Section 5 | `prisma/schema.prisma` |
| 4.2 | NIC and phone rules, and the old-to-new NIC conversion | CASE-2, CASE-6 | `src/lib/nic.ts`, `src/lib/phone.ts` |
| 4.3 | Case form on one page with four parts, shared Zod schema, draft saving with partial checks | CASE-1–4 | `src/app/ds/cases/new/*`, `src/components/forms/case-form.tsx`, `src/lib/validation/case.ts` |
| 4.4 | Submit with confirmation, case numbers per DS per year (safe when two people submit at once) | CASE-5 | `src/server/cases/submit.ts` |
| 4.5 | Duplicate NIC warning that shows less for other offices | CASE-6 | `src/server/cases/duplicates.ts` |
| 4.6 | Document upload: one file per request as it is chosen, type checked from contents, random names, private folder, `/files/[id]` with the case's permission check | CASE-2, ARC-5, SEC-7, ERR-5 | `src/server/files/*`, `src/app/files/[id]/route.ts` |
| 4.7 | Returned-case editing with the Head Office reason at the top; draft deletion; save conflicts (`version`) | CASE-7, CASE-8, CASE-10, ERR-3, ERR-8 | `src/app/ds/cases/[id]/edit/*`, `src/server/cases/*` |
| 4.8 | DS home: list, tabs, search, and the to-do panel (returned cases and drafts for now) | HOME-1–3, FND-1 | `src/app/ds/page.tsx`, `src/server/cases/list.ts` |
| 4.9 | Head Office: new case (district → DS) and the case list with filters | CASE-3, FND-1 | `src/app/ho/cases/*` |

**Tests:** NIC and phone rules (AC-6); case-number generation under parallel submits; duplicate matching across offices (AC-7); e2e for office separation (AC-1), required-field errors (AC-5) and submitting (first half of AC-8).

**Done when:**
- AC-1, AC-5, AC-6 and AC-7 pass.
- A submitted case gets its number and appears as "පරීක්ෂාවට යවා ඇත" (sent for checking) on the DS home.

## Phase 5 — Head Office check and the release

**Goal:** a case can go from the DS to Head Office and back, and be verified and funded.

| # | Task | SPEC | Files |
| --- | --- | --- | --- |
| 5.1 | One status-change module that allows only the moves in SPEC section 6; the submit goes through it too | STS-1–3 | `src/server/cases/transitions.ts`, `src/server/cases/commands.ts` |
| 5.2 | Check queue, oldest first, with duplicate flags, as one screen with the release queue (two tabs) | CHK-1 | `src/app/ho/check/*`, `src/server/cases/queues.ts` |
| 5.3 | Case check view with documents and full duplicate details, in the queue screen and on the case page | CHK-2 | `src/app/ho/check/review-screen.tsx`, `src/app/ho/cases/[id]/*`, `src/components/review/*` |
| 5.4 | Verify, send back and reject, with reasons and Decisions | CHK-3 | `src/server/cases/decide.ts` |
| 5.5 | Release queue and the release form; four installments created on save; release corrections; the money section on both case pages | REL-1–4 | `src/app/ho/release/*`, `src/server/releases/*`, `src/components/cases/money-section.tsx` |
| 5.6 | Notifications table, the notices for every decision, the DS bell and its list, the waiting counts in the Head Office menu | NTF-1 | `src/server/notifications/*`, `src/app/ds/notifications/*`, `src/components/shell/*` |
| 5.7 | Edits after verification, Head Office only, logged field by field | CASE-9 | `src/server/cases/rules.ts`, `src/server/cases/commands.ts`, `src/components/forms/case-form.tsx` |
| 5.8 | Narrowing both queues to a district or DS office, with the count waiting at each (added 2026-10-06) | CHK-4 | `src/app/ho/check/place.ts`, `src/app/ho/check/place-picker.tsx`, `src/server/cases/queues.ts` |
| 5.9 | Release by district allocation letter, as in the prototype's option A (added 2026-10-06): the letter table and scan (migrations `letter_file_kind`, `release_letter`), the release tab's districts and letter form, the banner on the check tab, the letter on both case pages, and correcting the letter. Replaces 5.5's one-case release form | REL-1–4, AC-26 | `prisma/schema.prisma`, `src/server/releases/*`, `src/app/ho/check/review-screen.tsx`, `src/components/review/letter-*.tsx`, `src/components/review/correct-release.tsx`, `src/components/cases/money-section.tsx` |

**Tests:** every allowed and refused status change; reasons required; release date rules; e2e for the full path DS → check → send back → resubmit → verify → release (AC-8, AC-9, AC-10), rejecting, and Head Office's corrections (CASE-9, REL-4).

**Done when:** AC-8, AC-9 and AC-10 pass.

## Phase 6 — Installments, building progress and closing

**Goal:** the DS records payments and progress, and a case can finish, stop or reopen, with its full history on the case page.

| # | Task | SPEC | Files |
| --- | --- | --- | --- |
| 6.1 | Installment actions: start (expected date) and mark paid (date), only the next one, date rules; Head Office undo with a reason. Every change claims the case at the version the page showed | INS-1–6 | `src/server/installments/*`, `src/server/cases/claim.ts`, `src/lib/validation/progress.ts`, `src/app/ds/cases/[id]/actions.ts`, `src/app/ho/cases/[id]/actions.ts` |
| 6.2 | Prisma: StageUpdate (one row per stage reached; skipped stages get their own rows) and photo links; stage update form with note-only option and skipped stages. Head Office can still change a running case's kind of help (CASE-9), so refuse that once a stage is recorded | STG-1, STG-2, STG-4, STG-5 | `prisma/schema.prisma`, `src/server/stages/*`, `src/components/progress/stage-update.tsx` |
| 6.3 | Photo pipeline with sharp: turn upright, resize to 1,600 px, JPEG 80, remove all metadata, store a 320 px thumbnail too | STG-3 | `src/server/files/images.ts`, `src/server/files/uploads.ts`, `src/app/files/[id]/thumb/route.ts` |
| 6.4 | Completion rule, run after every installment or stage change | CLS-1 | `src/server/cases/complete.ts` |
| 6.5 | Stop and reopen with reasons, balance shown, changes blocked while stopped. The moves are already in `transitions.ts`; the status before the stop is stored on the case for reopening | CLS-2, CLS-3 | `src/server/cases/stop.ts` |
| 6.6 | Case history in plain Sinhala sentences, from the audit log | HIS-2 | `src/server/history/*`, `src/components/progress/case-history.tsx`, `messages/si.json` |
| 6.7 | Full DS and Head Office case pages as in the prototype (two columns), photo thumbnails and viewer | STG-6, UI-7 | `src/app/ds/cases/[id]/*`, `src/app/ho/cases/[id]/*`, `src/components/progress/*`, `src/components/cases/case-view.tsx` |
| 6.8 | DS home: money panel, installments paid and stage reached in each row, and the rest of the to-do panel (due installments, 30 days without an update) | HOME-1, HOME-3, HOME-4 | `src/app/ds/page.tsx`, `src/server/cases/queries.ts` |

**Tests:** installment order through direct server calls (AC-11); skipped stages (AC-12); completion (AC-13); stop and reopen (AC-14); audit rows for every change and no updates allowed on them (AC-15); a photo with GPS data comes back without it (AC-16); e2e for a case from release to completion with a photo, and for undo, stop and reopen.

**Done when:** AC-11 to AC-16 pass.

## Phase 7 — Dashboard, exports and notifications

**Goal:** Head Office sees the national picture and everyone can take lists to Excel.

| # | Task | SPEC | Files |
| --- | --- | --- | --- |
| 7.1 | Load-test data: a script that creates 5,000 made-up cases across all districts | PRF-1 | `scripts/seed-load.ts` |
| 7.2 | Dashboard: filters, totals, district table with DS drill-down, waiting counts, stale cases | DSH-1, DSH-2 | `src/app/ho/page.tsx`, `src/server/dashboard/*` |
| 7.3 | Excel export of any list, limited to what the user may see, and logged | EXP-1, EXP-3 | `src/server/exports/*`, `src/app/ho/cases/export/route.ts`, `src/app/ds/export/route.ts` |
| 7.4 | Sheet-layout export (two tabs, original columns). Built, then removed on 2026-10-04: the Ministry no longer needs the old layout | EXP-2 | — |
| 7.5 | Notifications: the bell, the menu's queue counts and every notice, completed, stopped and reopened included, were built in Phases 5 and 6; check they stay right beside the dashboard. The menu's count and the bell are read again after every move, because a layout isn't rendered again on a client-side move | NTF-1 | `src/components/shell/*`, `src/app/ho/waiting/route.ts`, `src/app/ds/notifications/unread/route.ts` |
| 7.6 | Screens in Sinhala, Tamil and English (added 2026-10-07, PRD question 8): the language picker and its cookie, `messages/ta.json` and `en.json`, Noto Sans Tamil, money in each language; Tamil names for provinces, districts and DS offices and Tamil and English names for stages (migration `names_in_three_languages`, the admin's lists screen); queries, exports and the case history in the screen's language | UI-1, UI-3, UI-4, UI-9, LST-1, LST-2, LST-4, EXP-1, HIS-2, AC-27 | `src/i18n/*`, `messages/*.json`, `src/components/language-picker.tsx`, `src/lib/names.ts`, `prisma/schema.prisma`, `data/places.json`, `data/stages.json`, `src/server/**/queries.ts`, `src/app/admin/lists/*` |
| 7.7 | One name on each screen, typed once (added 2026-10-08): the admin's lists screen shows each office and stage in the screen's language only; its add and rename forms ask for the name in the screen's language, with the other two optional and folded away, and the system writes a blank one by sound (`transliterate`) | UI-9, LST-2, LST-3, LST-4, AC-28 | `src/lib/transliterate.ts`, `src/lib/validation/lists.ts`, `src/app/admin/lists/*`, `messages/*.json` |
| 7.8 | Replacing a beneficiary (added 2026-10-12, PRD question 7, after the prototype): a tick box on reject and stop asks the DS for another name (migration `replacing_a_beneficiary`: `case.another_name_requested`, `case.replaces_case_id`, unique, with database checks); the request in the DS to-do panel; the case form's "in place of" question, required to submit while a request is open; the link on the check view and both case pages; reopening withdraws the request and is refused once a case has taken the place | CASE-11, CHK-3, CLS-2, CLS-3, HOME-3, AC-30 | `prisma/schema.prisma`, `src/server/cases/replacements.ts`, `src/server/cases/{commands,decide,stop,queries}.ts`, `src/components/forms/case-form.tsx`, `src/components/review/decision-panel.tsx`, `src/components/progress/reason-action.tsx`, `src/components/cases/case-view.tsx`, `src/app/ds/page.tsx`, `messages/*.json` |

**Tests:** dashboard totals against direct database sums (AC-17); the exported list reopened with ExcelJS and checked (EXP-1); dashboard time with 5,000 cases (AC-21); full export under 60 seconds (PRF-4); the menu's count matching the dashboard, and the bell, after moves by the menu alone (NTF-1); the three message files having the same keys and placeholders, place names in each language, the history's names in Tamil and English, and the sign-in page, a DS officer in Tamil and Head Office's export in English in the browser (UI-9, AC-27); names written by sound from each language to the other two, every seed office's and stage's within the name rules, and an office added with one name shown in each language in the browser (UI-9, AC-28); a rejected case asked to be replaced, the link chosen on the form, a second link and a replaced stopped case's reopening refused, in the database and in the browser (CASE-11, AC-30).

**Done when:** AC-17 and AC-21 pass.

## Phase 8 — Sheet import

**Removed on 2026-10-06.** Tasks 8.1 to 8.5 were built (a made-up sample sheet, the import script and its report, the DS office filling in imported cases, and Head Office confirming them) and merged. They were then taken out of the code, because the sheet is still being updated. The database migration `20261006090000_remove_sheet_import` drops the sheet's columns, the `IMPORTED` status and the `CONFIRM_IMPORT` decision. SPEC IMP-1 to IMP-7, AC-19 and AC-24 stay unused. The work is in the git history, up to commit `9a5ce1b`, if the import is wanted again once the sheet is final. How the sheet's cases come into the system is open (see "Waiting on others").

## Phase 9 — Go-live

**Redesigned on 2026-10-09.** The system runs on one Amazon EC2 server instead of a server in Sri Lanka (PRD question 4). Officers sign in from DS offices across the country, and the Ministry has no server or database of its own for the system. The phase keeps to one server with Docker Compose, a setup script and GitHub Actions. There is no cluster and no configuration tool such as Ansible.

**Goal:** every change pushed to `main` that passes CI reaches the server by itself. The server is backed up and watched, and the offices are ready to use it.

| # | Task | SPEC | Files |
| --- | --- | --- | --- |
| 9.1 | Production images from one Dockerfile. `app` is the Next.js standalone server, run as a non-root user, with a health check. `tools` is the project with all its dependencies, for migrations, the lists seed and scripts. The build sets `APP_ENV=production`, because the security headers are fixed at build time. It also sets the commit as `NEXT_DEPLOYMENT_ID`, so a page left open across a deploy reloads instead of failing. A `/health` route answers 200 when the app reaches its database | OPS-2, OPS-3 | `docker/Dockerfile`, `.dockerignore`, `src/app/health/route.ts`, `src/server/health.ts` |
| 9.2 | The stack in Compose. `proxy` is Caddy rather than Nginx, because it gets and renews its Let's Encrypt certificate by itself. It sends HTTP to HTTPS, allows TLS 1.2 or later and request bodies up to 20 MB, and sets `X-Forwarded-For` to the real client address. Beside it run `app`, `db` (PostgreSQL 17, with no published port) and `tools`, with uploads and the database on named volumes. Two database accounts: the owner runs migrations, and the app's `diviyata_app` can't change the schema or the audit rows | SEC-1, SEC-3, SEC-4, OPS-2 | `deploy/ec2/stack/compose.yml`, `deploy/ec2/stack/caddy/Caddyfile`, `deploy/ec2/stack/scripts/db-grants.sql` |
| 9.3 | Server setup, run once on a fresh Ubuntu 24.04 server and safe to run again. It installs Docker Engine and Compose from Docker's own repository and turns on automatic security updates, with a reboot at 03:30 when one needs it. It sets the time zone to Asia/Colombo, adds a swap file, limits Docker's logs and allows SSH with keys only. It makes a `deploy` user with its own SSH key for GitHub Actions, and `/opt/diviyata` with an `.env` of generated secrets and the cron jobs | OPS-2, SEC-9 | `deploy/ec2/setup/server-setup.sh`, `deploy/ec2/setup/env.example`, `deploy/ec2/setup/cron` |
| 9.4 | Automatic deploys. `ci.yml` becomes a reusable workflow, which `deploy.yml` runs on each push to `main`. When it passes, `deploy.yml` builds both images and pushes them to GitHub's container registry, tagged with the commit. It then copies the server files over SSH and runs `deploy.sh`, which backs up the database, runs the migrations, the lists seed and the grants, swaps the app and waits for its health check. If anything fails, the previous image comes back, and the database too if a migration had run. `rollback.sh` goes back to the previous release by hand | OPS-1, OPS-3 | `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `deploy/ec2/stack/scripts/deploy.sh`, `deploy/ec2/stack/scripts/rollback.sh` |
| 9.5 | The first admin account. Sample accounts never exist outside development and tests, so a script creates an admin with a temporary password, shown once, which they change at first sign-in. Its audit record names the system as the one who acted | ADM-2, AUTH-3 | `scripts/create-admin.ts`, `deploy/ec2/stack/scripts/create-admin.sh`, `src/server/users/commands.ts` |
| 9.6 | Nightly backup of the database and the uploaded files with restic: encrypted on the server, sent to an S3 bucket and kept for 30 days. A script for a full restore, and a monthly restore test into a scratch database that runs by itself | SEC-10 | `deploy/ec2/stack/scripts/backup.sh`, `deploy/ec2/stack/scripts/restore.sh` |
| 9.7 | Alerts. Every 5 minutes the server checks its own site through HTTPS and its disk, and pings an alert service (healthchecks.io). The backup and the restore test ping it too. The service sends an email when a check fails or the pings stop | OPS-4 | `deploy/ec2/stack/scripts/monitor.sh`, `deploy/ec2/setup/cron` |
| 9.8 | Runbook: the AWS steps (instance, Elastic IP, security group, domain, S3 bucket and its role), the server setup, the GitHub settings and the first deploy. Then everyday commands, rollback, restore, moving to a new server and launch day | OPS-1–4 | `docs/RUNBOOK.md`, `README.md` |
| 9.9 | Security pass: a test calling every action with every role, headers, CSP, `npm audit`, secrets only in the server's `.env` | SEC-2–9 | `tests/security/*` |
| 9.10 | Performance and accessibility pass on the server, with load-test data, before launch | PRF-2–4, UI-6 | — |
| 9.11 | Full list of DS offices with codes loaded, and their Tamil names checked with the Ministry; the Tamil and English screen text checked by Tamil- and English-speaking officers | LST-1, UI-9 | `data/places.json`, `messages/ta.json`, `messages/en.json` |
| 9.12 | Short Sinhala guides for DS officers and Head Office, plus a user test with a few officers | — | `docs/guides/*` |
| 9.13 | Launch. The server's made-up data and its backups are removed, and `APP_ENV` becomes `production`. The first admin is created and creates the office accounts | OPS-1 | `docs/RUNBOOK.md` |

**Tests:** the `/health` route in the end-to-end tests; the first-admin script in a database test; ShellCheck on the server scripts and actionlint on the workflows, both in CI. On a local copy of the stack: a deploy, a deploy that fails its health check and rolls back (with and without a migration), and a backup with its restore. On the server: AC-22 and AC-29.

**Done when:**
- AC-20, AC-22 and AC-29 pass.
- Every other acceptance check passes again on the server, with made-up data, before launch.
- DS offices have signed in.

## Waiting on others

These don't block Phases 1–8. Each one is needed by the phase shown.

| Item | Needed by | From |
| --- | --- | --- |
| Agreement that the data may be kept on AWS, outside Sri Lanka (Personal Data Protection Act) | Phase 9, before real data goes in | Ministry |
| A domain name for the system, pointed at the server's Elastic IP | Phase 9 (a temporary address until then) | Ministry / ICTA |
| The S3 bucket for backups and the server's role, in the AWS account | Phase 9 | Whoever holds the AWS account |
| The full list of DS offices with Sinhala names | Phase 9 (sample list until then) | Ministry |
| Renovation stages (PRD question 3) | Any time; the admin adds them | Ministry |
| How the sheet's cases come into the system, now that the import is removed | Phase 9 | Ministry / Head Office |
| A mail account to send reset codes from (a Gmail account with an app password, free, or Amazon SES) for `SMTP_HOST`, and each officer's email address in their account; until then a forgotten password goes to the admin | Phase 9, before officers rely on resetting their own passwords | Ministry / admin |
| Answers to the other deferred questions | When they arrive; SPEC section 13 lists what to change | Ministry |
