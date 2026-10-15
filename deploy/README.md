# Running the live system

Everything about the live server is in this folder, and you run it all with **one command**, from your own computer:

```bash
bash deploy/ops.sh <command>
```

Run it in **Git Bash**, in the repository's folder. Typing just `ops.sh` doesn't work, because bash never looks in the current folder for commands. Better still, make the shortcut once (step 2 below), and then `ops status` works from any folder. You never need to log in to the server or remember a path on it. `bash deploy/ops.sh help` lists the commands. [`docs/RUNBOOK.md`](../docs/RUNBOOK.md) explains what happens underneath, if you ever need it.

## Before the first use (once per computer)

1. Install [Git for Windows](https://gitforwindows.org/), which gives you Git Bash, and the [GitHub CLI](https://cli.github.com/). Then sign in with `gh auth login`.
2. Make the shortcut: `bash deploy/ops.sh shortcut`, then close Git Bash and open it again. From now on, `ops <command>` is the same as `bash deploy/ops.sh <command>`.
3. Get the server's key file (`.pem`) from whoever set up AWS, and keep it out of this folder.
4. Copy the settings and fill them in:

   ```bash
   cp deploy/settings.example.env deploy/settings.env
   notepad deploy/settings.env
   ```

   `settings.env` is never committed. Each line in it says what goes there.

5. Check that it works: `ops status`.

## AWS, once (before `ops setup`)

All in the [AWS console](https://console.aws.amazon.com/), with the **region at the top right set to the server's region**: Mumbai (`ap-south-1`) or Singapore (`ap-southeast-1`). Put the same region in `AWS_REGION` in `settings.env`.

**1. The S3 bucket for the backups**

1. Open **S3**, then **Create bucket**. Choose **General purpose** and the **Global namespace**: the backup tool (restic) is known to work with this kind of bucket name, not yet with the newer account-regional one.
2. **Bucket name:** `diviyata-backups-<your 12-digit account id>`. Names must be unique across all of AWS and use only lowercase letters, digits and hyphens. Your account id is in the menu under your name at the top right.
3. Keep **Block all public access** ticked, **Bucket Versioning** disabled and the default encryption (SSE-S3). Then **Create bucket**.
4. Open the bucket, go to **Management**, then **Create lifecycle rule**:
   - name it `abort-incomplete-uploads`
   - choose **Apply to all objects in the bucket** and acknowledge the warning
   - tick **Delete expired object delete markers or incomplete multipart uploads**, then **Delete incomplete multipart uploads**, with **7** days
5. Put the bucket's name in `BACKUP_BUCKET` in `settings.env`.

**2. The IAM role, so the server can write to that bucket and nothing else**

This is a **role**, not an IAM user: the server gets short-lived keys from AWS by itself, so no access key is ever stored anywhere.

1. Open **IAM**, then **Roles** and **Create role**.
2. **Trusted entity type:** AWS service. **Use case:** EC2. Then **Next**.
3. Tick no policy on the permissions page, just **Next**. **Role name:** `diviyata-server`. Then **Create role**.
4. Open the new role, choose **Add permissions**, then **Create inline policy**, then **JSON**. Paste this, with your bucket's name in place of `BUCKET` (twice):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"], "Resource": "arn:aws:s3:::BUCKET" },
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::BUCKET/*" }
     ]
   }
   ```

5. **Next**, name it `diviyata-backups`, then **Create policy**.
6. Open **EC2**, then **Instances**, and select the server. Choose **Actions**, then **Security**, then **Modify IAM role**, choose `diviyata-server`, and **Update IAM role**.

**3. The firewall (security group)**

In **EC2**, open **Instances**, select the server, then **Security**. Click its security group, then **Edit inbound rules**, and keep exactly these four, each from `0.0.0.0/0`:

| Type | Port |
| --- | --- |
| SSH | 22 |
| HTTP | 80 |
| HTTPS | 443 |
| Custom UDP | 443 |

**4. A fixed address (Elastic IP)**

Without one, the server's address changes whenever it is stopped and started.

1. In **EC2**, open **Elastic IPs**, then **Allocate Elastic IP address**, then **Allocate**.
2. Select the new address, choose **Actions**, then **Associate Elastic IP address**, and choose the server.
3. The server now has this new address. Put it in `SERVER_IP` in `settings.env`.

Skip this if the instance already has an Elastic IP: one shows under **Elastic IPs** with the instance's name beside it.

**5. Check it:** `ops setup` starts by checking SSH, the role and the address. If something is missing, it stops before changing anything and says what to fix.

## The commands

### Once

| Command | When | What it does |
| --- | --- | --- |
| `setup` | After the AWS steps (RUNBOOK step 1), to bring up a new server | Sets up the server and GitHub, deploys, backs up, creates the admin and shows the backup password. Safe to run again. |
| `create-admin` | When there is no admin yet, or none can sign in (`--another`) | Creates an admin from `ADMIN_*` in `settings.env` and shows the username and temporary password once |
| `launch` | Launch day, outside office hours, after the Ministry has agreed in writing to keep the data on AWS | Wipes all made-up data and its backups, sets new secrets, switches to production, deploys, backs up and creates the real admin |

### Every day

| Command | When | What it does |
| --- | --- | --- |
| `status` | Any time; first thing when someone reports a problem | Shows whether the site is up, what is deployed, the disk, the containers, the last deploys and the last backup |
| `logs` | Something fails on a screen | Shows the app's log for the last hour. Variations: `logs proxy`, `logs app 24h`. The log holds ids only, never names or NICs. |
| `deploy` | To deploy again without a new push, for example after a failed run | Deploys `main` (or `deploy <branch>`) and waits for it, about 15 minutes |
| `ssh` | Rarely, for anything not listed here | Opens a shell on the server as the deploy user. `dc` is `docker compose`; `exit` leaves. |

**You don't deploy by hand.** Every push to `main` that passes the tests reaches the server by itself, in about 15 minutes. Watch it under the repository's **Actions** tab. A failed deploy puts the previous version back on its own.

A deploy replaces only the app's container, with the new version: the database keeps running and keeps its data, and the proxy (Caddy) is recreated only when its files changed. The server's settings in `/opt/diviyata/.env` are never touched by a deploy; change them with `env` below.

### Settings on the server

The server's settings and secrets live in `/opt/diviyata/.env`, on the server only, never in GitHub. `setup` made it: it generated the passwords and keys on the server, and filled in the rest from `settings.env`: the domain, the backups, the alerts and the email for forgotten passwords (the `SMTP_*` lines). After changing the `SMTP_*` lines in `settings.env`, send them with `env push`.

| Command | When | What it does |
| --- | --- | --- |
| `env show` | To check what the server has | Lists every setting, with passwords and keys hidden (`****abcd`) |
| `env push` | After changing the `SMTP_*` lines in `settings.env` | Sends those that have a value, then recreates the app so they take effect. Nothing else in `settings.env` (your key's path, healthchecks.io's key) is sent. |
| `env set KEY=VALUE` | To change one or two settings | Sends them (`KEY=` empties one), then recreates the app. The values stay in this computer's Git Bash history, so prefer `settings.env` and `env push` for passwords. |
| `restart` | After changing something by hand on the server, or when the app misbehaves | Recreates the app's container, so it reads `.env` again. `restart proxy`, `restart db` or `restart all` for the others. The site is down for a few seconds. |

The passwords and keys `setup` generated (`DB_OWNER_PASSWORD`, `APP_DB_PASSWORD`, `BETTER_AUTH_SECRET`, `RESTIC_PASSWORD`) and `APP_ENV` are refused: the database keeps the passwords it was first started with, and the backups can only be read with their own key. Only `launch` changes them. Each change keeps the old file as `/opt/diviyata/.env.previous`, and if the app doesn't come back with the new values, the old ones are put back.

### When something goes wrong

| Command | When | What it does |
| --- | --- | --- |
| `rollback` | A deploy went through but the new version is broken | Brings back the previous version. The database stays as it is. |
| `rollback --with-database` | The new version also changed the database badly | Also puts the database back as it was before that deploy. **Loses every change made since.** Asks first. |
| `backup` | Before something risky | Backs up into S3 now. This also runs by itself every night at 01:30. |
| `backups` | Before a restore | Lists the backups kept (the last 30 days) |
| `restore-test` | To be sure the backups can be read | Restores the latest backup into a scratch copy, checks it and removes it. The live site isn't touched. This also runs by itself on the 1st of each month. |
| `restore <id>` or `restore latest` | Data was lost or damaged | Puts the database and uploaded files back as in that backup. **Loses every change made since.** Asks first. |
| `clean` | The disk is filling up | Removes Docker images no container uses and Docker's build cache, and shows the disk before and after. The running version's and the previous version's images stay, for `rollback`; the database, the uploads and the certificate are never touched. |

### Staging only

| Command | What it does |
| --- | --- |
| `test-data demo` and `test-data demo --remove` | Add or remove 15 made-up cases per DS office, to try the screens |
| `test-data load` and `test-data load --remove` | Add or remove 5,000 made-up cases, for the speed checks (task 9.10) |

Both refuse once the server runs as production.

## If something happens

| What happened | What to do |
| --- | --- |
| An email from healthchecks.io: **monitor** | Run `status`. If the site is down, run `logs app` and `logs proxy`. If it went down right after a deploy, run `rollback`. |
| An email: **backup** or **restore test** | Run `backup` and read its error. A changed bucket or IAM role is the usual cause. |
| An email: **the disk is 80% full** or more | Run `clean`. If it's still full, make the EC2 volume bigger in AWS. |
| A push to `main` didn't reach the server | Open the failed run under **Actions**, fix the problem in a new commit, and push again |
| Officers see an error after a deploy | Run `rollback`, then fix the problem in a new commit |
| An officer forgot their password, or is locked out | Nothing here: the officer resets it with a code sent by email from the sign-in page ("මුරපදය අමතකද?"), or the admin gives a new one on the users screen |
| Officers say the email with the code never comes | Ask them to look in spam, and the admin to check the email address in their account. Then run `logs app` and look for `email_failed`: `EAUTH` means a wrong `SMTP_USER` or `SMTP_PASSWORD`, and a new app password is the usual fix. Fill them in `settings.env` and run `env push` (docs/RUNBOOK.md, "Email for forgotten passwords") |

## What's in this folder

The folders are named for **where their files run**:

```
deploy/
├── README.md              this guide
├── ops.sh                 the one command you run
├── settings.example.env   the settings' template; your copy is settings.env (never committed)
│
├── operator/              ON YOUR COMPUTER: ops.sh's parts
│   ├── setup.sh             ops setup
│   ├── launch.sh            ops launch
│   ├── create-admin.sh      ops create-admin
│   ├── env.sh               ops env
│   └── lib.sh               shared: settings, SSH, deploy, health and backup checks
│
└── ec2/                   ON THE SERVER
    ├── setup/               run once, as root, to prepare a new server (ops setup does it)
    │   ├── server-setup.sh    installs Docker, the deploy user and /opt/diviyata
    │   ├── cron               the timer: 5-minute check, nightly backup, monthly restore test
    │   └── env.example        the template of the server's settings (/opt/diviyata/.env)
    │
    └── stack/               copied to /opt/diviyata on every deploy
        ├── compose.yml        the running system: Caddy (HTTPS), the app, PostgreSQL
        ├── caddy/             Caddy's settings and the maintenance page
        └── scripts/           deploy, rollback, backup, restore, monitor, create-admin,
                               env, restart, clean
```

`stack/` is copied to the server on every deploy. GitHub Actions and the server's timer run its scripts by themselves; `ops.sh` runs them for you when you need one. So to change anything on the server, change it here and push: a change made on the server itself is overwritten by the next deploy. The one exception is `/opt/diviyata/.env`, which only `setup`, `env` and `launch` change.

Outside this folder: `docker/Dockerfile` builds the app's images, and `.github/workflows/` holds the tests (`ci.yml`) and the automatic deploy (`deploy.yml`). The `scripts/` folder at the repository's root holds development tools such as the demo data, not server scripts.

## Rules

- **Secrets stay on the server**, in `/opt/diviyata/.env`. Never copy them into the repository, a chat or an email.
- **`RESTIC_PASSWORD`** (shown at the end of `setup` and `launch`) belongs on paper or in the Ministry's password safe. Without it no backup can be read.
- **No real data before launch**, and never in the repository or its tests.
- **A change to the server goes through the repository**, never by editing files on the server. A deploy overwrites them.
