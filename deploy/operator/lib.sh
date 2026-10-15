# shellcheck shell=bash
# Shared by deploy/ops.sh and the scripts beside this file, which run on your own computer (Git Bash
# on Windows) and drive the server over SSH and GitHub through the gh CLI. Each one starts with
#   . "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
set -Eeuo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
SETTINGS=${SETTINGS:-$(cd "$HERE/.." && pwd)/settings.env}
# The settings in settings.env that belong in the server's .env; "ops setup" and "ops env push" send
# them. The rest of settings.env (SSH, GitHub, healthchecks.io's key) never leaves this computer.
SERVER_KEYS=(SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD MAIL_FROM)

step() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

need() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null ||
      die "$tool is missing. Run this in Git Bash with the GitHub CLI installed, or in WSL after: sudo apt install $tool"
  done
}

# Reads settings.env (CRLF line endings from Notepad are fine) and fills in the defaults.
load_settings() {
  [ -f "$SETTINGS" ] || die "copy deploy/settings.example.env to $SETTINGS and fill it in"
  # A key pasted in, rather than its file's path, would be read as commands.
  if grep -q "PRIVATE KEY" "$SETTINGS"; then
    die "settings.env holds a private key itself. SSH_KEY must be the path of the .pem file, for example
SSH_KEY=C:/Users/<you>/.ssh/diviyata.pem. Save the key in that file, and remove it from settings.env"
  fi
  # The server's settings are left out: a password may hold spaces, $ or #, and server_settings
  # reads them as written instead.
  # shellcheck disable=SC1090
  . <(tr -d '\r' <"$SETTINGS" | grep -Ev "^($(IFS='|' && echo "${SERVER_KEYS[*]}"))=")

  local key
  for key in SERVER_IP SSH_KEY; do
    [ -n "${!key:-}" ] || die "set $key in $SETTINGS"
  done
  SSH_USER=${SSH_USER:-ubuntu}
  DOMAIN=${DOMAIN:-${SERVER_IP//./-}.sslip.io}
  AWS_REGION=${AWS_REGION:-ap-south-1}
  BACKUP_FOLDER=${BACKUP_FOLDER:-diviyata}
  PROTECT_MAIN=${PROTECT_MAIN:-yes}
  HC_API_KEY=${HC_API_KEY:-} HC_MONITOR_URL=${HC_MONITOR_URL:-} HC_BACKUP_URL=${HC_BACKUP_URL:-}
  HC_RESTORE_URL=${HC_RESTORE_URL:-}
  ADMIN_NAME=${ADMIN_NAME:-} ADMIN_MOBILE=${ADMIN_MOBILE:-} ADMIN_DESIGNATION=${ADMIN_DESIGNATION:-}
  ADMIN_EMAIL=${ADMIN_EMAIL:-}

  # A Windows path (C:\Users\...) as written, its backslashes intact, made one Git Bash's ssh reads.
  SSH_KEY=$(tr -d '\r' <"$SETTINGS" | sed -n "s/^SSH_KEY=//p" | tail -n 1 | sed "s/^[\"']\(.*\)[\"']$/\1/")
  if command -v cygpath >/dev/null; then
    SSH_KEY=$(cygpath -u "$SSH_KEY")
  elif command -v wslpath >/dev/null && [[ $SSH_KEY =~ ^[A-Za-z]: ]]; then
    SSH_KEY=$(wslpath -u "$SSH_KEY")
  fi
  [ -r "$SSH_KEY" ] || die "can't read the key file $SSH_KEY (SSH_KEY in settings.env)"
  # In WSL a file on a Windows drive looks open to everyone, and ssh refuses such a key: use a
  # private copy in WSL's own ~/.ssh.
  if [[ $SSH_KEY == /mnt/* ]]; then
    local copy=$HOME/.ssh/diviyata-ops-key
    install -d -m 700 "$HOME/.ssh"
    cmp -s "$SSH_KEY" "$copy" || install -m 600 "$SSH_KEY" "$copy"
    SSH_KEY=$copy
  fi

  need gh
  gh auth status >/dev/null 2>&1 || die "sign in to GitHub first (once on each computer, and once in WSL): gh auth login"
  if [ -z "${GITHUB_REPO:-}" ]; then
    GITHUB_REPO=$(cd "$REPO_ROOT" && gh repo view --json nameWithOwner --jq .nameWithOwner)
  fi
}

# Runs a command on the server as the AMI's user (who has sudo). Standard input goes through.
remote() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes \
    -o ServerAliveInterval=30 "$SSH_USER@$SERVER_IP" "$@"
}

# Runs a command on the server as the deploy user, in /opt/diviyata, with scripts/lib.sh loaded
# (compose, load_env, log, die).
as_deploy() {
  # shellcheck disable=SC2029 # the command is quoted here, on purpose
  remote "sudo -u deploy -H bash -c $(printf '%q' ". /opt/diviyata/scripts/lib.sh; $1")"
}

# Answers ready, new (reached, but setup hasn't run) or nothing (SSH failed).
server_state() {
  remote 'if id deploy >/dev/null 2>&1 && sudo test -d /opt/diviyata; then echo ready; else echo new; fi' || true
}

# Loads the settings, and stops with the next step to take while the server can't be used yet.
load_ready() {
  load_settings
  case "$(server_state)" in
    ready) ;;
    new) die "the server isn't set up yet. Run: ops setup" ;;
    *) die "can't reach the server over SSH. Check SERVER_IP and SSH_KEY in settings.env, and that the instance is running" ;;
  esac
}

# Runs one of the server's scripts as the deploy user: server_script <name> [arguments]. Standard
# input goes through. A script newer than the server's copy arrives with the next deploy.
server_script() {
  local name=$1 args=""
  shift
  [ $# -eq 0 ] || args=$(printf '%q ' "$@")
  # bash's own test: Ubuntu 26.04's /usr/bin/test (uutils) answers -x wrongly for root.
  # </dev/null: ssh would otherwise swallow the standard input meant for the script below.
  remote "sudo bash -c 'test -x /opt/diviyata/scripts/$name'" </dev/null ||
    die "the server doesn't have scripts/$name yet: it arrives with the next deploy of main (ops deploy)"
  # shellcheck disable=SC2029 # the arguments are quoted here, on purpose
  remote "sudo -u deploy -H /opt/diviyata/scripts/$name $args"
}

# settings.env's SERVER_KEYS that have a value, as KEY=VALUE lines, read as written (not run as
# shell, so a password's $ or # stays); quotes around a value are dropped.
server_settings() {
  local line key value
  tr -d '\r' <"$SETTINGS" | while IFS= read -r line || [ -n "$line" ]; do
    key=${line%%=*} value=${line#*=}
    [[ $line == *=* && " ${SERVER_KEYS[*]} " == *" $key "* ]] || continue
    if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
    [ -z "$value" ] || printf '%s=%s\n' "$key" "$value"
  done
}

# Sends server_settings to the server's scripts/env.sh, which saves them and recreates what they
# change. Answers 1 when there is nothing to send.
push_server_settings() {
  local lines
  lines=$(server_settings)
  [ -n "$lines" ] || return 1
  note "sending $(cut -d= -f1 <<<"$lines" | tr '\n' ' ')"
  server_script env.sh set <<<"$lines" || die "the server didn't take the settings (see above)"
}

# Asks before something that can't be undone; the answer must be the word given.
confirm() {
  local word=$1 answer
  read -r -p "Type $word to go on: " answer
  [ "$answer" = "$word" ] || die "nothing was changed"
}

# Runs deploy.yml on a branch (main by default) and waits for it. About 15 minutes: CI, the images,
# then the deploy.
run_deploy() {
  local branch=${1:-main} before run="" _
  before=$(latest_dispatched_run)
  gh workflow run deploy.yml --repo "$GITHUB_REPO" --ref "$branch"
  for _ in $(seq 36); do
    sleep 5
    run=$(latest_dispatched_run)
    [ "$run" != "$before" ] && break
  done
  [ "$run" != "$before" ] || die "the Deploy run didn't start: see https://github.com/$GITHUB_REPO/actions"
  note "https://github.com/$GITHUB_REPO/actions/runs/$run"
  gh run watch "$run" --repo "$GITHUB_REPO" --exit-status --interval 30 >/dev/null ||
    die "the deploy failed. Its log: gh run view $run --repo $GITHUB_REPO --log-failed"
  # A skipped deploy job leaves the run green; only a deploy job that ran counts.
  local deployed
  deployed=$(gh run view "$run" --repo "$GITHUB_REPO" --json jobs --jq '.jobs[] | select(.name == "deploy") | .conclusion')
  [ "$deployed" = success ] ||
    die "the run passed but its deploy job was $deployed: check the repository variable DEPLOY_HOST (Settings > Secrets and variables > Actions > Variables)"
  note "the Deploy run passed"
}

latest_dispatched_run() {
  gh run list --repo "$GITHUB_REPO" --workflow deploy.yml --event workflow_dispatch --limit 1 \
    --json databaseId --jq '.[0].databaseId // 0'
}

# Waits up to 3 minutes for https://<domain>/health, which also proves the certificate.
check_health() {
  local _
  for _ in $(seq 18); do
    if curl -fsS -m 10 "https://$DOMAIN/health" 2>/dev/null | grep -q '"ok":true'; then
      note "https://$DOMAIN/health answers {\"ok\":true}"
      return
    fi
    sleep 10
  done
  die "https://$DOMAIN/health doesn't answer. Check that the security group allows TCP 80 and 443,
then read the proxy's log: ops logs proxy, and ops logs app"
}

# A backup into S3 and the monthly restore test, now: proves the bucket, the role and restic.
check_backups() {
  remote 'sudo /opt/diviyata/scripts/backup.sh' ||
    die "the backup failed. Check BACKUP_BUCKET and AWS_REGION, and that the role's policy names the bucket (RUNBOOK step 1.2)"
  remote 'sudo /opt/diviyata/scripts/restore.sh --test' || die "the restore test failed (see its output above)"
}

restic_password() {
  remote "sudo sed -n 's/^RESTIC_PASSWORD=//p' /opt/diviyata/.env"
}

# Prints the backup password once, for paper or the Ministry's password safe (SEC-10).
show_restic_password() {
  local password
  password=$(restic_password)
  cat <<EOF

  ------------------------------------------------------------------------------------------
  RESTIC_PASSWORD, the backups' key. Write it on paper or put it in the Ministry's password
  safe now. Without it no backup can ever be read. Don't keep it in a file on this computer.

      $password
  ------------------------------------------------------------------------------------------
EOF
}
