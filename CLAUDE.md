# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project status

Phases 1 (foundation), 2 (sign-in and permissions), 3 (admin: accounts and lists), 4 (cases), 5 (check and release), 6 (installments, progress and closing) and 7 (dashboard, exports and notifications) of `docs/PLAN.md` are built. Phase 8 (the sheet import) was built, then removed (see below). You get:

- a Next.js shell for the three roles in Sinhala, Tamil and English (7 Oct 2026), and PostgreSQL with the place and stage lists
- sign-in with lockout and forced password change, a permission layer, an append-only audit log and security headers
- the admin's users and lists screens
- case entry with drafts, documents, the duplicate-NIC warning and case numbers
- the DS home, and Head Office's case list and case entry for any DS
- Head Office's check and release screen: verify, send back or reject, then record a district's allocation letter, which releases Rs. 2,000,000 for each case on it and makes their four installments
- notifications for the DS (a bell) and waiting counts in the Head Office menu; Head Office's corrections to verified cases and releases
- the four installments paid in order by the DS, building stages with photos, completion, stopping and reopening, and each case's history, on two-column case pages as in the prototype
- the DS home's money panel and its full to-do panel
- Head Office's dashboard, the Excel exports of the case lists, and a load-test data script
- replacing a beneficiary (12 Oct 2026): Head Office asks for another name when rejecting or stopping, and the DS office's new case is linked to the old one
- several officer accounts for one DS office (14 Oct 2026)
- resetting a forgotten password with a code sent by email (14 Oct 2026)
- tests and CI
- the server's files (Phase 9's code tasks): the two production images, the Compose stack behind Caddy, the server setup, automatic deploys from `main` with rollback, the first-admin script, backups, alerts, the runbook, the security tests and the officers' guides

Phase 7 was built one task at a time: 7.1 (the load-test data script), 7.2 (the Head Office dashboard), 7.3 (the Excel export of the case lists), 7.4 (an export in the old sheet's layout, since removed) and 7.5 (the notifications beside the dashboard).

Phase 8 (the sheet import) was built one task at a time, on the branch `phase-8-import`: 8.1 (the made-up sample sheet), 8.2 (the import script), 8.3 (the import report), 8.4 (the DS office filling in imported cases) and 8.5 (Head Office confirming them). It was removed on 6 Oct 2026, because the sheet is still being updated; see "Sheet import (removed)" below.

Phase 9 (go-live, redesigned 9 Oct 2026 for one AWS EC2 server) has its code tasks built on the branch `phase-9-go-live`: 9.1 to 9.9 and the guides of 9.12. What is left needs the server or people: the AWS account and the first deploy (runbook), the performance and accessibility pass (9.10), the full DS office list and the language checks (9.11), the user test (9.12) and launch (9.13).

The stack is set in `docs/SPEC.md`: Next.js 16 (App Router, TypeScript), PostgreSQL + Prisma 7, Better Auth, next-intl (Sinhala, Tamil and English), Zod, Tailwind 4 + shadcn/ui (Radix), ExcelJS and sharp. It runs with Docker Compose on one Amazon EC2 server, behind Caddy (Phase 9, redesigned 9 Oct 2026). Every permission check lives in the server-side data-access layer (`src/server/`), never in middleware or the UI alone.

## Commands

First run: `cp .env.example .env`, `npm install`, `npm run db:up` (needs Docker Desktop running), `npx prisma migrate dev`, `npm run db:seed`.

| Task | Command |
| --- | --- |
| Dev server (http://localhost:3000) | `npm run dev` |
| Lint, formatting, types | `npm run lint`, `npm run format:check`, `npm run typecheck` |
| No hard-coded screen text (UI-1) | `npm run check:strings` |
| Unit tests | `npm test`; one file: `npx vitest run src/lib/dates.test.ts`; one test: add `-t "<name>"` |
| Database tests (database must be up) | `npm run test:db`; one file: `npx vitest run --config vitest.db.config.mts prisma/seed.db.test.ts` |
| End-to-end tests | `npm run test:e2e`; one test: `npx playwright test tests/e2e/smoke.spec.ts -g "/ds"` |
| Production build and server | `npm run build`, then `npm run start:standalone` |
| Change the database schema | edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>` and `npx prisma generate` (Prisma 7's `migrate dev` no longer regenerates the client). When `migrate dev` stops to ask about a change (for example a new unique column), write the SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` into a new `prisma/migrations/<timestamp>_<change>/migration.sql` and apply it with `npx prisma migrate deploy` |
| Put the sample accounts back to their start state | `npx tsx prisma/seed-users.ts --reset` (the end-to-end tests do this themselves) |
| Add 5,000 made-up cases for load tests, or remove them | `npm run db:seed-load` (`-- --count 500`, `-- --seed 7`), `npm run db:seed-load -- --remove`. Remove them before running the end-to-end tests |
| Build the server's images locally | `docker build -f docker/Dockerfile --target app .` (or `--target tools`) |
| Check the server scripts and workflows (as CI does) | `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.10.0 deploy/server/server-setup.sh deploy/server/scripts/*.sh`, `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12` |
| Add demo cases (15 per DS office with an officer, with their history), or remove them | `npm run db:seed-demo` (`-- --per-office 30`, `-- --seed 7`), `npm run db:seed-demo -- --remove`. Remove them before running the end-to-end tests |

## Things to know when coding

- **Next.js 16 differs from older versions.** Read the matching guide in `node_modules/next/dist/docs/` before using an unfamiliar API (see `AGENTS.md`). For example, middleware is now `proxy.ts`.
- **Prisma 7.** The client is generated into `src/generated/prisma/`. That folder is not committed and is regenerated on `npm install`. Import from `@/generated/prisma/client`. The client needs the `PrismaPg` adapter (see `src/server/db.ts`). Settings and the seed command live in `prisma.config.ts`.
- **The seed only adds missing rows** (`prisma/seed-data.ts`), so running it again never undoes an admin's change.
- **Never run `prisma migrate reset`.** It wipes a database, and Prisma blocks it when an AI agent runs it. The database tests make a new schema in the test database for each run and drop only that schema (`tests/db/global-setup.ts`).
- **Screen text lives only in the message files:** `messages/si.json` (the source; message keys are typed from it in `src/types/next-intl.d.ts`), `ta.json` and `en.json`. `npm run check:strings` fails on text written in components, and `src/i18n/messages.test.ts` fails when the three files' keys or placeholders differ, a message doesn't format, or a file holds another language's letters. A new message goes into all three files.
- **The fonts are committed** in `src/app/fonts/`, copied from `@fontsource-variable/noto-sans-sinhala` and `noto-sans-tamil`. Nothing loads from Google at runtime.
- **The `overrides` in `package.json`** force patched `deepmerge-ts` and `mysql2` inside the Prisma CLI, and `uuid` inside ExcelJS. Remove them once Prisma and ExcelJS ship fixed versions.
- **Pinned versions.** `.npmrc` saves exact versions. Upgrade one dependency at a time, on purpose.

### Sign-in and permissions (Phase 2)

- **Every page and Server Action starts with `requireRole(...)`** or `requireSignedIn()` from `src/server/context.ts`. Put the check in each page as well as its layout, because layouts don't re-run on client-side navigation. Anything out of scope answers `notFound()`, never "forbidden" (PRM-1, ERR-2).
- **Limit case queries with `officeFilter(viewer)`** from `src/server/permissions.ts`. A DS officer sees only their own office, Head Office sees every office, and an admin sees none.
- **Every change calls `writeAudit(tx, …)`** (`src/server/audit.ts`) in the same `db.$transaction` as the change. A database trigger refuses any update or delete of `audit_log`.
- **Better Auth's HTTP endpoints are deliberately not mounted.** Sign-in, sign-out and password changes are Server Actions in `src/app/(auth)/actions.ts`. They pass through our lockout (`src/server/auth/lockout.ts`) and the per-IP rate limit.
- **The rate limit trusts `X-Forwarded-For`.** On the server, Caddy overwrites that header with the real client address (`deploy/server/caddy/Caddyfile`). The end-to-end tests give each page its own address.
- **A forgotten password (AUTH-7, 14 Oct 2026)** is reset by the officer with a code sent by email to the address in their account (`contact_email`, the account form's optional "ඊමේල්", whose hint now says so). The same morning it was a request to the admin (`app_user.new_password_asked_at`, a menu badge, "close the request"); the user replaced that with a code sent by SMS (migration `20261014150000_reset_password_by_sms` drops the column), then that afternoon with email, because SMS costs money for each message and email can be free. Don't bring the request or SMS back unless asked.
  - `/forgot-password` is three steps in one client component (`forgot-password-form.tsx`), each a Server Action in `src/app/(auth)/actions.ts`: `askForCode` (username), `checkCode` (the six digits), `setNewPassword` (AUTH-3's rules via `checkChosenPassword`), which redirects to `/login?notice=passwordReset`. The state lives only in the page, so leaving it starts again.
  - The logic is `src/server/auth/password-reset.ts`. Every username gets a random ticket (the browser holds it in the action state; `password_reset_code.id` is its SHA-256, and the code is an HMAC keyed by `BETTER_AUTH_SECRET`). Only an active account with an email address and fewer than 5 codes in 24 hours gets an email and a ticket with a user; any other ticket has none, so the page reads the same for any username. A new code ends the earlier ones; 5 wrong tries end a code; a code lasts 15 minutes for both steps. Setting the password clears a lock, ends the sessions, uses up the account's codes, and writes `password_reset_by_code` (the officer as actor); a code sent writes `reset_code_sent` (no actor; the history says "the sign-in page"). Only a failed email is refused (`emailFailed`).
  - **Email** goes through `sendMail` (`src/server/mail.ts`, nodemailer over SMTP) in the screen's language. `resetCodeEmail` (`src/server/auth/reset-email.ts`, 15 Oct 2026, the user's request for a friendlier email) builds it from `forgotPassword.email` and `app`: an HTML part (inline styles and tables, since mail apps drop `<style>`; a green header, the code in a large box with the account's username, the 15 minutes, a "tell no one" box and a "sent automatically" footer) and the same words as plain text, with the code before the username so `lastCodeSentTo` finds it first. On a server, `SMTP_HOST`, `SMTP_PORT` (465, TLS from the start, by default; any other port must STARTTLS), `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` (default `SMTP_USER`) are in the server's `.env` (RUNBOOK, "Email for forgotten passwords": a Gmail account with an app password, Amazon SES or Brevo); with no `SMTP_HOST`, the page says resetting isn't on and sends officers to the admin. Setting `SMTP_HOST` in a developer's own `.env` sends real emails there too. In development and CI (`APP_ENV` development, ci or test) without it, emails are written to `MAIL_OUTBOX` (default `data/mail-outbox.jsonl`, git-ignored) instead, and printed in the dev server's terminal; `playwright.config.ts` sets the file and `lastCodeSentTo(email)` (`tests/e2e/helpers.ts`) reads the code, so an e2e test gives its officer an address of its own. Never log the address, the text or the password (SEC-8, SEC-9): `logError` logs nodemailer's error code (`EAUTH`, `ECONNECTION`) only.
  - The Sinhala and Tamil screens say "ඊමේල්" and "மின்னஞ்சல்", not "email", because no Latin letters are allowed on them (the smoke test checks both steps).
  - Limits (SEC-4): `resetCodeLimiter` (5 per 15 minutes per IP), `CODES_PER_DAY`, `CODE_TRIES`, `CODE_MINUTES`. The admin's temporary password (ADM-5) stays for an officer with no email address or who gets no email.
- **The session ends after 30 minutes idle or 12 hours in total.** The idle time is our `session.last_active_at`, checked in `getContext()`.
- **`src/proxy.ts` has only two jobs:** a quick redirect of signed-out visitors, and a fresh CSP nonce on every page. Because of the nonce, the root layout makes every page render per request.
- **Sample accounts** exist in development and tests only, never in staging or production:
  - `ds0101` (Homagama) and `ds0103` (Kaduwela)
  - `ds0102` (Maharagama; has a temporary password)
  - `ds0199` (Kesbewa; kept for the lockout test)
  - `ho0001` and `ad0001`

  The password is `Sample-Pass-2026`, and the temporary one is `Temp-Pass-2026` (`prisma/seed-users.ts`).
- **Raw SQL doesn't get the `?schema=` from the URL.** Name the schema in the query, or rely on the default `public`.

### Admin screens (Phase 3)

- **The pattern for a feature:**
  - The Zod schema goes in `src/lib/validation/`. Its error messages are message keys, not text.
  - Queries and commands go in `src/server/<area>/`. They take `db` as their first argument, so the database tests can pass a test client.
  - Commands return `{ ok: true, … }` or `{ ok: false, error: "<message key>" }` and write the audit record in the same transaction.
  - Server Actions (`actions.ts` beside the page) call `requireRole`, parse the form, call the command and `revalidatePath`.
- **Forms keep what was typed.** React 19 resets uncontrolled fields after an action, so forms that can be refused use controlled fields (`account-form.tsx`, `list-forms.tsx`).
- **A temporary password is shown once.** It comes back in the action's state and is never stored in plain text or put in a URL. Remounting the component (`key`) clears it.
- **Usernames are generated** as `ds`/`ho`/`ad` plus four digits (`src/server/users/usernames.ts`), and accounts have a placeholder email. Accounts, offices and stages are never deleted, only disabled or deactivated (ADM-7, LST-3).
- **A DS office can have several active DS officers (ADM-3, 14 Oct 2026).** The screens call the `DS_OFFICER` role Divisional Secretariat Officer (ප්‍රාදේශීය ලේකම් කාර්යාල නිලධාරී), in Tamil பிரதேச செயலக உத்தியோகத்தர். Until 14 Oct it was Child Rights Promotion Officer (ළමා හිමිකම් ප්‍රවර්ධන නිලධාරී); the user renamed it because an office's officers are not all Child Rights Promotion Officers.
  - From 29 Sep to 14 Oct an office had at most one, with an `officeTaken` refusal and a partial unique index; migration `20261014090000_several_officers_per_office` dropped the index. Don't bring the limit back unless asked.
  - Cases are scoped by office, never by who entered them, so the office's officers share them; `notifyOffice` tells every active officer.
  - The account form shows each office by name only, no officers' names (`officeChoices`; the user's choice, 14 Oct). The lists screen names every active officer (`officesOfDistrict`).
  - `banned` is never null, so "active" is simply `banned: false`.
- **Every user's profile is a pop-up (15 Oct 2026, the user's request):** the name in the header is a button that opens `ProfileDialog` (`src/app/_profile/`, a private folder, so not a route, but still under the security test's `src/app/**/actions.ts`). `AppShell` reads the profile with `getContext()` and `getProfile` on each render. It was first built as `/ds/profile`, `/ho/profile` and `/admin/profile` pages; the user asked for a pop-up instead the same day. It shows the username, role, district and DS office read-only and lets the officer change their own name, designation, mobile and email (`profileSchema`/`parseProfileForm`, sharing the account form's field rules; `updateProfile` in `src/server/users/commands.ts`, logged as `account_updated` with the officer as the actor, so the admin's account history shows it). `updateProfileAction` uses `requireSignedIn()` and revalidates the root layout, because the header shows the name.
- **Database test files share one schema per run** and run one after another. A test must not assume it sees only its own rows, and must put back anything shared that it changes. A test that adds a DS officer and wants the office's cases and notices to itself takes a free office from `freeOfficeId()` (`tests/db/client.ts`).
- **End-to-end tests add data.** `tests/e2e/cleanup.ts` runs before each run:
  - It removes the offices and stages the tests added, which carry `TEST_MARKER`.
  - It deletes the officer accounts they created in the Gampaha offices, named "ඊ. පරීක්ෂණ" (AC-23 gives Wattala two). This is the one exception to ADM-7, for test accounts only. Their audit records stay, with an actor id that no longer exists (`audit_log.actor_id` has no foreign key). An account that still holds case records is only disabled.

### Cases (Phase 4)

- **Every change to a case goes through `saveCase`** (`src/server/cases/commands.ts`). One transaction saves the fields, attaches new uploads and writes the audit record. On submit, the same transaction takes the case number and records the `SUBMIT` decision.
- **Who may change what** is in `src/server/cases/rules.ts`: the office while `DRAFT` or `RETURNED`, Head Office also while `VERIFIED` or `IN_PROGRESS` (CASE-9), and only Head Office moves a draft to another office. Status changes are in `transitions.ts` (Phase 5).
- **A new case's id is made when its form page renders**, so a form sent twice finds the saved case and changes nothing (ERR-8). Every later save sends the `version` it opened with; a stale one is refused with `conflict` (CASE-10, ERR-3).
- **Case numbers come from `case_number_counter`.** The row for an office and year stays locked until the submit commits, so parallel submits take turns. Two first submits of a year can still meet on its insert; `saveCase` tries again.
- **Uploads are one Server Action request per file**, sent as soon as it is chosen (at most 10 MB). The file row's `case_id` stays empty until the case form is saved, which attaches only the actor's own unattached uploads. An upload never saved with a case is removed after a day.
- **Body limits are 16 MB** (`serverActions.bodySizeLimit` and `proxyClientMaxBodySize` in `next.config.ts`), for photos of up to 15 MB (Phase 6). Above its limit the proxy silently cuts a request body short. Caddy on the server allows 20 MB (`request_body` in `deploy/server/caddy/Caddyfile`).
- **Files live under `FILES_DIR`** (default `data/files`, which git ignores), named by a random UUID in two-character sub-folders. `/files/[id]` applies the case's office rules. The proxy leaves its CSP off `/files/` responses, because the page policy (`object-src 'none'`) could stop the browser's PDF viewer.
- **One case form for both roles.** `src/components/forms/case-form.tsx` builds its own `FormData` instead of using `<form action>`, so typed values and chosen files survive a refused save. Each role's `actions.ts` checks its own role, then calls `src/server/cases/form-actions.ts`.
- **Client components may import types from `src/server/`**, never values.
- **Test data:** database tests point `FILES_DIR` at a temporary folder. End-to-end test cases have names starting with `TEST_CASE_NAME` ("ස්වයං පරීක්ෂණ"), and `tests/e2e/cleanup.ts` deletes them with their decisions and files before each run.

### Check and release (Phase 5)

- **Every status change goes through `applyMove`** (`src/server/cases/transitions.ts`). Its `MOVES` table is SPEC section 6, row by row: who may make each move, from and to which statuses, whether it needs a reason, its Decision type, its audit action and its notice.
  - It updates the case only while it still has the status the caller read (and the version, with `checkVersion`), so two people deciding at once can't both succeed.
  - It writes the Decision, the audit record and the notifications in the caller's transaction. It throws a `Refusal` (`refusal.ts`) that rolls everything back.
  - Commands call `moveRefusal` first to answer early with `roleNotAllowed` or `notAllowedNow`. `saveCase`'s submit uses `applyMove` too.
- **Head Office's check and release screen** is one screen with two tabs, `/ho/check` and `/ho/release` (`src/app/ho/check/review-screen.tsx`: `ReviewFrame`, `CheckTab`, `LetterTab`). On the check tab the chosen case is `?case=<id>`.
  - After a decision the page goes back to the queue with `?notice=<key>&done=<id>`, or, from the case page (`from=case`), to `/ho/cases/<id>?notice=<key>`. URLs carry ids, never names (SEC-8).
  - The decision form (`src/components/review/decision-panel.tsx`) is on both the queue screen and the case page, keyed by the case's version, so it resets after a change.
  - **Both queues can be narrowed to a district, then a DS office (CHK-4, 6 Oct 2026).** The place is `?districtId=&dsOfficeId=` (`readPlace`, `placeQuery` in `src/app/ho/check/place.ts`). Paging, the tabs and the decision form keep it: the form sends it with the decision, and `goOn` puts it after `notice` and `done`. The release tab reads only `districtId`, to open that district's letter. `placeChoices` (pure) offers only places with cases waiting, counted by `queueByOffice`, plus the chosen place; a chosen office brings its own district. `PlacePicker` is two selects whose options are the queue's own addresses, so choosing one opens it. The tab counts and the menu stay national.
- **Release by district allocation letter (REL-1 to REL-4, 6 Oct 2026).** Head Office sends one letter (ප්‍රතිපාදන ලිපිය) to a District Secretary for several verified cases of the district; the screens follow the prototype's option A.
  - `release_letter` holds the district, number, date, valid-until day and note; each case keeps its own `release` row with `letter_id`, and `release.released_on` is a copy of the letter's date, which the installment and stage date rules read. The migration `20261006130100_release_letter` turned each older release into a letter of its own (same id, valid until 31 Dec of its year) and dropped `release.reference_number` and `note`. Older `case_released` audit rows name a reference number; `case-history.tsx` still reads them.
  - `recordLetter` (`src/server/releases/commands.ts`) takes the district, the ticked cases with the versions the form showed, the form and an optional scan id. In one transaction it saves the letter, attaches the scan, and for each case (in id order) runs the `release` move, saves its release and makes its four installments, then writes a `letter_recorded` audit row (no case). Any refusal rolls back the whole letter. The date rules need every case's verification, so the command checks the form itself (`latestDay`).
  - `correctRelease` corrects the letter from one case's page: it bumps every case on the letter (refusing a changed one), updates the letter and, for a new date, every release's `released_on`, and logs `release_corrected` on each case.
  - Queries (`src/server/releases/queries.ts`): `districtsWaiting`, `casesForLetter`, `recentLetters`, `getLetter`; Head Office only. `getCase`'s release carries `letter` (with the case count, the latest verification of its cases, and the scan id).
  - The letter form (`src/components/review/letter-form.tsx`, with `letter-fields.tsx` shared by the correction pop-up) is keyed by the district and its cases' ids and versions. After a save the page goes to `/ho/release?notice=letterRecorded&letter=<id>&districtId=<id>`.
  - **The scan** is a `File` of kind `LETTER` (`uploadLetterScan`, Head Office only) linked by `file.letter_id`. Database checks: only a scan has a letter, and a scan never has a case. `fileForViewer` lets anyone open it who may see one of the letter's cases. `removeUnusedUploads` skips files with a letter.
  - Database checks (hand-written in the `release` migration) hold the amounts at 2,000,000 and 500,000 and installment numbers at 1 to 4; `release_letter_valid_from_its_date` holds valid-until on or after the date.
  - `listQueue(…, "release")` is no longer used by a screen; `queueCounts` still counts `VERIFIED` cases for the tab and the menu.
  - The load-test data gives one letter per district and release day (ids start with `load-`); `--remove` and the e2e cleanup delete letters left with no release, with their scans. The e2e helper `recordLetterFor` unticks every other case before saving, because other tests' cases wait in the same district.
- **Date-only columns** (`@db.Date`): store a day with `dayToDate`, read it with `dateToDay`, and compare days as `"YYYY-MM-DD"` strings. Today is `colomboDay(new Date())`.
- **Notifications** are made by `notifyOffice` inside the move's transaction, for the office's active officers only. Lists and the bell show only cases the officer may still see (PRM-3).
  - Head Office's menu counts come from `src/app/ho/layout.tsx`, and the bell's from `src/app/ds/layout.tsx`. A layout doesn't render again on client-side moves, so actions that change a queue call `revalidatePath("/ho", "layout")`, and the actions on notifications `revalidatePath("/ds", "layout")`.
  - Someone else's change doesn't refresh the layout, so the menu's badge and the bell read their count again after every move (`useLiveCount`, `src/components/shell/live-count.ts`, Phase 7) from `/ho/waiting` or `/ds/notifications/unread`. Each reading carries the server time it was read (`waitingNow`, `unreadNow`), and the newer one is shown. A refreshed layout's 0 then wins over an earlier read's 1 after "mark all read".
- **Edits after verification (CASE-9)** reuse `saveCase` and the case form in `mode="change"`: one save button, every required field checked (`mustStayComplete`), no submit. The changed fields are logged as `case_updated` with old and new values.
- **Test helpers:** e2e case entry is in `tests/e2e/case-helpers.ts` (`openAs` keeps a second person's window open). `cleanup.ts` also deletes test cases' notifications, installments and releases. The database tests' config skips `.next/`, where a standalone build copies the test files.

### Installments, progress and closing (Phase 6)

- **Every installment or stage change claims the case first** with `claimCase` (`src/server/cases/claim.ts`): the version goes up only while it is still the one the page showed and the case is `IN_PROGRESS`, inside the change's transaction. That gives CASE-10 and ERR-8 for free, and moves `case.updatedAt`, which is what "no update for 30 days" reads (`STALE_DAYS` in `src/server/cases/queries.ts`).
- **The installment order is pure code** in `src/server/installments/rules.ts` (`nextInstallment`, `stepRefusal`, `lastPaid`). The commands (`src/server/installments/commands.ts`) and the DS case page both use it. Only the DS office starts and pays; Head Office only undoes the last payment (INS-6).
- **Stage updates are one row per stage reached** (`stage_update`, unique per case and stage). Choosing a stage further ahead also writes a row for each stage it skips, on the same day; a note-only visit has no stage. The chosen row holds the note and photos. The progress view (`stageProgress` in `src/server/stages/queries.ts`) is pure: the current stage is the highest one reached, and the choices are the active stages after it. A used stage can't be deleted (a restricting foreign key), only deactivated.
- **Completion runs inside the change's transaction** (`completeIfDone` in `src/server/cases/complete.ts`) after a payment or a stage reached. The system makes the move, so its audit record has no actor and the history says "the system".
- **Stopping stores `status_before_stop`** on the case; reopening goes back to it (`src/server/cases/stop.ts`). A database check allows it only on a stopped case.
- **Files have a kind**, `DOCUMENT` or `PHOTO`. Every document query (the case's list, the 10-document limit, removing one) filters on `DOCUMENT`, and a photo also carries its `stage_update_id`.
  - `uploadPhoto` (`src/server/files/uploads.ts`) runs `processPhoto` (`src/server/files/images.ts`, sharp) before anything is stored: upright, at most 1,600 px, JPEG 80, no metadata, plus a 320 px thumbnail kept under `thumb_name` and served by `/files/[id]/thumb`.
  - Thumbnails are plain `<img>` tags, because the files are protected and can't go through Next's image optimizer.
- **The history** (`caseHistory` in `src/server/history/queries.ts`) reads the audit log; `src/components/progress/case-history.tsx` turns each action into a sentence in the screen's language. A new audit action needs a sentence there and under `history.actions` in all three message files, or it shows as "a change was made".
- **Case pages** use `CaseColumns` (`src/components/cases/case-view.tsx`): money, decisions and history on the left; stages and details on the right; one column below 1,280 px. The pop-ups for installments, stages, stopping, reopening and undoing are in `src/components/progress/`; `ReasonAction` is the shared "give a reason" pop-up. `Modal` takes a `size` and sets `text-left`, because some pop-ups live in right-aligned table cells.
- **Test helpers:** `releasedCase` (`tests/e2e/case-helpers.ts`) gives a case released today. E2E tests read the stage names from the form, because the admin may rename or reorder stages. The development database's new-house stages have been reordered by hand. `cleanup.ts` also deletes test cases' stage updates and photo thumbnails.

### Dashboard and exports (Phase 7)

- **Load-test data** (`scripts/seed-load.ts`, PRF-1) makes made-up cases at every status in every active DS office: drafts, queues, cases being built (a quarter with no update for 30 days or more), completed, rejected and stopped. It runs on development, CI, test and staging databases, never in production. The same `--seed` gives the same cases.
  - The cases' ids start with `load-`, which is how `--remove` finds them. They belong to the disabled account `load-test-account`, which has no username, so it can't sign in and isn't on the admin's users screen.
  - It writes no audit records, because those can never be removed (HIS-3), and no notifications, files or photos. A load-test case's history is empty.
  - Case numbers are taken in one block per office and year from `case_number_counter`. `--remove` puts each counter back where it stood before, unless a later case holds a higher number.
  - `addLoadData(db, { count, seed, now })` and `removeLoadData(db)` are exported for the database tests.
  - `addLoadData` ends with a plain `ANALYZE`. Until autoanalyze notices 5,000 new cases, the planner may still think the tables are as small as before, which made the dashboard's reads about 20 times slower and the database tests time out now and then.
  - **Remove it before the end-to-end tests.** The check queue lists 50 per page, oldest first (CHK-1), and the release test expects its new case on the first page. While load-test cases use a test office or stage that an end-to-end run left behind, `cleanup.ts` leaves that office or stage in place. It is removed on the first run after the load-test cases are gone.
- **Demo data** (`scripts/seed-demo.ts`, 7 Oct 2026, asked for by the user to fill the screens) reuses the load-test planner: `planCase`, `writePlanned` and `removeMadeUp` in `scripts/seed-load.ts`, which differ by a `Cast` (id prefix, who acts, the made-up person, case ages, release days).
  - It adds 15 cases (every status) to each active DS office that has an active officer and no demo cases yet, so running it again only fills offices whose officer was added since. Ids start with `demo-`.
  - Each step is credited to the office's first officer (the oldest active account) or a random active Head Office officer, and written to the audit log as the commands write it, so the case pages' history reads normally; every active officer of the office gets the notices (`Cast.officers`), read except the last 7 days'. Each district's letter goes out every 14 days, so letters hold several cases.
  - People look like hand-entered cases: a mother (or father) and child, or a young care leaver, with an address "අංක N, <road>, <village>, <district>" and a GN division. No documents or photos.
  - `--remove` deletes the cases, their notices and letters and puts the counters back, but their audit records stay (HIS-3); nothing shows them once the case is gone. Its database test is `scripts/seed-demo.db.test.ts`.
- **The dashboard** (`/ho`, DSH-1) is built from `dashboard()` in `src/server/dashboard/queries.ts`: the totals, each DS office's figures and the stale cases.
  - `tableRows()` is pure. It groups the office figures by district, or lists a chosen district's offices.
  - The figures are read on every load (DSH-2); the page renders per request anyway.
  - The filters (`districtId`, `category`, `kind`) are in the address. They narrow every figure except the waiting counts, which come from `queueCounts`, as in the menu.
  - Prisma can't sum a related table by office, and raw SQL would miss the schema the tests and CI's end-to-end run use. So the money figures come from one row per case with a release. With 5,000 cases the reads take about 65 ms, and the page about 0.3 s.
  - "No update for 30 days" is `staleBefore(now)` in `src/server/cases/queries.ts`, shared with the DS to-do panel.
  - Its database test (AC-17, AC-21) adds 5,000 load-test cases and removes them again, which takes about 20 seconds.
- **A filter form on a page whose links change only its address needs a `key` made from the filter values.** Otherwise the uncontrolled fields keep their old choices after a client-side move, such as "clear filters". The dashboard and the Head Office case list both do this.
- **The Excel exports** (EXP-1, EXP-3) are route handlers that answer with a file: `/ho/cases/export` and `/ds/export`. Each list links to its own with `ExportLink` (`src/components/cases/export-link.tsx`), a plain `<a download>`, not `<Link>`.
  - Each route reads the address with its list page's own reader, `readFilters` (`src/app/ho/cases/filters.ts`) or `readHomeList` (`src/app/ds/list.ts`), and the query uses `caseWhere` from `src/server/cases/queries.ts`. So the file holds exactly the screen's cases, every page of them.
  - `exportCaseList` (`src/server/exports/case-list.ts`) builds the file and writes a `cases_exported` audit record (entity `case_list`, id `ho_cases` or `ds_cases`) with the filters used and the number of rows. It answers null for an admin.
  - ExcelJS is a `serverExternalPackages` entry in `next.config.ts`: Node loads it from `node_modules`. Compiling it in the dev server held up the other pages, and the end-to-end tests timed out.
  - `src/server/exports/workbook.ts` holds the shared parts: `addSheet` (a bold header row that stays in view, filter buttons, days as real dates shown `yyyy.mm.dd`, amounts as `#,##0`, text kept as text) and `xlsxResponse`.
  - **The progress-report columns (6 Oct 2026).** The file has Head Office's monthly progress report's two groups: four installment columns right after "ප්‍රා.ලේ. කාර්යාලයට නිදහස් කළ මුදල" (in place of "ගෙවූ වාරික ගණන", removed at the user's request), and four building columns right after "ප්‍රා.ලේ. කාර්යාලය සතුව ඉතිරි" (in place of "ළඟා වූ මට්ටම", also removed at the user's request; the DS home's own stage name in `src/server/cases/queries.ts` is separate and stays). The other case-list columns keep their order and headers. Each group cell is a short dated note as the old sheet had ("<date> දින ගෙවා ඇත", "<date> දින ගෙවීමට අපේක්ෂිතයි", "<date> දින නිම කර ඇත"; `export.progress` in `si.json`), so they are text, not Excel dates. A column with a `group` makes `addSheet` write two header rows: the group merged across its columns, every other header merged down both rows, and the filter buttons on row 2. So data starts on row 3. `progressStages` picks each building column's stage: the last column is always the kind's last active stage, and the others take its first stages. The headers are the report's own words (`export.progress` in `si.json`), not the stage names, which the admin may change.
  - Server code gets its labels from `getTranslations("cases")` and the language from `getLocale()`. Tests make the same translator with `createTranslator({ locale: "si", messages, namespace: "cases" })`.
  - **File names avoid zero-width joiners.** Chrome saves one in a download's name as `_` (ප්‍ර becomes ප්_ර), so the file is "දිවියට සවියක් ලැයිස්තුව <date>.xlsx". A unit test checks it.
  - The button says එක්සෙල් (Tamil எக்செல்), not "Excel", because the smoke test allows no Latin letters on the Sinhala and Tamil `/ds` and `/ho` (AC-20).
  - With 5,000 cases the whole export takes about 3 seconds (PRF-4 allows 60). Its database test adds 5,000 load-test cases too.
- **There is no export in the old sheet's layout.** Task 7.4 built one (EXP-2), and it was removed on 2026-10-04 because the Ministry no longer needs it. Don't add it back unless asked.

### Languages (7 Oct 2026)

- **Three screen languages (UI-9):** Sinhala (the default), Tamil and English, the answer to PRD question 8.
  - The language is a cookie, `lang` (`src/i18n/locales.ts`), read by `src/i18n/request.ts`. Addresses carry no language. The picker (`src/components/language-picker.tsx`) is in the header and on the sign-in and password pages; it calls `chooseLanguage` (`src/i18n/actions.ts`), which sets the cookie and refreshes the layouts.
  - Server code gets the language with `getLocale()` from `next-intl/server`, client code with `useLocale()`.
  - Money: `formatRupees(amount, locale)` writes රු., ரூ. or Rs.
- **Places and stages have three names:** `name_si`, `name_ta` and `name_en` on province, district, DS office and stage (migration `20261007090000_names_in_three_languages`, which filled the Tamil and English names from `data/places.json` and `data/stages.json`).
  - Queries that show a name take the `locale` as an argument and pick it with `localName(row, locale)`, selecting all three with `NAMES` (`src/lib/names.ts`). Database tests pass `"si"`.
  - **A screen shows a name once, in its own language (8 Oct 2026).** Don't list the three names side by side; only the language picker names all three languages, and the ministry's letterhead (`MinistryBar`, `src/components/brand/ministry-bar.tsx`, 15 Oct 2026, the user's request) across the top of the sign-in pages: the national emblem (`public/emblem-of-sri-lanka.svg`, public domain, from Wikimedia Commons) and the ministry's name in Sinhala, Tamil and English, as on its website. It reads each name with `getTranslations({ locale })`, which `src/i18n/request.ts` honours over the cookie, and marks each with its own `lang`.
  - **The admin types a name once (8 Oct 2026).** The lists screen's add and rename forms (`list-forms.tsx`) ask for the name in the screen's language; the other two are optional, folded away in a `<details>` ("අනෙක් භාෂාවලින් නම"), and the form sends its own language as `from`. `readNames` (`src/lib/validation/lists.ts`) checks what was typed, then writes each blank name with `transliterate` (`src/lib/transliterate.ts`) and checks it by the same rules; one that fails (digits, say) comes back as `writeName` for the admin to type. A save that wrote a name says so ("addedWritten").
  - `transliterate(text, to)` writes by sound, not meaning: each run of Sinhala, Tamil or Latin letters is read into sounds and written in the wanted letters, and a run already in them is kept. It follows the places' own spellings (ව → w, ත → th, ඊ → ee from Sinhala; ட → d, intervocalic ச → s from Tamil), so it gets most seeded names right (හෝමාගම → ஹோமாகம, Homagama) but not names known by another form (කොළඹ → Kolamba). English words come out poorly in Sinhala and Tamil letters. A unit test runs every seed office and stage through it.
  - The Tamil name must be in Tamil letters and the English one in English letters; the Sinhala name has no letter rule.
  - The Tamil place names were written for development; task 9.7 checks them with the Ministry.
- **What officers type stays as typed:** names, addresses, notes and reasons are never translated.
- **The case history** reads districts from the release's letter, and stage names from `stageNames` (all three names, written since 7 Oct 2026). An older stage record holds only Sinhala names: the Sinhala screen keeps them, the others read the stages' current names (`src/server/history/queries.ts`).
- **Exports** take the screen's translator and `locale`, so the headers, statuses, place names and file name come in that language.
- **The root error page** (`global-error.tsx`) shows Sinhala at once and loads the chosen language's messages from the cookie.
- **End-to-end tests:** `screenText` leaves out text marked with another `lang`, such as the picker's names. `chooseLanguage(page, "தமிழ்")` in `tests/e2e/helpers.ts` switches a page's language; `tests/e2e/languages.spec.ts` covers AC-27.
- **Lengths:** Tamil labels run longer than Sinhala ones. The header keeps the name, office and buttons on one line; the dashboard's table scrolls rather than being cut off.

### Replacing a beneficiary (CASE-11, 12 Oct 2026)

- **PRD question 7, settled after the prototype:** the new person is always a new case, linked to the old one; never an edit. Task 7.8 in the PLAN. Still open with the Ministry: replacing a case that already received money.
- **Two columns on `case`** (migration `20261012090000_replacing_a_beneficiary`): `another_name_requested`, set when Head Office rejects (`decideCase`'s `askAnotherName`) or stops (`stopCase`'s `askAnotherName`) and ticks "ask for another name"; and `replaces_case_id` (unique, `ON DELETE SET NULL`) on the new case. Hand-written checks: the flag only on a `REJECTED` or `STOPPED` case, and never a case replacing itself. Reopening clears the flag (audit `anotherNameWithdrawn`) and answers `replaced` once a case has taken the place.
- **`src/server/cases/replacements.ts`** holds `openRequests` (the office's cases waiting for another name; `forCaseId` keeps the one a case already replaces), `replacementRefusal` and `REQUEST_SELECT`/`toRequest`, which `getCase` reuses for `replaces`; `getCase` also gives `anotherNameRequested` and `replacedBy`. The to-do panel lists requests first (`type: "replace"`), and the check queue's cards say "<number> වෙනුවට" (`QueueRow.replacesNumber`).
- **The form's answer** travels as `replaces`: absent when the form didn't ask (keep the link), `""` unanswered (refused on submit with `replacementRequired`, kept on a draft save), `"none"` (no link), or the old case's id. `saveCase` checks the target (same office, waiting, not taken: `replacementUnavailable`) and, in the transaction, claims it with `claimReplaced`, which moves the old case's version on, so a reopening at the same moment fails as a conflict. A verified case keeps its link whatever is sent. "No" isn't stored, so the form asks again on a case with no link.
- **Screens:** the reject tick box is in `DecisionPanel`; the stop one is `ReasonAction`'s `ask` prop (the pop-up is then `wide`). The form's question is the unnumbered `#part-replaces` above part 1, fed by `replacementOptions` (`page-header.tsx`) on the four form pages; Head Office's choosing form filters it by the office chosen. `ReplacementNotes` (`case-view.tsx`) shows the link on both case pages and the check view.
- **End-to-end tests:** while one test's request is open, other tests' forms for the same office ask the question, so `fillCase` answers "no" whenever it shows (`NOT_A_REPLACEMENT`). `tests/e2e/replacement.spec.ts` (AC-30) uses Homagama, because the notifications test counts Kaduwela's notices exactly.

### The server (Phase 9)

- **`docs/RUNBOOK.md` is the operator's manual**: the AWS steps, the server setup, GitHub's settings, everyday commands, rollback, restore, moving servers and launch day. Keep it in step with the scripts.
- **One Dockerfile, two images** (`docker/Dockerfile`): `app` is the standalone server, run as `node`, with a `HEALTHCHECK` on `/health`; `tools` is the whole project for migrations, the lists seed and the scripts. The build sets `APP_ENV=production`, because `next.config.ts` fixes the headers (HSTS) at build time, and `NEXT_DEPLOYMENT_ID` to the commit, so an open page reloads after a deploy (AC-29). Build-only placeholders let the server code load; the real secrets come from the server's `.env`. OpenSSL is installed before `npm ci`, because Prisma picks its migration engine by the OpenSSL it finds and can't fetch another as `node`. `outputFileTracingExcludes` in `next.config.ts` keeps tests, scripts and notes out of the standalone output.
- **`/health`** (`src/app/health/route.ts`, `src/server/health.ts`) answers `{ ok }` with 200 or 503 and nothing else. It is public, like the sign-in page.
- **The stack** is `deploy/server/compose.yml` (project name `diviyata`): Caddy (`deploy/server/caddy/Caddyfile`: certificate, HTTP to HTTPS, TLS 1.2+, 20 MB bodies, `X-Forwarded-For` overwritten, a maintenance page while the app is down), the app, PostgreSQL with no published port, and `tools` under a profile. Images are pinned; a new version is a pull request.
- **Two database accounts (SEC-3).** The owner `diviyata` runs migrations, the seed and `deploy/server/scripts/db-grants.sql`; the app connects as `diviyata_app`, which may only read and write rows, add audit rows, and not read `_prisma_migrations`. The grants run on every deploy, so a new table is covered. If the app ever needs another privilege (a raw `TRUNCATE`, say), add it there.
- **Server scripts** are bash in `deploy/server/scripts/`, sharing `lib.sh` (`compose`, `db_dump`, `db_restore`, `ping_alert`). They must pass ShellCheck (`.shellcheckrc`) and keep LF line endings. `deploy.sh` stops the app only when the release brings migrations, and on failure puts back the release files, the database (if a migration ran) and the previous app. `load_env` exports `.env` but only reads `release.env`: an exported `APP_IMAGE` would beat the env files, and Compose would keep the old app (found by the local test). On 11 Oct 2026 the scripts were run against Docker Desktop with a stand-in server container (not kept in the repo): a first deploy, a deploy with a migration, a failed deploy with and without a migration, a rollback, a backup, the restore test, a full restore and the monitor all passed.
- **`deploy/` is laid out by where things run (11 Oct 2026):** `deploy/server/` holds everything that lives on the server (`server-setup.sh`, `compose.yml`, `caddy/`, `cron`, `env.example`, `scripts/`; `deploy.yml` copies `compose.yml`, `caddy/` and `scripts/` to `/opt/diviyata`, whose own layout is unchanged), and `deploy/ops/` holds `deploy/ops.sh`'s parts, which run on the operator's computer. `deploy/settings.example.env` sits at the top, beside `ops.sh`.
- **`deploy/ops.sh` is the operator's one command** (11 Oct 2026), run on their own computer in Git Bash; `deploy/README.md` is its guide, written for someone new to the project (the user hands the project over), so keep it in step with any change to the commands or server scripts. It reaches the server over SSH and GitHub with `gh`, reading `deploy/settings.env` (git ignores it). Its parts are in `deploy/ops/`: `setup.sh` (RUNBOOK steps 2 to 6: healthchecks.io's checks through its API, `server-setup.sh` over SSH, the repository variable `DEPLOY_HOST` (a repository variable, because `deploy.yml`'s job-level `if` can't see an environment's variables), the environment's secrets, branch protection and workflow permissions, the first deploy, a backup and the admin), `launch.sh` (9.13), `create-admin.sh` and `lib.sh`. The other commands (status, logs, deploy, ssh, rollback, backup, backups, restore-test, restore, test-data) wrap the server scripts. ShellCheck covers them in CI. `server-setup.sh` takes `--hc-monitor`, `--hc-backup`, `--hc-restore` and `--quiet` for them.
- **`ci.yml` is reusable**: pushes to `main` run it through `deploy.yml`, which deploys only when it passes, and only once `DEPLOY_HOST` is set. Its `server-files` job runs ShellCheck, actionlint, `compose config` and `caddy validate`.
- **The first admin** comes from `scripts/create-admin.ts` (`deploy/server/scripts/create-admin.sh` on the server): `createAccount` with a null actor, so the history says the system made it. It refuses while an active admin exists, unless `--another`.
- **Security tests (9.9)** are in `tests/security/`: `access.test.ts` calls every Server Action and route handler as every kind of visitor, with the real `requireRole` and a made-up session, and fails when a new action or route has no rule in its `RULES`; `secrets.test.ts` scans tracked files; `headers.spec.ts` (Playwright, which now also runs `tests/security/*.spec.ts`) reads the headers of the running app.
- **The officers' guides** are Sinhala Markdown in `docs/guides/`, quoting the screens' own labels from `messages/si.json`. Update them when a label they quote changes.

### Sheet import (removed)

- **Phase 8's import was taken out on 6 Oct 2026**, while the sheet is still being updated: the sample sheet and import scripts, `src/server/import/`, the DS office's fill-in page and "details missing" tab, Head Office's `/ho/imported` screen and the confirmation on the case page. The migration `20261006090000_remove_sheet_import` drops `case.sheet_key`, `sheet_row`, `sheet_serial` and `sheet_notes`, the `IMPORTED` status and the `CONFIRM_IMPORT` decision. It stops, changing nothing, if a case or decision still holds one of them.
- **Don't add it back unless asked.** How the sheet's cases come into the system is open (PLAN, "Waiting on others"). The import as it was built, and SPEC IMP-1 to IMP-7 as they read then, are in the git history up to commit `9a5ce1b`.
- `scripts/made-up.ts` (made-up names, NICs and phone numbers) came from task 8.1 and stays; the load-test data uses it.

The system is for the Ministry of Women and Child Affairs (Sri Lanka) and tracks the **Diviyata Saviyak (දිවියට සවියක්)** housing programme. For each case it records the financial progress (four installment releases) and the physical construction progress.

## Workflow: PRD → SPEC → PLAN before code

This project follows a documentation-first workflow (source: `../Documents/Project Documentation Workflow.pdf`):

- `docs/PRD.md` answers what we are building and why: the problem, users, goals, scope and what is out of scope.
- `docs/SPEC.md` answers what exactly the system must do: functional requirements, inputs and outputs, error handling, security, performance and acceptance criteria.
- `docs/PLAN.md` answers how we will build it and in what order: phases, tasks, dependencies, the files each task touches, tests and completion criteria.

The order is: a clickable prototype is reviewed with the Ministry to settle the PRD's open questions, the user approves the PRD, then the SPEC is written, then the PLAN, then implementation one phase at a time. The prototype ([Design canvas](https://claude.ai/artifact/DQarnsyMfCao1y6SmpMDbT)) is throwaway: sample data only, no backend, and never the start of the app's code. Test each phase before starting the next. When approved requirements change, update all three documents so they stay in sync. Don't start application code until the relevant document exists and the user has approved it. If a question is already answered in the PRD, don't ask the user again.

## Decisions made so far

These may not be in `docs/PRD.md` yet. Once the PRD is approved, it overrides this list.

- **Platform:** a web app used on office PCs and on phones. Since 28 Sep, screens are designed for desktop first, for DS officers as well as Head Office.
- **Language and ease of use (28 Sep, widened 7 Oct):** the screens are in Sinhala, Tamil and English; each officer picks one, and Sinhala is the default. Officers are non-technical, and most of their other systems are in Sinhala. Keep screens simple: one main task per screen, plain words, and the sheet's own terms (for example නිවාසගත, අවදානම් දරුවන්, පළමු වාරිකය).
- **Roles (v1 only):**
  - AG (Divisional Secretariat) officer: sees their own office only. The screens call the role Divisional Secretariat Officer (ප්‍රාදේශීය ලේකම් කාර්යාල නිලධාරී) (14 Oct; it was Child Rights Promotion Officer). A DS can have more than one active officer account (14 Oct; from 29 Sep it had one).
  - Head Office officer: sees everything and can add and edit beneficiaries.
  - Head Office admin: manages accounts and master lists.
- **Money:** Rs. 2,000,000 per case, paid as 4 fixed installments of Rs. 500,000. This includes land-only cases.
- **Releases:**
  - The AG office checks each case on site and ticks off each installment. Head Office does not approve releases.
  - Installments must be ticked in order.
  - Photos are optional and never block a release.
  - Construction stages never block installments.
- **Installment status:** Not started → Processing (with an expected date) → Released (with the actual date).
- **Documents (28 Sep):** a new case has one optional upload, "වෙනත් ලේඛන" (other documents). No document is required, so the field research report and GN certificate are not separate uploads.
- **Kinds of help (28 Sep):** only a new house or the renovation of an existing house. Land cases have not started, so leave them out of the system for now. Don't design for them.
- **Hosting (9 Oct):** one Amazon EC2 server, because officers sign in from DS offices across the country and there is no Ministry server or database for the system. Every push to `main` that passes CI deploys to it through GitHub Actions. Keep it simple: one server with Docker Compose, a setup script and plain shell scripts; no clusters and no configuration tools such as Ansible.
- **Still open with the Ministry:**
  - siblings (one case per family or one per child)
  - renovation stages
  - agreement to keep the data on AWS, outside Sri Lanka (the Personal Data Protection Act), before real data goes in
  - data retention

## Source data (the old sheet)

There is no import now (see "Sheet import (removed)"); this describes the sheet in case one is built again. The live spreadsheet is `../Documents/ප්_රගතිය - දිවියට සවියක්.xlsx`. It sits outside this repo and is not under version control. It has two sheets:

- `නිවාසගත` (housed beneficiaries, 240 rows and one empty row). Columns A to P: serial no, name, NIC, address, phone, district, divisional secretariat (`ප්‍රා.ලේ. කොට්ඨාසය`).
- `අවදානම් දරුවන්` (children at risk, 504 rows). Columns A to Q: serial no, child's name, guardian's name, guardian's NIC, address, phone, district, divisional secretariat (`ප්‍රා.ලේ. කාර්යාලය`, worded differently from the other tab).

Both sheets end with the same columns:

- Financial progress (Rs): 1st to 4th installment.
- Physical progress: Foundation Level, Wall Level, Roof Level, Completed.
- Remark.

Things to know when parsing:

- **Two-row header.** Row 1 holds the group headers and the ungrouped columns, which are merged over both rows. Row 2 holds the sub-columns under "financial progress" and "physical progress".
- **Missing headers.** The care leavers' phone column has no header, and their district's header is on row 2 only. The children's serial number column has no header.
- **Serial numbers.** On the care leavers' tab one serial number is used twice. On the children's tab a block of 38 rows, all from one DS office, has no serial number, and the numbers go on after it.
- **NICs and phone numbers.** Most rows have no NIC (2 of 240 care leavers, 37 of 504 children) and most children have no phone number. Excel holds some as numbers: 12-digit NICs, and phone numbers without their first 0. Old NICs come with a small `v`, sometimes after a space, and a few have the wrong number of digits. Phone numbers are written `07X-XXXXXXX`, sometimes two or three in one cell split by spaces.
- **Districts** are in Sinhala, or in English in the north (Jaffna, Mannar, Kilinochchi, Vavuniya), and some are spelled unlike the list: අනුරාධපුර (the list has අනුරාධපුරය), ත්‍රීකුණාමලය (ත්‍රිකුණාමලය), රත්නපුර (රත්නපුරය), මොනරාගල (මොණරාගල) and Mullative (Mullaitivu).
- **DS offices** are in Sinhala or English, with other spellings: extra or missing spaces, a zero-width non-joiner (U+200C), capitals, typing slips, words in another order, and now and then an office of another district.
- **Progress columns hold notes, not amounts:** ඔව්, නැත, No, or a sentence about when an installment is expected. The children's tab has notes only in the first installment column. Remarks are rare, and one is a number.
- **Zero-width joiners.** The Sinhala headers contain U+200D (ZWJ), for example `ප්‍රා.ලේ.` Match headers after normalising, not on the raw strings.
- **Cell colours.** Some cells are colour-coded in the sheet, but the colours are deliberately ignored on import.
- **Windows console.** Printing Sinhala text from Python on Windows needs `sys.stdout.reconfigure(encoding='utf-8')`.
- **Real personal data.** The workbook holds names, NICs, phone numbers and addresses of real beneficiaries and children. Never commit it or copy real rows into this repo. Use synthetic data for fixtures and seeds.
