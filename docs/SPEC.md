# Diviyata Sawiyak — Software Specification

2026-09-28, updated 2026-10-14 · Janindu Pramod

> **Status:** draft. This SPEC turns the [PRD](PRD.md) into requirements precise enough to build and test against. The [clickable prototype](https://claude.ai/artifact/DQarnsyMfCao1y6SmpMDbT) shows the screens. The PRD's open questions are deferred: [section 13](#13-deferred-questions-and-the-defaults-used) gives the default this SPEC uses for each until the Ministry answers.

"Shall" means the requirement must be met. Each requirement has an ID (for example `CASE-5`) that the PLAN, the tests and the acceptance criteria refer to.

## 1. Scope

This SPEC covers version 1 as the PRD defines it:

- three roles, and cases for new houses and renovations
- the Head Office check and the Rs. 2,000,000 release
- the four installments and the building stages
- dashboards and Excel exports
- accounts and lists

It does not cover anything under "Later" or "Out of scope" in the PRD.

## 2. Technology stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router) with TypeScript in strict mode, React Server Components and Server Actions, on the current Node.js LTS |
| Database | PostgreSQL, accessed through Prisma; schema changes through Prisma Migrate |
| Sign-in and sessions | Better Auth: username and password, sessions stored in the database, admin plugin |
| Forms and validation | React Hook Form in the browser; the same Zod schemas checked again in every Server Action |
| Screens | Tailwind CSS and shadcn/ui components; Noto Sans Sinhala and Noto Sans Tamil served from our own server through `next/font/local` |
| Language | next-intl; three locales, `si` (the default), `ta` and `en` (UI-9), chosen by a cookie, with no language in the address; every string in `messages/si.json`, `ta.json` and `en.json` |
| Excel | ExcelJS |
| Images | sharp |
| Tests | Vitest for unit and database tests, Playwright for end-to-end tests |
| Runtime | Docker Compose on one Amazon EC2 server running Ubuntu 24.04 LTS (section 11): `app` (Next.js standalone build), `db` (PostgreSQL), `proxy` (Caddy, which gets and renews its own TLS certificate) |
| Delivery | GitHub Actions: the checks on every change, and on `main` the images (kept in GitHub's container registry) and the deploy over SSH |

Rules for the stack:

- **STK-1** Every dependency shall be pinned to an exact version, and the lockfile committed. Upgrades are made on purpose, one at a time, never automatically.
- **STK-2** The system shall not use any third-party hosted service that receives or stores its data, other than its host, Amazon Web Services (the EC2 server and the S3 backup bucket, section 11): no Vercel, Supabase, Firebase, Clerk, hosted analytics or runtime Google Fonts. The one exception is the mail service that sends password reset codes (14 Oct 2026; earlier that day an SMS gateway), which receives only an officer's email address and a code (AUTH-7), never case data. The server reaches it at `SMTP_HOST`; Amazon SES needs no exception, as part of AWS.

## 3. Architecture

```
 Browser (office PC)
      │ HTTPS
      ▼
 Caddy (TLS) ──► Next.js app
                   ├─ pages (Server Components) ──┐
                   ├─ Server Actions ─────────────┼─► data-access layer (role + office checks) ─► Prisma ─► PostgreSQL
                   └─ /files/[id] route ──────────┘                                            └─► /data/files (private)
```

- **ARC-1** One Next.js application shall serve every screen and action. Version 1 has no public API.
- **ARC-2** Every read and write shall go through a server-side data-access layer (`src/server/`). That layer receives the signed-in user and applies the role and office rules in section 4. Pages and Server Actions shall never call Prisma directly.
- **ARC-3** Middleware may redirect signed-out users to the sign-in page, but it shall never be the only permission check.
- **ARC-4** Every change of state shall write its audit record (HIS-1) in the same database transaction as the change.
- **ARC-5** Uploaded files shall be stored under a private directory (`/data/files`, set by `FILES_DIR`) outside the web root, and served only through the `/files/[id]` route (SEC-7). In development the folder is `data/files` in the project, which git ignores.
- **ARC-6** All dates and times shall use the Asia/Colombo time zone.

## 4. Roles and permissions

Every account has exactly one role. A DS officer runs the system for their DS; the screens call the role Divisional Secretariat Officer (ප්‍රාදේශීය ලේකම් කාර්යාල නිලධාරී), in Tamil பிரதேச செயலக உத்தியோகத்தர் (14 Oct 2026; it was Child Rights Promotion Officer, but an office's officers are not all one). A DS officer belongs to exactly one DS office, and a DS office can have more than one active DS officer, who all work on its cases alike (ADM-3). Head Office officers and admins belong to none.

| Action | DS officer | Head Office officer | Admin |
| --- | --- | --- | --- |
| See cases | Own DS only | All | None |
| Create a case, save a draft, submit | Own DS | Any DS | — |
| Edit a draft or a returned case | Own DS | Any | — |
| Edit a case after it is verified | — | Yes, and every change is logged | — |
| Verify, send back or reject | — | Yes | — |
| Record the Rs. 2,000,000 release | — | Yes | — |
| Change an installment | Own DS | Undo a release only (INS-6) | — |
| Record a stage update, photos and documents | Own DS | — | — |
| Stop or reopen a case | — | Yes | — |
| Dashboard | Own DS | National | — |
| Export to Excel | Own DS lists | Any list | — |
| Manage accounts and lists | — | — | Yes |

- **PRM-1** When a DS officer asks for a case, file or history belonging to another DS, the system shall answer "not found" (HTTP 404). It shall not answer "forbidden", so nobody can learn which case numbers exist.
- **PRM-2** An admin shall not be able to open any page, list, file or export that shows beneficiary details.
- **PRM-3** Office scope shall be read from the account on every request. When the admin moves an officer to another DS (ADM-4), the change applies to the officer's next request.

## 5. Data model

Amounts are whole rupees stored as integers. Nothing listed here is ever deleted, except drafts (CASE-8) and password reset codes (AUTH-7).

| Entity | Main fields | Rules |
| --- | --- | --- |
| Province | name in Sinhala, Tamil and English | 9 rows, seeded |
| District | name in Sinhala, Tamil and English, province | 25 rows, seeded |
| DsOffice | name in Sinhala, Tamil and English, code, district, active | `code` is 3 capital letters, unique nationally, and used in case numbers. The Sinhala name is unique within its district |
| User | full name, designation, mobile, email, username, role, DS office, active, must change password, last sign-in, failed sign-ins, locked until | DS office is required for DS officers only, and an office can have several active DS officers (ADM-3). Username is generated (ADM-2) and unique |
| ResetCode | ticket (its SHA-256), user, code (an HMAC), created at, expires at, tries, checked at | One code sent by email to reset a forgotten password (AUTH-7). A ticket for an unknown username, or for an account that gets no email, has no user. Used tickets and all of the account's other codes go when a password is set; any other row goes a day after it expires. The account's history keeps the audit records |
| Case | case number, DS office, category, kind, status, name, child's name, NIC, NIC key, address, GN division, mobile 1, mobile 2, remark, created by, submitted at, verified at, completed at, status before stop, another name requested, replaces case, version | See CASE-2 for field rules. `version` goes up by one on every save and every installment, stage or status change (CASE-10). `submitted at` is the latest submit. While the case is stopped, `status before stop` holds the status it goes back to (CLS-3); the stop's day and reason are its Decision. `another name requested` is set when Head Office rejects or stops the case and asks for another name in its place (CASE-11); only a rejected or stopped case has it (a database check), and reopening clears it. `replaces case` is the case this one was entered in place of; a case is replaced by at most one other (unique), never by itself |
| CaseNumberCounter | DS office, year, last number | One row per office and year. Taking the next number locks the row, so two submits at once never share a number (CASE-5) |
| Decision | case, type, reason, by, at | Types: submit, verify, send back, reject, stop, reopen |
| ReleaseLetter | district, letter number, letter date, valid until, note, by, at | One allocation letter (ප්‍රතිපාදන ලිපිය) to a District Secretary for several verified cases of that district (REL-2, 6 Oct 2026). Valid until is never before the letter date (a database check). Its scan, if any, is a File |
| Release | case (one per case), letter, released on, amount, by, at | Amount is always 2,000,000 (a database check). Released on is the letter's date, kept on each release for the installment and stage date rules; correcting the letter's date changes it on every release of the letter (REL-4). Before 6 Oct 2026 each release had its own reference number and note; the migration made each such release a letter of its own |
| Installment | case, number 1–4, amount, status, purpose, expected on, released on, note | Amount is always 500,000 and the number 1 to 4 (database checks). Case plus number is unique. All four are created when the release is recorded |
| StageDefinition | kind, order, name in Sinhala, Tamil and English, active | New-house stages are seeded (LST-4) |
| StageUpdate | case, stage (empty means a note-only visit), visited on, note, by, at | A case's current stage is the highest stage it has reached. Each stage is reached once per case; a stage skipped by a later choice gets its own row on the same day (STG-2). A stage that has been used can't be removed (a database rule, LST-4) |
| File | kind (document, photo or letter scan), case, stage update, letter, stored name, thumbnail name, original name, type, size, SHA-256, uploaded by, removed at | Linked to a case as a document, or also to a stage update as a photo, or to an allocation letter as its scan, never to a case (database checks). Anyone who may see one of a letter's cases may open its scan. A photo has a small copy for thumbnails (STG-6). Until the case form or the stage update is saved with it, only the person who uploaded it can open it, and an upload never saved is removed after a day. A document taken off a case is kept but no longer shown |
| AuditLog | at, actor, action, entity, entity id, case, before, after | Can only be added to, never changed (HIS-3) |
| Notification | user, case, type, created at, read at | See NTF-1 |

Values used across the system:

- **Category:** `CARE_LEAVER` (නිවාසගත) or `CHILD_AT_RISK` (අවදානම් දරුවන්).
- **Kind:** `NEW_HOUSE` (නව නිවසක් ඉදිකිරීම) or `RENOVATION` (නිවස අලුත්වැඩියා කිරීම).
- **Installment status:** `NOT_STARTED` (තවම ආරම්භ කර නැත), `PROCESSING` (ගෙවීමට කටයුතු කරමින්) or `RELEASED` (ගෙවා ඇත).

## 6. Case statuses and transitions

| Status | Screen label | Meaning |
| --- | --- | --- |
| `DRAFT` | තවම යවා නැත | Saved by the DS, not sent |
| `SUBMITTED` | පරීක්ෂාවට යවා ඇත | Waiting for the Head Office check |
| `RETURNED` | ආපසු එවා ඇත | Sent back to the DS for correction |
| `VERIFIED` | අනුමතයි | Approved, waiting for the Rs. 2,000,000 release |
| `IN_PROGRESS` | වැඩ සිදුවෙමින් | Release recorded; installments and stages running |
| `COMPLETED` | නිමයි | Finished (CLS-1) |
| `REJECTED` | ප්‍රතික්ෂේප කළා | Refused by Head Office, with a reason |
| `STOPPED` | නවතා ඇත | Cannot go ahead, with a reason |

| From | To | Who | Needs | Then |
| --- | --- | --- | --- | --- |
| (new) | `DRAFT` | DS officer, HO officer | Nothing | — |
| `DRAFT`, `RETURNED` | `SUBMITTED` | DS officer, HO officer | Every rule in CASE-2 passes | A case number is given on the first submit (CASE-5) |
| `SUBMITTED` | `VERIFIED` | HO officer | — | DS notified |
| `SUBMITTED` | `RETURNED` | HO officer | Reason | DS notified |
| `SUBMITTED` | `REJECTED` | HO officer | Reason | DS notified |
| `VERIFIED` | `IN_PROGRESS` | HO officer | Its district's allocation letter (REL-2) | Four installments created; DS notified |
| `IN_PROGRESS` | `COMPLETED` | The system | CLS-1 is met | DS notified |
| `VERIFIED`, `IN_PROGRESS` | `STOPPED` | HO officer | Reason | DS notified |
| `STOPPED` | The status it had before | HO officer | Reason | DS notified |

- **STS-1** Any change not listed in this table shall be refused on the server with a message explaining why, even when the screen hides the button.
- **STS-2** `COMPLETED` and `REJECTED` are final.
- **STS-3** Nobody can edit a case's details while it is `SUBMITTED`. The DS waits for the Head Office decision.

## 7. Functional requirements

### 7.1 Sign-in (AUTH)

- **AUTH-1** Users shall sign in with their username and password.
- **AUTH-2** After 5 wrong passwords in a row, the account shall be locked for 15 minutes. After a wrong password the message shall say how many attempts are left; while locked, how many minutes remain. The messages shall be the same whether or not the username exists: an unknown username counts down and locks the same way.
- **AUTH-3** An account with a temporary password shall go straight to a "set a new password" page and reach no other page until it is done. The new password shall have at least 8 characters and differ from the temporary one.
- **AUTH-4** A session shall end after 30 minutes without activity, and always after 12 hours. Signing out shall end it at once.
- **AUTH-5** A disabled account shall not be able to sign in. Its open sessions shall stop working on their next request.
- **AUTH-6** Passwords shall be stored only as slow hashes, using Better Auth's default. A temporary password shall be shown once and never stored in plain text or written to any log.
- **AUTH-7** An officer who has forgotten their password shall set a new one with a code sent by email to the address in their account (ADM-2), from "මුරපදය අමතකද?" on the sign-in page (14 Oct 2026; earlier that day the request went to the admin, which the user replaced with a code by SMS, and then with a code by email, which costs nothing to send). Three steps on one page:
  - **The username.** The next step shall read the same for any username, as for AUTH-2: "if the username is right, a code was sent". Only an active account with an email address gets an email, and at most 5 in 24 hours; a new code ends the account's earlier ones. The code is 6 digits and lasts 15 minutes, and the email is in the screen's language. If the mail server refuses the email, the page shall say so and point to the admin. The page shall also say to look in the spam folder.
  - **The code.** A wrong code shall say how many tries are left, and the 5th wrong one ends the code. A new code can be asked for at this step.
  - **The new password,** by AUTH-3's rules (at least 8 characters, typed twice), within the same 15 minutes. The officer chose it, so they aren't asked to change it again. It clears a lock (AUTH-2), ends every open session and uses up the account's codes; then the sign-in page says the password is set.
  - The account's history shows each code sent (by "the sign-in page") and the password set with one. A disabled account gets no email, and a code checked before the account was disabled sets no password.
  - The admin can still give a temporary password (ADM-5), for an officer with no email address or who gets no email. On a server with no mail server the page says that resetting by email is not on yet and sends the officer to the admin.

### 7.2 Admin: accounts (ADM)

- **ADM-1** The users screen shall list every account with its name, username, role, DS office, district, last sign-in and status. It shall be searchable by name, office or username, and filterable by role.
- **ADM-2** Creating an account shall take:
  - **Inputs:** full name (required, 2–100 characters), designation (optional, up to 100), mobile (required, `^0\d{9}$` once spaces are removed), email (optional, a valid address; codes for a forgotten password go to it, AUTH-7) and role (required). A DS officer also needs a district and a DS office, chosen in that order from the lists.
  - **Output:** a generated username (the role prefix `ds`, `ho` or `ad` plus 4 digits, unique) and a 12-character temporary password, shown once.
- **ADM-3** A DS office may have any number of active DS officer accounts, one for each officer who uses the system (14 Oct 2026; until then an office had at most one). They all see and change the office's cases alike (PRM-1), and each gets the office's notifications (NTF-1).
  - The form shall offer every active office, by its name only; it shows no officers' names (14 Oct 2026).
  - The lists screen shall show each office's active DS officers by name, or that it has none.
  - When an officer leaves, the admin disables their account (ADM-6). The account and its history stay (ADM-7).
- **ADM-4** The admin shall be able to change any account detail. Changing a DS officer's office is how a transfer is recorded, and the history keeps both offices.
- **ADM-5** Resetting a password shall show a new temporary password once, require a change at the next sign-in, and end the account's open sessions.
- **ADM-6** The admin shall be able to disable and re-enable accounts. An admin cannot disable their own account, and at least one active admin must always remain.
- **ADM-7** Accounts shall never be deleted.

### 7.3 Admin: lists (LST)

- **LST-1** The system shall be seeded with the 9 provinces, the 25 districts and every DS office, with their names in Sinhala, Tamil and English (UI-9) and codes. The Tamil names are to be checked with the Ministry before go-live (task 9.7).
- **LST-2** The admin shall be able to add a DS office to a district. The admin types its name once, in the screen's language; the names in the other two languages are optional, folded away under "අනෙක් භාෂාවලින් නම", and the system writes any left blank from the typed one, by sound, in that language's letters (UI-9, 8 Oct 2026). The Tamil name must be in Tamil letters and the English one in English letters; a name the system can't write within those rules (one with digits, say) is left for the admin to type. The Sinhala name must be unique within the district, and the code unique nationally.
- **LST-3** The admin shall be able to rename a DS office or make it inactive. Renaming works as adding does (LST-2): the name in the screen's language, with the other two under "අනෙක් භාෂාවලින් නම". An inactive office gets no new accounts or cases but keeps its existing ones.
- **LST-4** For each kind of help, the admin shall be able to add, rename, reorder and deactivate stages, each named in Sinhala, Tamil and English and typed once, as in LST-2:
  - New-house stages are seeded as අත්තිවාරම් මට්ටම, බිත්ති මට්ටම, වහල මට්ටම, නිමයි (in Tamil அத்திவார மட்டம், சுவர் மட்டம், கூரை மட்டம், நிறைவு; in English Foundation level, Wall level, Roof level, Completed).
  - Renovation stages start empty.
  - A stage that has been used can be deactivated but not removed.

### 7.4 DS home: my beneficiaries (HOME)

- **HOME-1** The home page shall show only the officer's own DS cases. Each row shows:
  - name, plus the child's name for children at risk
  - case number, category, kind and status
  - installments released (for example `2 / 4`)
  - current stage or next step
  - for a case in progress, days since the last update, when that is 30 or more (the same rule as HOME-3 and DSH-1)
- **HOME-2** Tabs shall filter the list to all cases, cases in progress or completed cases. Search shall match name, child's name, case number or NIC.
- **HOME-3** A "to do" panel shall list:
  - cases for which Head Office asked for another name and none has been entered yet (CASE-11), with the Head Office reason, leading to the new-case form
  - returned cases, with the Head Office reason
  - drafts
  - installments in `PROCESSING` whose expected date has passed or is within 7 days
  - cases in progress with no update in 30 days
- **HOME-4** A money panel shall show the office's total received (releases), paid out (released installments) and balance.

### 7.5 Adding and editing a case (CASE)

- **CASE-1** A case shall be entered on one page with four numbered parts: category, kind of help, the beneficiary's details and other documents.
- **CASE-2** Fields and rules:

  | Field | Required | Rule |
  | --- | --- | --- |
  | Category | Yes | `CARE_LEAVER` or `CHILD_AT_RISK` |
  | Kind of help | Yes | `NEW_HOUSE` or `RENOVATION` |
  | Child's name | For children at risk | 2–100 characters |
  | Name (care leaver or guardian) | Yes | 2–100 characters |
  | NIC | No | 9 digits and V or X (old), or 12 digits (new). Stored in capitals without spaces |
  | Address | No | Up to 300 characters |
  | GN division (ග්‍රාම නිලධාරී වසම) | No | Up to 100 characters, as typed |
  | Mobile 1 | No | `^0\d{9}$` once spaces are removed. A lone number typed as mobile 2 is stored as mobile 1 |
  | Mobile 2 | No | Same rule as mobile 1 |
  | Remark | No | Up to 1,000 characters |
  | Other documents | No | PDF, JPEG or PNG; up to 10 MB each; up to 10 files |

  The NIC, address and phone numbers became optional on 5 Oct 2026: some beneficiaries and guardians have none. The GN division was added the same day, because some offices' sheets record it.

  Each document is uploaded as soon as it is chosen and joins the case when the form is saved. While a case can be edited, a document can be taken off it; the file itself is kept.

- **CASE-3** For a DS officer, the district and DS office shall come from the account and cannot be changed. A Head Office officer chooses the district, then the DS office.
- **CASE-4** Saving a draft shall skip the required-field checks. Format rules still apply to fields that are filled in.
- **CASE-5** Submitting shall:
  1. Check every rule. If any fail, save nothing and show the errors (ERR-1).
  2. Show a summary to confirm.
  3. On confirmation, set the status to `SUBMITTED` and, on the first submit only, give a case number `{DS code}-{year}-{NNN}` (for example `HMG-2026-011`). `NNN` counts up per DS per year, uses at least 3 digits, and cannot be changed.
- **CASE-6** Duplicate NIC check:
  - For matching, an old NIC is turned into its 12-digit form: `19` + its first 5 digits + `0` + its next 4 digits. So `880001234V` becomes `198800001234`.
  - When the NIC is entered, and again at submit, it shall be compared with every other case.
  - A match in the same DS shows the case number and name. A match in another DS shows only the case number and DS office. Head Office sees all three.
  - Drafts count only in the case's own DS, where a draft shows its name without a number.
  - The warning shall never block saving or submitting.
- **CASE-7** A returned case shall show the Head Office reason at the top of the form. The DS corrects it and submits it again.
- **CASE-8** The owning DS, or Head Office (which may also start drafts), may delete a draft with its documents. The deletion is logged without personal details.
- **CASE-9** After a case is verified, only a Head Office officer can change its details, and every changed field is logged with its old and new value. This is possible while the case is `VERIFIED` or `IN_PROGRESS`; a completed, rejected or stopped case can't be changed. Every required field must stay filled in, and the form has one save button and no submit. The kind of help can't change once the case has reached a stage, because the kind decides the stage list (LST-4).
- **CASE-10** Saving a case that someone else changed after it was opened shall fail with ERR-3. It shall never overwrite their change silently.
- **CASE-11** (added 2026-10-12, PRD question 7) Replacing a beneficiary. The new person is always a new case, never an edit of the old one:
  - When Head Office rejects a case (CHK-3) or stops it (CLS-2), it may tick "ask the DS office for another name". The case keeps its status; it is then waiting for a replacement until a case is entered in its place.
  - While a DS office has such a case, the case form (for a new case, a draft or a returned case) asks first whether this person is in place of it, listing each such case with its number, name, decision day and Head Office's reason, and "no, a separate new beneficiary". Submitting needs an answer; saving a draft doesn't. "No" isn't stored, so the form asks again whenever it opens on a case with no link. A Head Office officer entering a case sees the question for the DS office chosen.
  - The answer links the new case to the old one. Only a case of the same DS office that is waiting for a replacement can be chosen, and each old case can be replaced once. If another case took it in the meantime, the save is refused with a message to choose again.
  - The link shows on both cases: the new case's check view and page say which case it replaces, with Head Office's day and reason; the old case's page says another name was asked for and, once entered, which case replaced it. Each links to the other.
  - The link can be changed while the new case is a draft or returned. A case Head Office has verified keeps it.

### 7.6 Finding cases (FND)

- **FND-1** Head Office shall have a case list filterable by name, NIC, case number, district, DS, status, category and kind, sorted by last update. A DS officer has the same list, limited to their own DS.

### 7.7 Head Office check (CHK)

- **CHK-1** The "පරීක්ෂා කිරීමට" (to check) queue shall list `SUBMITTED` cases, oldest submission first. Each row shows the name, case number, DS, days waiting and any duplicate-NIC flag. As in the prototype, the queue and the release queue (REL-1) are two tabs of one screen: the list is on the left and the chosen case on the right.
- **CHK-2** A case's check view shall show every field, its documents (opening in a new tab) and every duplicate-NIC match in full: case number, name, DS and status, each linked to its case. The Head Office case page of a `SUBMITTED` case shows the same matches and decisions.
- **CHK-3** Head Office shall have three actions:
  - **Verify:** no input needed.
  - **Send back:** a reason is required (5–1,000 characters).
  - **Reject:** a reason is required (5–1,000 characters). A tick box, unticked to start with, also asks the DS office for another name in the case's place (CASE-11).

  Verifying asks once to confirm. Each writes a Decision and notifies every active officer of the case's DS. A decision is refused if the case changed after the check view showed it (CASE-10), for example when it was sent back and submitted again in the meantime.
- **CHK-4** (added 2026-10-06) Head Office shall be able to narrow both queues (CHK-1, REL-1) to a district, then to one DS office in it. Each choice shows how many cases wait there. Only places with cases waiting are offered, plus the chosen one even once none are left. The place stays in the address (`districtId`, `dsOfficeId`) through paging, both tabs and every decision, so after a decision the next case shown is the next one waiting in the same place. The tab counts and the menu's count stay for the whole country. Cases are still checked one at a time. The release tab doesn't use the two selects: it lists the districts waiting for a letter instead (REL-1), and it opens on the district in the address. Once the chosen district, or the district of the case just verified, has nothing left to check but has verified cases waiting, a banner above the check queue says so and leads to that district's letter (as in the prototype).

### 7.8 The Rs. 2,000,000 release (REL)

Changed on 6 Oct 2026 (§13, question 9): Head Office no longer releases money case by case. It sends one allocation letter (ප්‍රතිපාදන ලිපිය) to a District Secretary, with one total for several verified cases of that district, and the District gives the money out through each case's DS office. The screens follow the prototype's option A (two tabs).

- **REL-1** The "ප්‍රතිපාදන මුදා හැරීමට" (to release) tab shall list the districts whose `VERIFIED` cases wait for a letter, the most cases first, then the longest waiting. Each shows how many cases wait and their total (Rs. 2,000,000 each), their DS offices, and how long the oldest verification has waited. Below them are the 10 letters recorded last (district, number, date, cases, total, valid until). The tab's count, and the menu's, is the number of `VERIFIED` cases.
- **REL-2** Recording a district's letter shall take:
  - the cases on the letter: the district's `VERIFIED` cases, grouped by DS office, all ticked to start with; at least one. The officer unticks any case the letter doesn't name, and it keeps waiting
  - letter number: required, 1–50 characters
  - letter date: required; not in the future and not before the verification of any ticked case
  - valid until: required; not before the letter date; the end of the year to start with
  - the scanned letter: optional; one PDF, JPEG or PNG of up to 10 MB, uploaded as soon as it is chosen (as CASE-2's documents)
  - note: optional, up to 500 characters

  The amount is Rs. 2,000,000 for each ticked case and can't be edited; the form shows the total. A case of another district, or one that is no longer `VERIFIED` or changed after the form was shown (CASE-10), refuses the whole letter, and nothing is released.
- **REL-3** Saving the letter shall, in one transaction, save the letter and its scan and, for each ticked case, record its Rs. 2,000,000 release on the letter's date, set it to `IN_PROGRESS`, create its four `NOT_STARTED` installments and notify its DS. The Head Office case page of a `VERIFIED` case leads to its district's letter; the case pages show the letter (number, date, district, valid until; for Head Office also how many cases it released and its total) and a link to its scan.
- **REL-4** Head Office shall be able to correct a release's letter from the case page: its number, date, valid until and note. The change is for every case on the letter, and the pop-up says how many that is. The REL-2 date rules apply to all of them, and the date can't move past an installment date already recorded on any of them (INS-3, INS-4); a new date moves each of their releases too. Every correction is logged on each of the letter's cases with the old and new value. A case on the letter changed after the page was shown refuses the correction (CASE-10).

### 7.9 Installments (INS)

- **INS-1** Every case in progress has four installments of Rs. 500,000, numbered 1 to 4.
- **INS-2** Only the lowest-numbered installment that is not yet `RELEASED` can change.
- **INS-3** Moving `NOT_STARTED` to `PROCESSING` shall need an expected date, on or after the release date; it may be in the future. A purpose (up to 200 characters) and a note (up to 500) are optional.
- **INS-4** Moving `PROCESSING` to `RELEASED` shall need the date paid. It must be no later than today, on or after the Rs. 2,000,000 release date, and on or after the previous installment's paid date. A note (up to 500 characters) is optional.
- **INS-5** Installments can change only while the case is `IN_PROGRESS`. A stage never blocks an installment.
- **INS-6** To correct a mistake, a Head Office officer may move the most recently released installment back to `PROCESSING`, with a reason (5–1,000 characters). Its expected date stays, and the reason is shown in the history. Only while the case is `IN_PROGRESS`: a completed case stays completed (STS-2).

Only the DS office starts and pays installments (section 4). Each change is refused if the case changed after the page showed it (CASE-10), which also stops a form sent twice from changing anything twice (ERR-8).

### 7.10 Building progress (STG)

- **STG-1** A stage update shall need a stage later than the current one, or "no change, note only". It also needs a date, no later than today and on or after the release date. A stage reached can't be dated before the day the current stage was reached, so the stages keep their order; a note-only visit has no such limit. A note (up to 1,000 characters) and 0–10 photos are optional. Photos may be JPEG, PNG or WebP, up to 15 MB each, and upload one by one as soon as they are chosen, like documents (CASE-2). Only the DS office records progress (section 4).
- **STG-2** Choosing a stage further ahead shall also mark the skipped stages as reached on the same date.
- **STG-3** On upload, each photo shall be turned upright (from its orientation tag), resized to at most 1,600 px on its long edge and saved as a JPEG at quality 80. All metadata, including GPS location, shall be removed. A 320 px copy is saved beside it for thumbnails. A file that can't be read as an image is refused (ERR-5).
- **STG-4** Renovation cases use the renovation stage list. While that list is empty, only note-only updates are possible.
- **STG-5** Stage updates are allowed only while the case is `IN_PROGRESS`.
- **STG-6** The Head Office case page shall show every stage reached, with its date, note and photo thumbnails, and the note-only visits with theirs. A thumbnail opens the full image in a viewer, with the previous and next photo. The DS case page shows the same.

### 7.11 Completing, stopping and reopening (CLS)

- **CLS-1** The system shall set a case to `COMPLETED` when installment 4 is `RELEASED` and the case has reached the last active stage of its kind. A kind with no active stages needs only installment 4.
- **CLS-2** Stopping a case shall need a reason. The confirmation and the case page shall show the balance left with the DS (2,000,000 minus the amount paid out). As with rejecting, a tick box, unticked to start with, also asks the DS office for another name in the case's place (CASE-11).
- **CLS-3** Reopening a stopped case shall need a reason. It returns the case to the status it had before it was stopped, and withdraws any request for another name. Once a case has been entered in its place, a stopped case can't be reopened. Stopping and reopening take a reason of 5 to 1,000 characters, and a stopped case's page shows the day, the reason and the balance to both roles.

### 7.12 Dashboards and exports (DSH, EXP)

- **DSH-1** The Head Office dashboard shall offer filters for district, category and kind. It shall show:
  - totals: all cases except drafts, cases in progress, completed cases, amount released and amount paid out
  - a table by district, where choosing a district shows its DS offices
  - the number of cases waiting for a check and waiting for release, linked to those queues
  - cases in progress with no update for 30 days or more, the longest first

  An "update" is any installment change, stage update or case edit. The amount released is the Rs. 2,000,000 releases, stopped cases included; the amount paid out is the installments marked paid. The filters narrow every figure except the waiting counts, which are the whole queues, as the menu shows them. The table lists every district, and a district's active DS offices plus any inactive one that has cases. The stale list shows the 10 cases waiting longest and how many there are in all.
- **DSH-2** Dashboard figures shall come from the database when the page loads, and never be more than 1 minute old.
- **EXP-1** Any list shall be exportable to `.xlsx` with headers, statuses and place names in the language of the screen it was downloaded from (UI-9), limited to what the user may see. The file name is in that language too.
  - The lists are Head Office's case list (FND-1), with its filters, and the DS officer's list (HOME-2), with its tab and search. The check and release queues are the case list filtered by status.
  - The file holds every case the list matches, not only the page shown, in the list's order, one row per case: case number, category, kind, status, names, NIC, address, phones, district, DS, the days it was sent, verified, released and completed, the amount released, the amount paid out, the balance left with the DS, the last change and the remark.
  - Days are real Excel dates shown as `YYYY.MM.DD` (UI-3), amounts are numbers, and NICs and phone numbers stay text.
  - The file also has the two groups of Head Office's monthly progress report (added 2026-10-06), with its headers: මූල්‍ය ප්‍රගතිය (රු) over පළමු, දෙවන, තුන්වන and සිව්වන වාරිකය, right after the amount released (it took the place of the number of installments paid, which was dropped at the user's request), and, right after the balance left with the DS, භෞතික ප්‍රගතිය (in place of the stage reached, also dropped at the user's request) over අත්තිවාරම යෙදීම, බිත්ති ගොඩනැංවීම, වහළය සකස් කිරීම and අත්‍යවශ්‍ය අංග සමඟ නිවස සම්පූර්ණ කිරීම. The header takes two rows: each group over its four columns, and every other column's header over both rows. It stays in view, and the filter buttons are on its second row.
  - Each of those cells holds a short dated note, as the old sheet's cells did. An installment reads "<date> දින ගෙවා ඇත" once paid, "<date> දින ගෙවීමට අපේක්ෂිතයි" while processing (its expected day), and is empty before that. A building cell reads "<date> දින නිම කර ඇත" once the case reached that stage. The notes wrap within their columns. The last building column is the kind's last active stage, which finishes the house (CLS-1); the three before it take the kind's first stages, as many as fit, so the four new-house stages fill one column each. A renovation case's building cells stay empty while its stage list is (STG-4).
- **EXP-2** Removed on 2026-10-04: the Ministry no longer needs a copy in the old sheet's layout. EXP-1's export is the only one. The number stays unused.
- **EXP-3** Every export shall be logged with who made it, which filters were used and how many rows it held. It is an audit record of the list, not part of any case's history.

### 7.13 History and notifications (HIS, NTF)

- **HIS-1** Every create, edit and status change shall write an audit record: who did it, when, the action, and the old and new values of each changed field.
- **HIS-2** The case page shall show the case history, newest first, as plain sentences in the screen's language (UI-9), as in the prototype: the day, what happened, and who did it with their role (or "the system" for a completion). Reasons and notes appear under the sentence. A changed detail is named there; its old and new values stay in the audit record.
- **HIS-3** Audit records cannot be edited or deleted. The database shall refuse any update, delete or truncation of the audit table, whichever database account asks.
- **NTF-1** Notifications appear inside the system:
  - Each active officer of a DS gets one when a case of the DS is sent back, verified, rejected, released, completed, stopped or reopened.
  - Head Office officers see live counts of cases waiting for a check and waiting for release in the menu.
  - A bell shows unread notifications, and opening one marks it read. The bell leads to a list of the officer's notifications, newest first (`/ds/notifications`).
  - The menu's count and the bell are read again after every move between screens, so they agree with the page beside them, such as the dashboard's waiting counts (DSH-1). A screen left open doesn't change by itself.
  - An officer moved to another DS (ADM-4) no longer sees notifications about the old DS's cases (PRM-3).

### 7.14 Importing the sheet (IMP)

- **IMP-1 to IMP-7** Removed on 2026-10-06: the sheet is still being updated, so its import was taken out of the code, with the `IMPORTED` status, the confirmation of imported cases and the DS office's "details missing" tab. How the sheet's cases come into the system is open. The numbers stay unused. The import as it was built (task 8.1 to 8.5) is in the git history, up to commit `9a5ce1b`.

### 7.15 Screens and language (UI)

- **UI-1** Every label, message, status and date shall be in the screen's language (UI-9), taken from `messages/si.json`, `ta.json` or `en.json`. No screen text is hard-coded. The three files have the same keys and the same placeholders in every message (a unit test checks it).
- **UI-2** Screens shall be designed for desktop widths of 1,280–1,920 px and stay usable at 1,024 px.
- **UI-3** Dates shall be shown as `YYYY.MM.DD` in every language, and money as `රු. 2,000,000`, `ரூ. 2,000,000` or `Rs. 2,000,000` (Western digits, comma separators).
- **UI-4** Text shall use Noto Sans Sinhala (Noto Sans Tamil for Tamil) at a 16 px base size and a line height of at least 1.5.
- **UI-5** Screens shall use the sheet's own terms, such as නිවාසගත, අවදානම් දරුවන් and පළමු වාරිකය. Each screen does one main task.
- **UI-6** Every form control shall have a visible label, every screen shall work with the keyboard, and text contrast shall meet WCAG 2.1 AA.
- **UI-7** Screens shall follow the prototype:

  | Role | Screen | Route | Prototype screen |
  | --- | --- | --- | --- |
  | All | Sign in, set a new password | `/login`, `/change-password` | — |
  | DS officer | My beneficiaries | `/ds` | මගේ ප්‍රතිලාභීන් |
  | DS officer | New case / edit | `/ds/cases/new`, `/ds/cases/[id]/edit` | නව ප්‍රතිලාභියෙකු |
  | DS officer | Case page | `/ds/cases/[id]` | ප්‍රතිලාභියාගේ පිටුව |
  | HO officer | Dashboard | `/ho` | සාරාංශය |
  | DS officer | Notifications | `/ds/notifications` | — |
  | HO officer | Check and release | `/ho/check`, `/ho/release` | පරීක්ෂාව සහ ප්‍රතිපාදන මුදා හැරීම |
  | HO officer | Case list, case page, new case | `/ho/cases`, `/ho/cases/[id]`, `/ho/cases/new` | ප්‍රතිලාභියාගේ පිටුව |
  | Admin | Users, lists | `/admin/users`, `/admin/lists` | පරිශීලකයින්, ලැයිස්තු |

- **UI-8** The sign-in and set-a-new-password pages shall show the programme's logo above the card: the mark (a house with a sprout, on a gold base), දිවියට සවියක්, a short gold line and the ministry's name. They have no header bar. The logo keeps its own colours: a maroon house and name, a gold base and a green sprout (`src/components/brand/lockup.tsx`). The sign-in button is a softer maroon (`--sign-in`). Every other page's green header is fixed to the top of the screen (it stays in place when the page scrolls) and shows the mark in its own maroon, gold and green on a small cream tile, beside the programme's name. The name is in the screen's language: දිවියට සවියක්, திவியட சவியக் or Diviyata Sawiyak (UI-9). The logo's Latin line "DIVIYATA SAWIYAK" is left out.
- **UI-9** The screens shall come in Sinhala, Tamil and English (7 Oct 2026; PRD question 8). Sinhala is the default.
  - Every page shows a language picker: on the sign-in and password pages above the logo, and in the header elsewhere. It names each language in its own script (සිංහල · தமிழ் · English), marked with its own `lang`.
  - The choice is kept in the browser (a cookie, `lang`, for a year), not in the account or the address, so links and bookmarks work in every language. Choosing shows the same page again in the new language.
  - Province, district, DS office and stage names are shown in the screen's language (LST-1, LST-4). What officers type (names, addresses, notes, reasons) is shown as typed, in whatever script it was typed.
  - A screen shows a name once, in its own language, never in all three side by side (8 Oct 2026). Data is entered once: officers type each detail in one language, and the admin types a list name in one language and the system writes the others (LST-2). Writing by sound is not translating: කොළඹ becomes Kolamba, not Colombo, and a stage typed in English comes out as its sound in Sinhala and Tamil letters, so the admin checks what was written.
  - The case history names districts and stages in the screen's language. Records kept before 7 Oct 2026 hold the Sinhala stage names of the day: the Sinhala screen keeps them, and the others show the stages' current names.
  - The Tamil and English texts need checking by the Ministry before go-live (task 9.7).

## 8. Error handling

- **ERR-1** A form with invalid input shall save nothing and keep what was typed. Each error appears in Sinhala next to its field, and all errors are listed above the save button.
- **ERR-2** A page or record the user may not see shall show a "not found" page (මෙම පිටුව සොයාගත නොහැක), the same as a record that doesn't exist.
- **ERR-3** If someone else saved the record first (CASE-10), the system shall show "මෙම විස්තර වෙනත් අයෙකු මේ අතර වෙනස් කර ඇත. නැවත පූරණය කරන්න." and keep the user's input on screen so it can be entered again.
- **ERR-4** When a session has expired, the user goes to the sign-in page and comes back to the same page afterwards.
- **ERR-5** An upload of the wrong type or size shall be refused with a message for that file. The other files still upload.
- **ERR-6** Any other server error shall show a general Sinhala message with a reference code. The details are logged on the server without personal data.
- **ERR-7** A request that breaks a rule shall be refused on the server with a message naming the rule, even if the screen would not have allowed it. Examples: an installment out of order, or a stage update on a stopped case.
- **ERR-8** Sending the same form twice, for example after a network drop, shall not create a second record.

## 9. Security and privacy

- **SEC-1** The system shall be reachable only over HTTPS (TLS 1.2 or later) with HSTS. Plain HTTP redirects to HTTPS.
- **SEC-2** Every Server Action and route handler shall check the role and office in the data-access layer. Tests shall call each one with each role.
- **SEC-3** The database shall accept connections only from the containers on the server; it publishes no port. The app's database account shall not be able to change the schema, or update or delete audit rows. Migrations run with a separate owner account.
- **SEC-4** Sign-in shall allow at most 10 attempts per minute from one IP address. Asking for a reset code (AUTH-7) shall be allowed at most 5 times per 15 minutes from one IP address, and an account shall get at most 5 codes in 24 hours, each taking at most 5 wrong tries, so no more than 25 guesses a day reach one account. The code is kept only as an HMAC. An unused temporary password expires after 7 days.
- **SEC-5** Responses shall carry these security headers:
  - a Content Security Policy that allows only this site, with no third-party scripts or fonts
  - `frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: same-origin`
- **SEC-6** The Server Actions origin check shall stay on, allowing only the production domain.
- **SEC-7** Files:
  - Files are stored under random names.
  - A file's type is checked from its contents, not its name.
  - `/files/[id]` applies the same permission check as the case the file belongs to.
- **SEC-8** Names, NICs, addresses, phone numbers and email addresses shall never appear in application logs, error messages or URLs. Logs use IDs only.
- **SEC-9** Secrets such as the database passwords, the auth secret, the backup password and the mail server's password (`SMTP_PASSWORD`) shall live only in the server's `.env` file, which only the deploy account and root can read, never in the repository. GitHub holds only the SSH key it deploys with.
- **SEC-10** Backups:
  - The database and files are backed up every night, encrypted on the server, to an S3 bucket in the server's AWS region. Only the server's role can write to the bucket, and it is never public.
  - Backups are kept for 30 days.
  - A restore is tested every month, by the server itself, into a scratch database; a failed test raises an alert (OPS-4).
  - The backup password is also kept off the server, by the Ministry. Without it the backups can't be read.
- **SEC-11** Real sheet data shall never go into the repository, tests or fixtures. Tests use made-up cases.
- **SEC-12** CI shall run `npm audit`. Security fixes are applied within 14 days, or within 3 days for critical ones.

## 10. Performance and capacity

- **PRF-1** The system shall be sized for 400 accounts, 50 people signed in at once, 5,000 cases and 50,000 photos (about 20 GB).
- **PRF-2** 95% of pages shall be answered by the server within 1 second, and a page shall be usable within 3 seconds on a 4 Mbps office connection.
- **PRF-3** The Head Office dashboard shall load within 2 seconds with 5,000 cases.
- **PRF-4** Exporting every case to Excel shall take under 60 seconds.
- **PRF-5** The starting server shall have 2 vCPU, 4 GB RAM and a 100 GB disk: an EC2 `t3.medium` with a 100 GB gp3 volume, or larger.
- **PRF-6** The system shall be available 99% of office hours (08:30–16:30, Monday to Friday) each month. Planned maintenance happens outside those hours.

## 11. Hosting and operations

Decided on 9 Oct 2026 (PRD question 4): one server in the cloud, because officers sign in from DS offices across the country and the Ministry has no server for the system. It is kept simple: no cluster, no load balancer and no configuration tool such as Ansible.

- **OPS-1** There shall be two environments: local development, and the server. Until launch the server runs as staging, with made-up data only (`APP_ENV=staging`). At launch its data and backups are removed and it becomes production. CI (GitHub Actions) runs every check on each change before it can reach the server: lint, formatting, types, the string check, unit, database and end-to-end tests, and the dependency audit.
- **OPS-2** The server is one Amazon EC2 instance running Ubuntu 24.04 LTS, in the AWS region nearest Sri Lanka (Mumbai, `ap-south-1`). It has an Elastic IP and a domain name, and its security group lets in only SSH, HTTP and HTTPS. It runs Docker Compose, and keeps the database and files on named volumes. A setup script prepares a fresh server, and running it again changes nothing that is already in place.
- **OPS-3** Every push to `main` that passes CI is deployed with no manual step. CI builds the release as two images, the app and its tools, tagged with the commit and kept in GitHub's container registry. The deploy backs up the database, runs the migrations, swaps the app and checks its health. If the app doesn't answer, the previous image is restored, and the database too if a migration had run.
- **OPS-4** Every 5 minutes the server checks that its site answers over HTTPS and that its disk is under 80% full, and reports to an alert service; the nightly backup and the monthly restore test report too. The service emails Head Office's contact when a check fails or a report doesn't arrive. It receives no case data.

## 12. Acceptance criteria

Version 1 is accepted when every check below passes on staging with made-up data.

| ID | Check | Covers |
| --- | --- | --- |
| AC-1 | A Homagama DS officer sees only Homagama cases. Opening a Kaduwela case's link shows "not found". | PRM-1, HOME-1 |
| AC-2 | An admin can open the users and lists screens. Any case link, case list, file or export shows "not found". | PRM-2 |
| AC-3 | The admin creates a DS officer, and a username and temporary password are shown once. At first sign-in the officer must set a new password before seeing anything else. | ADM-2, AUTH-3 |
| AC-4 | Each wrong password shows the attempts left (4, 3, 2, 1); the 5th locks the account for 15 minutes. An unknown username shows the same messages. | AUTH-2 |
| AC-5 | Submitting with required fields empty saves nothing. Each error shows in Sinhala next to its field and in the list above the button. | CASE-2, ERR-1 |
| AC-6 | NIC `12345` is refused. `198800012345` and `880001234V` are accepted, and `880001234V` matches a case holding `198800001234`. | CASE-2, CASE-6 |
| AC-7 | A duplicate NIC in the same DS shows the case number and name. One in another DS shows only the case number and DS. Submitting is still possible. | CASE-6 |
| AC-8 | Submitting gives a number like `HMG-2026-001`, and the case appears in the check queue, oldest first. | CASE-5, CHK-1 |
| AC-9 | "Send back" without a reason is refused. With a reason, the DS sees the case and the reason in its to-do panel. Submitting again returns it to the queue. | CHK-3, CASE-7, HOME-3 |
| AC-10 | After verifying, the case waits under its district on the release tab. A letter with no case ticked, or without a number, is refused. After a valid letter, each ticked case has four `NOT_STARTED` installments, its DS is notified, and the case page shows the letter. | REL-1–3 |
| AC-11 | Installment 3 cannot change while installment 2 is not `RELEASED`, including through a direct request to the server. | INS-2, ERR-7 |
| AC-12 | A stage update that skips ahead marks the skipped stages with the same date. An installment can be released at any stage. | STG-2, INS-5 |
| AC-13 | Releasing installment 4 after the last stage is reached sets the case to `COMPLETED`. | CLS-1 |
| AC-14 | Stopping needs a reason. A stopped case allows no installment or stage change and shows its balance. Reopening restores its earlier status. | CLS-2, CLS-3, STS-1 |
| AC-15 | Every change appears in the case history with who made it and when. The app's database account cannot update or delete audit rows. | HIS-1–3 |
| AC-16 | A photo uploaded with GPS data is stored without it. Its file link works only for permitted users. | STG-3, SEC-7 |
| AC-17 | Dashboard totals equal the sums in the database for each filter, tested with seeded data. | DSH-1 |
| AC-18 | Removed with EXP-2 (2026-10-04). | — |
| AC-19 | Removed with IMP-1 to IMP-7 (2026-10-06). | — |
| AC-20 | No Sinhala or Tamil screen shows English interface text, and no English screen shows Sinhala or Tamil interface text; only the language picker names all three. A check in CI finds no hard-coded strings in components. | UI-1, UI-9 |
| AC-21 | With 5,000 seeded cases, the dashboard loads in under 2 seconds. | PRF-3 |
| AC-22 | Restoring last night's backup on staging brings back the cases and their files. | SEC-10 |
| AC-23 | The admin gives a DS office that has an active DS officer a second one; the form offers the office by its name alone, and the lists screen names both officers. Both officers get the office's notifications. | ADM-3, NTF-1 |
| AC-24 | Removed with IMP-1 to IMP-7 (2026-10-06). | — |
| AC-25 | On the check screen, choosing a district and then a DS office lists only that office's cases. After a case is verified, the screen stays on that office, and the release tab opens on that district's letter. | CHK-4 |
| AC-26 | A letter for two cases releases both, with one letter row and each case's own release and installments; one case not `VERIFIED`, or of another district, releases neither. Correcting the letter from one case's page changes it for both. | REL-2–4 |
| AC-27 | On the sign-in page, choosing தமிழ் or English shows the page in that language and keeps it after a reload. A DS officer working in Tamil sees the menu, their office and district names and the money in Tamil; Head Office working in English downloads an Excel file with English headers and file name. | UI-9, EXP-1 |
| AC-28 | The admin, working in Sinhala, adds a DS office with its Sinhala and English names and its code, leaving the Tamil name blank. The lists screen shows only the Sinhala name; in English it shows the typed English name, and in Tamil the name the system wrote in Tamil letters. A stage needs only its Sinhala name. | UI-9, LST-2, LST-4 |
| AC-29 | A commit pushed to `main` that passes CI runs on the server with no manual step, and a page left open from the old version reloads on its next move. A release whose app fails its health check is undone: the previous version runs again, and the database is as it was before the deploy. | OPS-3 |
| AC-30 | Head Office rejects a case and ticks "ask for another name". The DS officer's to-do panel shows the request; their new-case form asks whether the new person is in its place and won't submit without an answer. Once linked, the new case's check view and both case pages name each other, and the request leaves the to-do panel. A second case can't take the same place, and a stopped case that has been replaced can't be reopened. | CASE-11, CHK-3, CLS-3, HOME-3 |
| AC-31 | On the sign-in page an officer who has a temporary password follows "මුරපදය අමතකද?" and gives their username; a 6-digit code goes by email to the address in their account, and an unknown username sees the same next step. A wrong code says 4 tries are left. The right one leads to the new password, after which the sign-in page says it is set, and the officer signs in with it straight to their home page. The account's history shows the code sent and the password set. | AUTH-7, SEC-4 |

## 13. Deferred questions and the defaults used

On 28 Sep the open questions were set aside for later. Until the Ministry answers, the system uses the defaults below. Each one is kept in the places listed, so changing it later is a small, contained change.

| PRD question | Default in version 1 | Where it lives |
| --- | --- | --- |
| 1. Siblings | Each child is a separate case. A shared NIC only raises a warning. | CASE-6 |
| 3. Renovation stages | The admin defines the list. Until then, renovation cases take note-only updates. | LST-4, STG-4 |
| 4. Hosting | Answered 9 Oct 2026: one Amazon EC2 server. The Ministry must still agree that the data may be kept outside Sri Lanka. No longer a default. | Section 11 |
| 5. How long records are kept | Everything is kept; nothing is deleted automatically. | Section 5 |
| 6. Money on a stopped case | The balance left with the DS is shown. The system has no refund process. | CLS-2 |
| 7. Replacing a beneficiary | Settled on 12 Oct 2026 after the prototype: the new person is a new case linked to the one it replaces, and Head Office asks for it when rejecting or stopping. Still to ask the Ministry: may a case be replaced after money was paid, and does its balance then go to the new person? Until then the stopped case's balance stays with the DS (question 6) and the new case gets its own Rs. 2,000,000. | CASE-11, CHK-3, CLS-2, CLS-3 |
| 8. Tamil | Answered 7 Oct 2026: the screens come in Sinhala, Tamil and English. | UI-9 |
| 9. How the Rs. 2M is released | Answered on 6 Oct 2026: by one allocation letter to a District Secretary for several verified cases of the district. No longer a default. | REL-1–4 |
| 12. First password | The admin sees it once and passes it on in person or by phone. A forgotten password the officer resets with a code sent by email (14 Oct 2026); the admin's new password stays for an officer with no email address. | ADM-2, AUTH-7 |

The six rules marked Proposed in the PRD are built as written there: send back (CHK-3), Head Office-only edits after verification (CASE-9), nothing deleted (ADM-7, LST-3), the completion rule (CLS-1), one account per person (ADM-2), and the duplicate NIC in another DS (CASE-6).
