# Student Organization Fund Tracker

A mobile-friendly web app for one student organization to collect fees, track fund balances, handle fund requests and liquidation receipts, and let students check their payment status by QR. Each academic year (AY) is kept separate inside one PostgreSQL database.

| Layer    | Stack |
|----------|-------|
| Web      | React 19 + Vite, React Router 7, Tailwind CSS 4, TanStack Query |
| API      | Node.js + Express 5 (TypeScript), Prisma 6, Zod, JWT in httpOnly cookies |
| Database | PostgreSQL 16 (one database; AYs separated by `academic_year_id`) |

```
student-org-fund-tracker/
├─ apps/api        Express API, Prisma schema, migrations, seed, tests
├─ apps/web        React app
└─ packages/shared Validation schemas, permission rules and helpers used by both
```

## Build status

| Phase | Scope | Status |
|------|-------|--------|
| 1 | Foundation: schema + migrations, auth, signup/approval, positions, AY scoping, audit log | ✅ done |
| 2 | Settings, AY management, Copy Wizard | ✅ done |
| 3 | Students: manual add, CSV import, self-enrollment QR, duplicate rules | ✅ done |
| 4 | Funds, charge generation, ledger | ✅ done |
| 5 | Collection, hybrid allocation, digital receipt, QR status page | ✅ done |
| 6 | Fund requests, approvals, liquidation receipts | ✅ done |
| 7 | Notifications and email | ✅ done |
| 8 | Histories, dashboard analytics, printed reports | ✅ done |
| 9 | Testing, security review, two-factor sign-in, deployment guide | ✅ done |

## Setup (Windows, macOS or Linux)

Requirements: **Node.js 22.12+** (22 LTS or 24) and **PostgreSQL 16**.

1. **Install dependencies** (from this folder):
   ```bash
   npm install
   ```
   This also generates the Prisma client.

2. **Configure the API.** `apps/api/.env` and `apps/api/.env.test` are created from `apps/api/.env.example`. In both files, replace `YOUR_POSTGRES_PASSWORD` with your PostgreSQL password. If the password contains `@ : / # ?` or spaces, URL-encode it (e.g. `@` → `%40`).

3. **Create the database tables** (this creates the `fundtracker` database if it doesn't exist):
   ```bash
   npm run db:migrate
   ```

4. **Seed** AY 2026-2027 with a sample organization's settings, positions, programs (BSIT, BSCS) and sections (A–C):
   ```bash
   npm run db:seed
   ```

5. **Run** the API (http://localhost:4000) and the web app (http://localhost:5173) together:
   ```bash
   npm run dev
   ```

6. Open http://localhost:5173 and **sign up**. The first account in an academic year that has no adviser becomes its **adviser**. Everyone after that waits as *pending* until the adviser approves them and assigns a position.

Without SMTP settings, emails (verification links, password resets, approval notices) are **printed in the API console** instead of being sent. Copy the link from there.

## Environment variables (`apps/api/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `WEB_URL` | `http://localhost:5173` | Public URL of the web app, used in email links |
| `API_PORT` | `4000` | API port (named so a host-provided `PORT` for the web server never collides) |
| `JWT_SECRET` | — | At least 32 random characters. Generated for you on first setup |
| `ACCESS_TOKEN_TTL_MIN` | `15` | Lifetime of the access-token cookie |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Longest a session can last |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy so rate limits see real client IPs |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | empty | Outgoing mail. Empty host = print emails to the console |
| `MAIL_FROM` | `Fund Tracker <no-reply@localhost>` | Sender address |
| `UPLOAD_DIR` | `./storage` | Local file storage for logos and attachments (relative to `apps/api`). Tests use `./storage-test` |
| `NODE_ENV` | `development` | `production` turns on https-only cookies, HSTS and quiet mail logs, and prints warnings about risky settings at start |
| `SERVE_WEB` | `false` | `true` makes the API serve the built web app too (one process; see the deployment guide) |
| `WEB_DIST` | `../web/dist` | Where the built web app is, relative to `apps/api` |
| `COOKIE_SECURE` | on in production | Turn off only on a trusted network without https |
| `WEB_PORT`, `VITE_API_PROXY` | `5173`, `http://localhost:4000` | Development only: move the web dev server and its API proxy (for a second copy) |

The idle session timeout and password rules are **per-AY settings** (default 60 minutes; at least 10 characters with upper- and lowercase letters and a number).

## Scripts (run from the repo root)

| Command | What it does |
|---------|--------------|
| `npm run dev` | API + web with hot reload |
| `npm test` | API test suite against `fundtracker_test` (its tables are emptied by the tests) |
| `npm run typecheck` | Type-checks all three packages |
| `npm run build` | Production build of API (`apps/api/dist`) and web (`apps/web/dist`; each page is its own chunk) |
| `npm start` | Runs the production build (`node apps/api/dist/index.js`) |
| `npm run db:migrate` | Applies pending migrations |
| `npm run db:seed` | Seeds the sample org and AY (safe to run more than once) |
| `npm run db:reset` | **Deletes everything** in the dev database, re-applies migrations and re-seeds |

## How the core rules are enforced

- **AY isolation.** Every AY-specific table has `academic_year_id`, and child rows reference their parent by `(id, academic_year_id)`, so PostgreSQL itself rejects a row that links two academic years. On top of that, route handlers use `forAy(ayId)` (`apps/api/src/db.ts`), a Prisma client that automatically adds the AY filter to every query and refuses writes for another AY. The web app sends the AY chosen in the switcher as the `X-AY-Id` header.
- **One position per member.** A member has one position per AY (President, Treasurer, Collector…). What a position may do (file requests, collect payments, see confidential funds) is set on the position by the adviser. The adviser has every permission. Permissions are checked by the API on every request, not just hidden in the UI.
- **Name snapshots.** Approvals, payments, requests and ledger entries store the actor's ID **and** their name and position at that moment.
- **Nothing financial is deleted.** Database triggers make the ledger, payment allocations, approval decisions and audit log append-only. Payments can only change from posted to voided. Accounts that were ever approved can only be deactivated.
- **Audit log.** Every create, update, approval, rejection, void, delete, settings change, login and password change is recorded with before/after data. Passwords and tokens are always redacted.
- **Closed AY = read-only.** Every mutating AY route checks the AY status.
- **Every action is confirmed** in a dialog; reject dialogs have an optional comment.

## Academic years and the Copy Wizard

- **Academic years** (adviser only) lists every AY with its adviser and member counts. From here you create a new AY, make an AY the *current* one (where new signups go), and close or reopen an AY. The current AY can't be closed; make another one current first. A closed AY is read-only.
- A new AY starts **empty**. The first time an adviser opens it, the **Copy Wizard** offers to set it up:
  - **Copy from an existing AY** (one where you are the adviser), choosing any of: adviser, staff, settings, funds, remaining balance per fund, and promote students. Options that need another option tick it automatically (e.g. staff needs settings, because positions come with the settings).
  - **Start fresh** with default settings and positions.
- The wizard shows a **preview** first. After confirmation everything is created in **one database transaction**: if anything fails, nothing is created. The source AY is never changed, and each AY can be set up only once.
- **Carry-over** creates one `carry_over` ledger entry per fund, labelled *"Remaining balance from &lt;Fund&gt; AY &lt;year&gt;"*, which counts toward the new fund's balance.
- **Promoted students** move up one year level. Students in the last year level are not copied. Each promoted student gets a new QR token and is marked as needing confirmation: the database refuses any payment for them until staff confirm their course, year and section.

## Funds, charges and the ledger

The adviser creates funds. Each fund has a name, an amount per student, mandatory or optional, confidential or not, year levels, programs (all or some) and notes. Every active member can see the funds list, except confidential funds, which only positions allowed to see them can see.

- **Charges.** Each student gets one charge per fund that applies to them. A fund applies when it is active, the student is active with a confirmed course/year/section, and their year level and program match. One sync engine (`apps/api/src/modules/funds/charges.ts`) keeps charges correct:
  - **when a fund is created or edited:** students it now applies to are charged;
  - **when a student is added, approved, imported, confirmed, reactivated or moved to another year or program:** their charges are recalculated.

  Charges that no longer apply are cancelled only if nothing was paid on them. Charges with payments always stay. Pending, deactivated and unconfirmed students are never touched.
- **Amount lock.** A fund's amount can be edited (and every charge follows) only until the first payment touches the fund. After that, both the API and a database trigger refuse the change, for everyone.
- **Priority order.** On the Funds page, drag funds (or use the arrows) into the order payments should fill them.
- **Ledger.** A fund's **balance is the sum of its ledger entries**: collection, usage, carry_over, adjustment and void. Entries are append-only. The adviser can record an *adjustment* with a reason; it can't take the fund below its available balance.
- **Free to request** is the balance minus what approved-but-not-yet-liquidated requests have reserved (see *Fund requests and liquidation*). It is only shown while something is reserved; otherwise it equals the balance, so the screens show the balance alone.
- **Deactivating a fund** removes its unpaid charges. It is only possible while nobody has paid into it.
- **Clearance.** A student is **Cleared** when every *mandatory* charge is fully paid. Optional funds never block clearance.
- **Confidential funds** are left out of fund lists, ledgers and details for anyone without the "See confidential funds" permission; to them a confidential fund looks like it doesn't exist. On a student's charges it shows as "Restricted fund", with the amounts but no name.

## Collection, receipts and the QR status page

**Recording a payment** (Collection page; collectors and the adviser):

1. Find the student. Promoted students must first have their course/year/section confirmed; the dialog opens on its own.
2. Enter the amount received. The split across funds follows the AY's **allocation mode**:
   - **Hybrid** (default): pre-filled in fund priority order, and staff can change it. For example, ₱50 goes all to Student Fee, and ₱400 leaves ₱100 on Student Fee.
   - **Priority only:** always in priority order.
   - **Staff chooses:** staff enter the split.
3. The split must add up exactly to the amount. With *partial payments* off, each fund in the split must be paid in full. A payment can never exceed the remaining balance.

The API re-checks everything inside one transaction. The student's row is locked, so two collectors can't overpay the same student at the same moment, and a retried submission (same form key) returns the first payment instead of recording it twice.

**Each payment creates:**

- one allocation per fund;
- one `collection` ledger entry per fund;
- snapshots of the student's name, number and course/year/section;
- a snapshot of the name and position of the person who processed it;
- an audit entry.

The student turns **Cleared** automatically once every mandatory fund is paid.

**Transaction numbers** are `YYYY-MM-DD-####`. The date is in the AY's time zone. The counter runs for the whole academic year (it never resets daily) and comes from a locked `ay_counters` row, so numbers are never duplicated or skipped.

**The digital receipt** (GCash-style, phone-friendly) shows the organization, the amount, the student, the split with what's left on each fund, the remaining balance, the status QR and its message, "Processed by", and the transaction no., AY and date/time. It can be:

- downloaded as an image or PDF (a compressed one-page PDF the size of the receipt);
- printed: the receipt is printed from that same image, about 10 cm wide, so the printout matches the download exactly (colors included, no app menu);
- emailed to the student (or another address), with the QR attached.

Confidential funds always appear on receipts as "Restricted fee".

**Voiding:** payments are never edited or deleted. The adviser can **void** a payment with a reason. The payment stays on record as voided, and a reversing `void` ledger entry is added for each fund. Voiding is refused if it would take a fund below zero, because that money has already been used.

**The status QR** links to `/verify/<token>`: a random token for each student in each AY, never the student number. Scanning it (camera at `/scan`, no login) shows only:

- the student's name;
- **Cleared** (green) or **Has Balance** (red);
- what's paid and not yet paid, if the adviser left that on in Settings → Public QR page (confidential funds are merged into one "Restricted fee" line);
- optionally, their course/year/section.

The endpoint is rate-limited. Staff can **replace** a student's QR (e.g. a lost receipt), which makes older receipts' QR codes stop working. The camera needs https or localhost; on other addresses, paste the link instead.

## Fund requests and liquidation

Positions with *File fund requests* (Settings → Positions) can ask to use money from a fund.

1. **Filing.** The requestor's name and designation are filled in. They choose the fund, amount, purpose and date of use, and attach the physically approved request (photos and/or PDFs, several at once; required unless the adviser turns that off in Settings → Fund usage). The date of use must be **today or later** (checked in the AY's time zone by the form and the API). The amount can't exceed what the fund has **free to request**. Requests are numbered `FR-####` per AY.
2. **Approval.** The approvers are the adviser plus the AY's extra approvers (Settings → Approvals). An extra approver never approves their own request. The **adviser can approve their own requests and receipts**; such approvals are marked **Self-approved** on the request, in the approvals list and in the audit log (`selfApproved: true`), and nobody is notified about their own actions. Under the all-required rule, the other approvers still have to approve. The rule is **any one** or **all required**; it is copied onto the request when it is filed, so later setting changes don't affect it. For a confidential fund, only approvers who may see confidential funds are asked. An approver can approve or reject (with an optional comment).
   - On final approval the amount is **reserved**: the balance doesn't change, but the available balance drops. The API re-checks the available balance at that moment, so approved requests together can never exceed the fund.
   - The adviser can cancel an approved request (with a reason), which frees the reservation.
3. **Liquidation.** After using the money, the requestor submits the receipt: the amount actually used, remarks and the receipt files.
   - The approvers review it. They can approve it or ask for a revision with a comment. Each resubmission is a new version, and every version is kept.
   - A receipt above the approved amount needs the approver to accept the overage explicitly.
   - **Only when a receipt is approved** is a `usage` ledger entry written, for the amount actually used, and the request becomes **Cleared**. Example: ₱250 approved, ₱230 used → the fund goes down by ₱230 and the ₱250 reservation ends.

- **To approve.** The "To approve" tab and the *Fund requests* menu item show how many requests and receipts are waiting for your decision (refreshed every minute).
- **Archiving.** A finished request (cleared, rejected or canceled) can be archived by its requestor or the adviser. It leaves the request lists for everyone and moves to the **Archived** tab; nothing is deleted, the ledger is untouched, and it can be unarchived. Both actions are audited, and a database CHECK refuses an archived request that isn't finished.

**Attachments** open in their own tab. Every photo and every PDF page (drawn with pdf.js, so PDFs also show on phones) appears one per page in the order attached, and **Print all** prints them the same way. They are served only to the requestor, the approvers and the adviser. Everyone involved is notified at each step (see *Notifications and email*).

## Students

Collectors (positions with *Collect payments*) and the adviser manage the student list of the selected AY. Students are never deleted: they are deactivated, and rejected self-enrollments stay on record.

- **The list** can be sorted by name (A–Z or Z–A) or by student number (lowest or highest first).
- **Names** are shown as first name, middle initial(s), last name and suffix. A compound middle name keeps one initial per word: "Dela Cruz" → **DC.**, "del Rosario" → **DR.**, "Bautista" → **B.** Names already printed on receipts keep the form they had.
- **Add manually**: the student is active at once and gets a QR status token.
- **Import CSV**: upload a file with the columns `student_number, last_name, first_name, middle_name, suffix, program, year_level, section, email, contact_no`. Headers are matched case-insensitively, common alternatives (e.g. "Student No", "Surname") work, and semicolon-separated files from Excel work too. A **preview** marks every row as ready, similar name, same name or error. Confirming imports the allowed rows in one transaction.
- **Self-enrollment QR**: staff create a link (optional label, expiry and use limit) and share its QR code. Students fill in a public form at `/enroll/<token>` and agree to the privacy notice. Each submission waits as **pending** until staff approve or reject it. Submissions are rate-limited.
- **Promoted students** copied by the Copy Wizard appear under *Needs confirmation* until staff confirm their course, year and section.

### Duplicate rules

| Case | What happens |
|------|--------------|
| Same student number in the same AY (ignoring spaces and case) | Always refused |
| Same full name, different student number | Warning. Only the **adviser** can save it, with a reason, which is stored with the student |
| Similar name (same first and last name, different middle name) | Warning. Staff can save after confirming it's a different person |

Names are compared in normalized form: lowercase, no spaces or punctuation, accents removed (ñ → n). The comparison uses the separate name fields, so "Gadiana, Jhon Ezekiel B." and "Jhon Ezekiel B. Gadiana" match. Same-name students stay listed under **Possible duplicates**; reviewed ones are marked as such. The seed includes 1001 and 1002 "Jhon Ezekiel B. Gadiana" as an example.

## Settings

Settings belong to one AY and are adviser-only. Each card saves separately after a confirmation, and the audit log records only the fields that changed.

Sections: organization (with logo), year levels, programs and sections, positions and what each may do (file requests, collect, see confidential funds), collection (partial payments, allocation mode), approval rules and extra approvers, receipts (with a separate optional logo), fund usage, the public QR page, reports, email sender, security, file uploads, locale and the data-privacy notice.

- A new privacy-notice text starts a new version.
- Positions, programs and sections that are in use can only be deactivated, not deleted.
- Fund priority order is set on the Funds page, and email wording and events under Settings → Email & notifications. Two-factor sign-in arrives in Phase 9.

## Uploaded files

Files go through a storage interface (`apps/api/src/lib/storage.ts`). Today it writes to the local disk, and it can be swapped for S3 without changing the rest of the app. Every upload is:

- **typed by its first bytes**, never by its name;
- **size-limited** by the AY's setting;
- **stored under a random name** (`<ay>/<year>/<uuid>.<ext>`), never overwritten;
- **served back** with `nosniff` and a sandboxing Content-Security-Policy.

Logos are public on purpose, because they appear on the login page and on receipts. There is no antivirus scan yet.

## Dashboard, histories and reports

**Dashboard** (every active member): money collected (and the share of what was charged), still to collect, used, and the balance (with what's free to request while requests hold money); students cleared vs with balance; what's waiting for you (requests and receipts to approve, self-enrollments, students to confirm, accounts, failed emails); the latest payments (collectors); a table of every fund; and charts: collections over time (last 30 or 90 days per day, 12 months or the whole AY per month), collected vs still to collect per fund and by program / year / section, and usage by fund. Money figures leave out confidential funds for positions that may not see them (the page says so); clearance counts are per student and include every fund. The chart library loads separately, so other pages don't wait for it.

**Transaction history** (two tabs, filters kept in the address so a filtered list can be shared):

- **Collection history** (collectors and the adviser): transaction no., date and time, student, course/year/section (as it was), amount, balance after, posted/voided, processed by. Filters: dates (Manila calendar days), search, program, year, section, status, staff. Totals count posted payments only.
- **Use-of-fund history** (the adviser and extra approvers see every request; positions that file requests see their own): request no., requestor and position, fund, amount and amount actually used, filed, date of use, approved (and by whom), receipt submitted, receipt approved (and by whom), status. Filters: dates filed, search, fund, status.

Both have **Print / PDF** and **Export CSV** with the same filters.

**Reports** (Reports page; also *Statement* on a student's page and *Report* on a fund's page): collection report, fund usage report, per-fund report (ledger with running balance and who still owes), student statement of account, and the cleared / has-balance list. Every report is one document built by the API (`ReportDoc` in `packages/shared/src/reports.ts`), so the printed page, the PDF and the CSV always agree. Reports carry the organization's logo, names and header text, and the *Prepared by* / *Noted by* signatories (Prepared by defaults to the person printing), and print on the AY's paper size (A4, Letter or Legal; wide tables print landscape). PDFs have repeated table headers and page numbers; their amounts read "PHP" because the built-in PDF fonts have no peso sign. CSV exports hold the report's main table, with plain amounts so spreadsheets read them as numbers. Reports list up to 5,000 rows (the totals always cover everything). Restricted funds appear as "Restricted fund(s)" or are left out, as on receipts.

**Running a second copy beside your dev server** (e.g. on the test database): `WEB_PORT` and `VITE_API_PROXY` move the web app and its API proxy (with `API_PORT` and `WEB_URL` for the API), for example `WEB_PORT=5180 VITE_API_PROXY=http://localhost:4100 API_PORT=4100 WEB_URL=http://localhost:5180`.

## Notifications and email

Every message the app sends is an **event** in one catalog (`packages/shared/src/notifications.ts`): who receives it, whether it can send an in-app notice and/or an email, its placeholders and its default wording. The API sends every event through one function (`apps/api/src/lib/events.ts`), which applies the selected AY's choices.

**Settings → Email & notifications** (adviser, per AY):

- **Email sender:** sender name, sender email and reply-to, used for every email of the AY. Without them the server's `MAIL_FROM` is used. Some mail servers only accept their own address as the sender; then leave the sender email empty and set a reply-to.
- **Events that notify:** an In-app switch (the bell and the Notifications page) and an Email switch for each event. Verification and password-reset emails are always sent. For the *Digital receipt*, the Email switch means "email the receipt automatically after each payment" to students with an email on file (off by default); staff can always email a receipt from the receipt page.
- **Wording:** each event's subject (also the notice title), in-app notice line, email text and button label can be edited, with clickable placeholders such as `{{requestNo}}` and a live preview with example details. Unknown placeholders are refused. A paragraph whose placeholders are all empty (for example, no comment was given) is left out. Everything people type is HTML-escaped. "Default wording" removes the edits; only edits are stored.
- **Delivery:** shows the sender in use, warns when no mail server (`SMTP_HOST`) is configured, and sends a **test email**.
- **Sent emails:** every email of the AY with its status (Sent / Will retry / Failed), attempts and last error. Its text can be viewed, and a failed one can be sent again.

| Event | To | In-app | Email |
|---|---|---|---|
| Email verification, password reset | the person | — | always |
| New account waiting for approval | the adviser | on | on |
| Account approved / not approved | the person | on | on |
| Student self-enrolled | the adviser and collectors | on | off |
| New fund request; liquidation receipt submitted | the approvers | on | on |
| Request approved / rejected / canceled; receipt approved / sent back | the requestor | on | on |
| Digital receipt | the student | — | off (automatic sending) |

Nobody is notified about something they did themself (for example, the adviser approving their own request).

**Delivery and retries:** every email is first recorded in `email_outbox`, then sent. A failed email is tried again after 1 minute, 5 minutes, 30 minutes and 2 hours (a background worker checks every 30 seconds), then marked failed. Emails with one-time links (their text is never stored) and emails with attachments (receipts) can't be re-sent from the outbox: they are marked failed at once and are sent again from where they started.

**Notification center:** the bell in the header shows the unread count and the latest notices. The Notifications page lists them all by day, with All / Unread tabs, mark read or unread, mark all as read, and older pages on demand.

## Security notes

**Signing in**
- Passwords are hashed with Argon2id. Five wrong passwords (or wrong two-factor codes) lock the account for 15 minutes. Unknown emails take as long to refuse as wrong passwords.
- **Two-factor sign-in** (Settings → Security: off, optional or required per AY; members set it up in Profile): a 6-digit code from an authenticator app (TOTP, RFC 6238) after the password. A code is accepted once only; 8 one-time recovery codes (stored as hashes) cover a lost phone. Secrets are encrypted at rest (AES-256-GCM, key derived from `JWT_SECRET`, so changing `JWT_SECRET` means everyone sets two-factor up again). An adviser can only require it after turning it on for themself; members without it then see only the setup until they do it.
- Sessions are stored server-side (revocable, idle timeout per AY). The JWT access token lives 15 minutes in an httpOnly cookie; the refresh cookie is only sent to `/api/auth` and **changes on every refresh**. A replaced refresh token that comes back after 30 seconds means it was copied: the session is ended and the audit log says so.
- Verification and reset links are single-use, expire (24 h / 1 h) and are stored only as SHA-256 hashes; their text is never kept in the outbox or, in production, the logs. Forgot-password and resend-verification give the same answer whether or not the email exists.

**Requests**
- CSRF: double-submit token (`sft_csrf` cookie echoed in `X-CSRF-Token`) on every state-changing request; cookies are SameSite=Lax and, in production, https-only.
- Rate limits on the whole API, plus stricter ones on login, two-factor, signup and email-sending endpoints, and on the public QR and enrollment pages.
- Every request body and query is validated with Zod; database queries are parameterized (no string-built SQL).
- Permissions are checked by the API on every route; an automated sweep calls every route in the code without a session and as a member with no permissions (`test/access.test.ts`).
- Headers (helmet): a strict Content-Security-Policy (only this site's scripts, no framing), HSTS, `nosniff`, `Referrer-Policy: no-referrer`, and a Permissions-Policy that allows only the camera.

**Data**
- Uploads are typed by their first bytes, size-limited, stored under random names outside the web root, and served with a sandboxing CSP. PDFs are shown with pdf.js with script evaluation off.
- CSV exports put an apostrophe before text that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`), since names come from the public enrollment form.
- Email templates and everything people type are HTML-escaped; the email preview runs in a sandboxed frame.

**Dependencies** (`npm audit`, checked in Phase 9): jspdf 4.2, jspdf-autotable 5, nodemailer 10, zod 4 and vitest 5 fix every advisory that reaches the app. Two remain and are accepted: `deepmerge-ts` inside the Prisma command-line tool (used only to merge Prisma's own config files, never user input; the fix needs Prisma 7) and esbuild 0.27 inside tsup (the advisory concerns esbuild's dev server, which tsup doesn't run). Re-check with `npm audit` before each release.

## Migrations

The schema lives in `apps/api/prisma/schema.prisma`. Each migration has two parts:

1. **SQL generated by Prisma** from the schema: tables, enums, indexes and foreign keys.
2. **A hand-written section** for what Prisma can't express: CHECK constraints, partial unique indexes, append-only triggers, payment and fund-amount guards, and the derived views `v_charge_balances`, `v_student_clearance` and `v_fund_balances`.

To add a migration after editing `schema.prisma`:

```bash
cd apps/api
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://postgres:PASSWORD@localhost:5432/fundtracker_shadow" --script
```

Save the output as `prisma/migrations/<timestamp>_<name>/migration.sql`, add any hand-written SQL the change needs, and apply it with `npm run db:migrate`.

Before applying, read the generated SQL and make sure it doesn't drop any hand-written object: the partial unique indexes `ux_ay_single_current`, `ux_one_active_adviser`, `ux_students_ay_number`, `ux_one_active_qr_per_student`, `ux_liq_one_live` and `ux_ledger_one_carry_over`, the `ck_*` constraints, the triggers and the `v_*` views. Prisma currently leaves them alone (a diff of the Phase 1 database against `schema.prisma` is empty), but check anyway.

## Testing

```bash
npm test
```

The tests use a real PostgreSQL database named in `apps/api/.env.test` (`fundtracker_test`). Each run first applies any pending migrations to it (`prisma migrate deploy`, creating the database if needed). Each test then **empties every table** in that database before it runs. The suite refuses to start if the database name doesn't contain `test`.

Phase 9 adds:
- **Access sweep:** every route found in the code refuses requests without a session (only the sign-in steps and public pages answer) and refuses a member with no permissions where a permission is needed; state changes need the CSRF token.
- **Two-factor:** the RFC 6238 test values, encrypted secrets, the setup, code reuse refused, recovery codes once each, lockout after wrong codes, expired challenges, "required" per AY, turning it off.
- **Sessions:** refresh-token rotation, the grace for parallel tabs, and ending the session when an old token comes back.
- **Headers and exports:** security headers, formula-safe CSV.

Phase 8 adds:
- **Collection history:** snapshot details, posted-only totals, filters by search, program, status, staff and Manila calendar dates, paging, collect-only access.
- **Collection report:** per fund, day and staff; restricted funds merged for those who may not see them; signatories, header and paper size.
- **Use-of-fund history and usage report:** every date and name of a request's life, used amounts; requestors see only their own, others nothing.
- **Per-fund report:** running balance, opening balance for a later period, who still owes; confidential funds hidden.
- **Statement and clearance list:** masked restricted charges, payment splits, cleared / has-balance counts and filters.
- **Dashboard:** totals and charts for the adviser vs. a position that can't see confidential funds.

Phase 7 adds:
- **Templates:** placeholders, empty paragraphs left out, every event's default wording valid.
- **Switches:** in-app and email per event, security emails always on, adviser-only, audited.
- **Wording:** edited text used in emails and notices, HTML escaped, unknown placeholders refused, reset to default; sender name, address and reply-to.
- **Delivery:** retries with back-off and giving up, one-time links never stored or re-sent, the sent-email log and manual retry, the test email.
- **Receipts** emailed automatically only when turned on; **notification paging** without gaps for notices sent at the same moment.

Fixes after Phase 6 add: student sorting, compound middle initials, date of use not in the past (including late evening "today" in Manila), the to-approve count, archiving (who may, which statuses, hidden from lists, unarchive, audit, database CHECK).

Phase 6 adds:
- **Filing:** who may file, required attachments, amounts above the available balance refused.
- **Approval:** reservation without touching the balance, approved requests never exceeding the fund, rejection, the all-required rule, no self-approval by extra approvers, adviser self-approval of requests and receipts (marked in the request and audit log, no self-notifications, other approvers still needed under all-required), adviser-only cancellation.
- **Liquidation:** only the amount actually used is deducted, and only on approval; over-amount receipts need explicit acceptance; revisions keep every version; only the requestor submits, only for approved requests.
- **Privacy:** attachments visible only to the requestor, approvers and adviser; confidential-fund requests hidden from approvers who can't see them; read-only in a closed AY.

Phase 5 adds:
- **Allocation rules:** the spec's examples, the no-partial mode, and invalid splits.
- **Transaction numbers:** format, local date, one AY-wide counter with no duplicates under concurrent payments.
- **Recording payments:** ledger entries, snapshots and clearance.
- **Safety:** overpayment refused, including two simultaneous payments for one student; idempotent retries.
- **Settings and access:** allocation-mode settings; confirmation, closed-AY and permission checks.
- **Voids:** adviser-only, reversing entries, balances restored, payment kept.
- **Emailed receipts** with the QR attached.
- **Public status page:** contents with confidential funds merged, settings respected, QR replacement.

Phase 4 adds:
- **Money:** peso parsing to centavos with no floating-point errors.
- **Charge generation:** only matching active students are charged; students added, approved, imported, confirmed or reactivated later are charged too.
- **Re-syncing** on year-level, program and fund-scope changes; paid charges are kept and cancelled ones are re-activated.
- **Amount lock:** the API and the database both refuse a change after the first payment.
- **Fund management:** priority reorder, deactivation rules.
- **Ledger:** balance equals the ledger, append-only, adjustments limited to the available balance.
- **Clearance:** decided by mandatory funds only.
- **Confidentiality:** hidden, masked, revealed by the exemption, and isolated per AY.

Phase 3 adds:
- **Name normalization and CSV parsing** (unit tests).
- **Adding students:** QR token, permissions, number uniqueness, the three duplicate rules including adviser-only overrides, valid program/year checks, closed-AY block.
- **Editing:** duplicates re-checked, deactivate and reactivate, confirming a promoted student's course/year/section, AY isolation.
- **Self-enrollment:** pending records, notifications, consent, use limits and revocation, duplicate rules on approval, rejections kept on record.
- **CSV import:** preview statuses, default and override imports, header aliases, missing-column errors.

Phase 2 adds:
- **Settings:** adviser-only, validation, auditing of changed fields, privacy-notice versions, password rules taking effect at once, read-only in a closed AY.
- **Logo uploads:** file type checked by content, random names, size limit, public serving.
- **Programs, sections and positions:** duplicates refused, in-use items protected, permission changes applied.
- **Approvers.**
- **Academic years:** create, make current, close and reopen.
- **Copy Wizard:** preview, full copy with carry-over and promotion, source left untouched, start fresh, option dependencies, authorization, all-or-nothing rollback, and no payments before a promoted student is confirmed.

Phase 1 covers: first signup becomes adviser (including simultaneous signups), the pending → approved/rejected flow, email verification, account lockout, logout, password reset, CSRF, AY isolation (scoped client and database foreign keys), closed AY read-only, audit trail contents and immutability, and the schema's CHECK and unique guards.
