# Diviyata Saviyak — Runbook

2026-10-11 · Phase 9 (task 9.8)

How the system runs on its server, how it gets there, and what to do when something goes wrong. The design is in [SPEC section 11](SPEC.md#11-hosting-and-operations) and [PLAN Phase 9](PLAN.md#phase-9--go-live).

## What runs where

```
 Office browsers ──HTTPS──► EC2 server (ap-south-1, Ubuntu 24.04, Elastic IP, domain name)
                             └─ Docker Compose, /opt/diviyata
                                ├─ proxy   Caddy: TLS certificate, HTTP → HTTPS, 20 MB bodies
                                ├─ app     Next.js (the app image), as diviyata_app
                                ├─ db      PostgreSQL 17, no published port
                                └─ tools   migrations, seed and scripts (the tools image), run on demand
 GitHub ──push to main──► CI ──► images in ghcr.io ──SSH──► deploy.sh on the server
 Server ──nightly, encrypted──► S3 bucket (restic, 30 days)
 Server ──every 5 minutes──► healthchecks.io ──email──► Head Office's contact
```

| On the server | What it is |
| --- | --- |
| `/opt/diviyata/.env` | Settings and secrets (SEC-9). Only `deploy` and root can read it. Never copy it anywhere but the Ministry's safe. |
| `/opt/diviyata/release.env`, `previous.env` | The images of the running release and the one before, and the backup taken just before the running release went in. |
| `/opt/diviyata/backups/` | The database just before each of the last 5 deploys. |
| `/opt/diviyata/deploys.log` | One line per deploy and rollback. |
| `/etc/cron.d/diviyata` | The 5-minute check, the nightly backup and the monthly restore test. |
| Docker volumes `diviyata_dbdata`, `diviyata_files` | The database and the uploaded files. |

The server scripts live in the repository's `deploy/` folder and are copied to `/opt/diviyata` on every deploy. Run them as the user shown; `sudo -iu deploy` becomes the deploy user.

## First setup

Do these once, in this order. Until the domain name arrives, a temporary address works the same way (PLAN, "Waiting on others").

**The short way.** After the AWS steps (step 1), `deploy/ops.sh` does steps 2 to 6 from your own computer, in Git Bash, with the GitHub CLI signed in (`gh auth login`). [`deploy/README.md`](../deploy/README.md) lists all its commands, for every day as well:

```bash
cp deploy/settings.example.env deploy/settings.env   # then fill it in
bash deploy/ops.sh setup          # healthchecks.io, the server, GitHub, the first deploy, a backup, the admin
bash deploy/ops.sh create-admin   # the first admin, if setup didn't make one
bash deploy/ops.sh launch         # launch day (9.13), once the Ministry has agreed
```

`setup` is safe to run again. With `DOMAIN` empty it uses `<elastic-ip-with-dashes>.sslip.io`, which needs no DNS. It passes the deploy key from the server straight to GitHub, so the key never lands on your computer, and it shows `RESTIC_PASSWORD` at the end, for paper or the Ministry's password safe. The steps below are what the scripts do, for doing them by hand.

### 1. AWS

All in the Mumbai region, `ap-south-1` (OPS-2).

1. **S3 bucket** for the backups, for example `diviyata-backups-<account id>`:
   - Block all public access (on by default). Default encryption SSE-S3. No versioning, no object lock: restic removes old snapshots itself.
   - A lifecycle rule that aborts incomplete multipart uploads after 7 days.
2. **IAM role** `diviyata-server`, trusted by EC2, with only this policy (SEC-10: only the server can write to the bucket):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"], "Resource": "arn:aws:s3:::BUCKET" },
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::BUCKET/*" }
     ]
   }
   ```

3. **Security group** `diviyata`: inbound TCP 22, 80 and 443 from anywhere, and UDP 443 from anywhere. Nothing else. SSH is open to all because GitHub's runners have no fixed address; the server accepts keys only, and the deploy key can only run commands.
4. **EC2 instance**: Ubuntu Server 24.04 LTS, `t3.medium` (PRF-5), a 100 GB gp3 root volume, the security group, the IAM role, and an SSH key pair for the administrators. Under Advanced details: metadata version **V2 only**, and termination protection on.
5. **Elastic IP**, attached to the instance.
6. **DNS**: an `A` record for the domain name pointing at the Elastic IP (from the Ministry or ICTA).

### 2. healthchecks.io (OPS-4)

Make a project for the system with three checks, each in the Asia/Colombo time zone, and give the email integration to Head Office's contact:

| Check | Schedule | Grace time |
| --- | --- | --- |
| `monitor` | every 5 minutes (simple period) | 10 minutes |
| `backup` | cron `30 1 * * *` | 1 hour |
| `restore test` | cron `30 2 1 * *` | 2 hours |

Keep each check's ping URL for the next step. The service receives only short status lines ("backup done", "the disk is 85% full"), never case data.

### 3. The server

From a checkout of the repository on your own computer:

```bash
scp -r deploy/server ubuntu@<elastic ip>:diviyata-setup
ssh ubuntu@<elastic ip>
sudo bash diviyata-setup/server-setup.sh --domain <domain> --email <ops email> \
  --backups s3:s3.ap-south-1.amazonaws.com/<bucket>/diviyata
```

The script is safe to run again (OPS-2). It prints what GitHub needs. Then add the alert URLs:

```bash
sudo -u deploy nano /opt/diviyata/.env     # HC_MONITOR_URL, HC_BACKUP_URL, HC_RESTORE_URL
```

Write `RESTIC_PASSWORD` on paper or in the Ministry's password safe, and keep it off the server (SEC-10). Without it no backup can be read.

### 4. GitHub

In the repository's **Settings**:

1. **Secrets and variables → Actions → Variables → New repository variable** `DEPLOY_HOST`: the domain name (the same name the known-hosts line starts with). It must be a repository variable, not the environment's: the deploy job checks it before it enters the environment, and skips itself, green, when it sees none.
2. **Environments → New environment** `production`:
   - secret `DEPLOY_SSH_KEY`: the output of `sudo cat /home/deploy/.ssh/github-actions` on the server, then remove it there with `sudo shred -u /home/deploy/.ssh/github-actions`
   - secret `DEPLOY_KNOWN_HOSTS`: the line `server-setup.sh` printed
   - optionally, required reviewers, if a person should approve each deploy
3. **Branches → Branch protection** for `main`: require a pull request, and the `CI` checks (`server-files` and `check`) to pass.
4. **Actions → General → Workflow permissions**: read repository contents (the workflows ask for `packages: write` themselves).

The images go to `ghcr.io/<owner>/diviyata-app` and `diviyata-tools`. They stay private; the deploy job's own token lets the server pull them.

### 5. The first deploy

Merge a pull request into `main`, or run **Actions → Deploy → Run workflow**. The run takes about 15 minutes: CI, the images, then the deploy. Watch it, then open `https://<domain>/health`, which answers `{"ok":true}`.

### 6. The first admin (task 9.5)

```bash
sudo -iu deploy
/opt/diviyata/scripts/create-admin.sh --name "<name>" --mobile <07XXXXXXXX> --designation "<title>"
```

It prints a username and a temporary password once. Give them to the admin in person. The admin signs in, sets their own password, and creates the Head Office and DS office accounts on the users screen. The account's history says the system created it.

### 7. Email for forgotten passwords (AUTH-7)

Officers reset a forgotten password with a code sent by email to the address in their account (the admin fills in "ඊමේල් (අවශ්‍ය නම් පමණි)" on the account form). The app sends through any mail service that speaks SMTP. Until one is set, the page for a forgotten password tells officers to call the admin, who gives a new password on the users screen.

The simplest is a Gmail account the Ministry owns. It is free and sends up to about 500 emails a day.

1. Sign in to the account, turn on 2-Step Verification, then make an app password at https://myaccount.google.com/apppasswords (name it "Diviyata"). Google shows its 16 letters once.
2. Put these in `/opt/diviyata/.env` (a `.env` made before 14 Oct 2026 doesn't have the lines yet; add them):

   ```bash
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=<the account>@gmail.com
   SMTP_PASSWORD=<the 16 letters, without spaces>
   MAIL_FROM=<the account>@gmail.com
   ```

3. Restart the app with them: `dc up -d --wait app`.
4. Test it: give your own account an email address on the users screen, then on the sign-in page choose "මුරපදය අමතකද?" and give your username. The email should arrive within a minute; look in spam too. If it doesn't, `dc logs --since 10m app` shows `email_failed` with an error code, never the address or the email: `EAUTH` is a wrong user or app password, `ECONNECTION` or `ETIMEDOUT` a mail server the app can't reach.

Another service works the same way with its own SMTP settings: Amazon SES (part of AWS, so no third party sees the addresses, STK-2; about US$0.10 per 1,000 emails; it needs a verified domain and production access first) or Brevo (free for 300 emails a day). Port 465 speaks TLS from the start; with 587 the app insists on switching to TLS (STARTTLS). An account gets at most 5 codes a day (SEC-4).

## Everyday

Everything below runs on the server as the deploy user (`sudo -iu deploy`), unless it says root. The deploy user's shell starts in `/opt/diviyata` and has `dc` for `docker compose` with the server's two env files.

| To | Run |
| --- | --- |
| See the containers | `dc ps` |
| Read the app's log | `dc logs --since 1h app` |
| See what is deployed | `cat release.env`, `tail deploys.log` |
| See the scheduled jobs' output | `journalctl -t diviyata-monitor -t diviyata-backup -t diviyata-restore-test --since today` |
| Open the database as the owner | `dc exec db psql -U diviyata diviyata` |
| Run a script of the tools image | `dc run --rm tools npx tsx scripts/<script>.ts` |
| Add 5,000 made-up cases, or remove them (staging only) | `dc run --rm tools npx tsx scripts/seed-load.ts`, add `--remove` |
| Add demo cases, or remove them (staging only) | `dc run --rm tools npx tsx scripts/seed-demo.ts`, add `--remove` |

The app's log holds ids, never names, NICs, addresses or phone numbers (SEC-8).

### How a deploy works (OPS-3)

`deploy.yml` runs `ci.yml`, builds the app and tools images tagged with the commit, copies `deploy/server/compose.yml`, `deploy/server/caddy/` and `deploy/server/scripts/` to the server, and runs `scripts/deploy.sh <app image> <tools image>` there. `deploy.sh`:

1. pulls the images and backs up the database into `backups/` (the newest 5 are kept)
2. if the release brings migrations, stops the app (Caddy shows a maintenance page in three languages) and runs them
3. runs the lists seed, which only adds missing rows, and the grants (`scripts/db-grants.sql`)
4. starts the new app and waits up to 3 minutes for its health check

If any step fails, the previous release starts again; if a migration had started, the database is first put back from step 1's backup. Nothing is lost, because the app was stopped before the migration. The run in GitHub then fails, and its log says why. A page left open in an office reloads by itself at its next move, because each build carries its commit as its deployment id.

Deploys run one at a time. Two pushes in a row deploy in order.

### Rollback, by hand

```bash
/opt/diviyata/scripts/rollback.sh                    # the previous app; the database stays as it is
/opt/diviyata/scripts/rollback.sh --with-database    # also the database from just before the current release
```

Without `--with-database`, the rollback refuses if the running release added migrations the previous one doesn't know. `--with-database` loses every change made since the current release went in, so check `tail deploys.log` first. Running `rollback.sh` again goes forward again. The next push to `main` deploys as usual.

A bad release is better fixed with a new commit, or with **Actions → Deploy → Run workflow** on an older commit, than by rolling back.

## Backups and restore (SEC-10)

Every night at 01:30, `scripts/backup.sh` (as root) dumps the database and backs it up with the uploaded files into the S3 bucket with restic. restic encrypts on the server with `RESTIC_PASSWORD`. Snapshots older than 30 days are removed. On the 1st of each month at 02:30, `scripts/restore.sh --test` restores the latest snapshot into a scratch database and folder, checks it and removes it. Both report to healthchecks.io, which emails if one fails or doesn't report.

| To | Run, as root |
| --- | --- |
| Back up now | `sudo /opt/diviyata/scripts/backup.sh` |
| List the snapshots | `sudo /opt/diviyata/scripts/restore.sh --list` |
| Test a restore now | `sudo /opt/diviyata/scripts/restore.sh --test` |
| Restore everything | `sudo /opt/diviyata/scripts/restore.sh <snapshot id or latest> --yes` |

A full restore stops the app, puts the database and the uploaded files back as they were in the snapshot, and starts the app again. Every change since that snapshot is lost. To undo just the last deploy, use `rollback.sh --with-database` instead.

**AC-22 on the server:** note a case and one of its photos, run `backup.sh`, change the case and remove the photo's file from the volume, run `restore.sh latest --yes`, and check that the case and its photo are back.

## Moving to a new server

1. Set up the new server as in [First setup](#first-setup), steps 1 and 3, with the same bucket. Copy the old `.env` over the new one (`sudo -u deploy nano /opt/diviyata/.env`), so it has the same passwords and `RESTIC_PASSWORD`.
2. On the old server, stop the app (`dc stop app`) and run `sudo /opt/diviyata/scripts/backup.sh`.
3. In GitHub, change `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS`, and run **Actions → Deploy → Run workflow** on `main`.
4. On the new server, `sudo /opt/diviyata/scripts/restore.sh latest --yes`.
5. Move the Elastic IP to the new instance. Caddy gets a certificate within a minute.
6. Check `https://<domain>/health` and sign in. Then stop the old instance; delete it a week later.

## Secrets

All of them are in `/opt/diviyata/.env` (SEC-9). GitHub holds only the deploy key and the server's host key.

| Secret | To change it |
| --- | --- |
| `BETTER_AUTH_SECRET` | Set a new one (`openssl rand -hex 32`) and run the deploy again. Everyone is signed out. |
| `APP_DB_PASSWORD` | Set a new one and run the deploy again; the grants set the new password. |
| `DB_OWNER_PASSWORD` | `ALTER ROLE diviyata PASSWORD '<new>'` in psql, then set it in `.env`. |
| `RESTIC_PASSWORD` | `restic key add`, then `restic key remove` the old one, as root with the old value exported. Give the Ministry the new one. |
| `SMTP_PASSWORD` (the mail account's app password) | Make a new app password in the mail account and remove the old one, put it in `.env` and run `dc up -d --wait app`. |
| The deploy key | Run `server-setup.sh` after removing `/home/deploy/.ssh/github-actions.pub` and its line in `authorized_keys`, then update `DEPLOY_SSH_KEY`. |

## Upgrades

- **Ubuntu's security updates** install by themselves, rebooting at 03:30 when needed. Once a month, outside office hours: `sudo apt update && sudo apt upgrade`, which also updates Docker.
- **The app's dependencies** come through pull requests (STK-1); CI runs `npm audit` (SEC-12).
- **PostgreSQL, Caddy and Node** are pinned in `deploy/server/compose.yml` and `docker/Dockerfile`. A new minor version is a pull request changing the tag. A new PostgreSQL major version needs a dump and restore: plan it with a backup.

## Before launch (tasks 9.10 to 9.13)

Until launch the server runs as staging (`APP_ENV=staging`) with made-up data only (OPS-1). Real data goes in only after the Ministry agrees that it may be kept on AWS, outside Sri Lanka (PRD, "Hosting, storage and backups").

**9.10 Performance and accessibility.** Add the load-test data, then on an office connection: the dashboard within 2 seconds (PRF-3), pages within 1 second at the server (PRF-2; `docker compose logs app` has no timings, so use the browser's network panel), and the full Excel export under 60 seconds (PRF-4). Check UI-6 with the browser's accessibility checker on each screen. Remove the load-test data afterwards.

**9.11 Lists and languages.** Load the full DS office list with codes into `data/places.json` and check the Tamil names with the Ministry; Tamil- and English-speaking officers read every screen.

**9.12 Guides and a user test.** The guides are in [`docs/guides/`](guides/). A few officers try the main tasks on staging, reading only the guide.

**Every acceptance check on the server.** Run SPEC section 12 again on the server with made-up data, including AC-22 (above) and AC-29:

- AC-29: merge a small change; it reaches the server with no manual step, and a page left open from before reloads at its next click. Then, on a branch, make `src/app/health/route.ts` always answer 503, add an empty migration, and run **Actions → Deploy → Run workflow** on that branch: the run fails, the previous version runs again, and the migration is not in `_prisma_migrations`. Delete the branch.

**9.13 Launch day**, outside office hours:

1. Stop the app, and remove the made-up data and its backups:

   ```bash
   dc down
   docker volume rm diviyata_dbdata diviyata_files
   rm -f backups/*.dump
   ```

   Then delete the bucket's `diviyata` folder in the S3 console.

2. In `.env`: `APP_ENV=production`, and new `BETTER_AUTH_SECRET`, `DB_OWNER_PASSWORD`, `APP_DB_PASSWORD` and `RESTIC_PASSWORD` values (`openssl rand -hex 32`). Give the Ministry the new `RESTIC_PASSWORD`.
3. Run **Actions → Deploy → Run workflow** on `main`. The database starts empty, and the deploy adds the lists.
4. Run `sudo /opt/diviyata/scripts/backup.sh`, which starts the new backup repository, then `restore.sh --test`.
5. Create the first admin (step 6 of the first setup). The admin creates the Head Office and DS office accounts and hands them out.
6. Watch healthchecks.io and the app's log through the first week.
