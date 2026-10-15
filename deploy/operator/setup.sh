#!/usr/bin/env bash
# The server's first setup and GitHub's settings in one command (docs/RUNBOOK.md, "First setup",
# steps 2 to 6). Run it from your own computer, in Git Bash, in the repository's folder:
#
#   ops setup                    # safe to run again
#   ops setup --deploy           # also deploy again when a release is running
#   ops setup --new-deploy-key   # a new key for GitHub Actions
#
# Before it: the AWS steps (deploy/README.md, "AWS, once"), and deploy/settings.env filled in from
# settings.example.env. It:
#   1. checks the server: SSH, its IAM role, and that the domain points at it
#   2. makes the three healthchecks.io checks, when HC_API_KEY is set
#   3. copies the server files and runs server-setup.sh there
#   3b. sends settings.env's server settings (SERVER_KEYS: the email for forgotten passwords)
#   4. sets GitHub's repository variable DEPLOY_HOST, the production environment's secrets
#      (DEPLOY_KNOWN_HOSTS, DEPLOY_SSH_KEY,
#      the key passing straight from the server to GitHub, then shredded on the server), the
#      branch protection of main and the workflow permissions
#   5. runs the first deploy and waits for https://<domain>/health
#   6. backs up to S3 and runs the restore test
#   7. creates the first admin, when ADMIN_NAME is set and there is none yet
#   8. shows RESTIC_PASSWORD, for the Ministry's safe
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

force_deploy=0 new_key=0
while [ $# -gt 0 ]; do
  case "$1" in
    --deploy) force_deploy=1 && shift ;;
    --new-deploy-key) new_key=1 && shift ;;
    *) die "unknown option: $1" ;;
  esac
done

need ssh tar curl sed
load_settings
for key in OPS_EMAIL BACKUP_BUCKET; do
  [ -n "${!key:-}" ] || die "set $key in $SETTINGS"
done
DEPLOY_KEY=/home/deploy/.ssh/github-actions

step "The server: $SSH_USER@$SERVER_IP"
remote true || die "can't reach the server over SSH. Check SERVER_IP, SSH_KEY, and that the security group allows TCP 22"
note "SSH works"

# shellcheck disable=SC2016 # expanded on the server
role=$(remote 'token=$(curl -fsS -m 5 -X PUT http://169.254.169.254/latest/api/token \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60") &&
  curl -fsS -m 5 -H "X-aws-ec2-metadata-token: $token" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/' || true)
[ -n "$role" ] ||
  die "the instance has no IAM role. In EC2: select it > Actions > Security > Modify IAM role > diviyata-server (RUNBOOK step 1.2)"
note "IAM role: $role"

# shellcheck disable=SC2029 # the domain is filled in here, on purpose
resolved=$(remote "getent ahostsv4 '$DOMAIN' | awk 'NR == 1 { print \$1 }'" || true)
[ "$resolved" = "$SERVER_IP" ] ||
  die "$DOMAIN points at '${resolved:-nothing}', not $SERVER_IP. Fix its A record (or empty DOMAIN to use sslip.io), wait a few minutes, and run this again"
note "$DOMAIN points at $SERVER_IP"

if [ -n "$HC_API_KEY" ]; then
  step "healthchecks.io: the three checks"
  # Makes a check, or finds the one with the same name; prints its ping URL.
  hc_check() {
    local response
    response=$(curl -fsS -m 20 -X POST https://healthchecks.io/api/v3/checks/ \
      -H "X-Api-Key: $HC_API_KEY" -H "Content-Type: application/json" --data "$1") ||
      die "healthchecks.io refused the request: check HC_API_KEY (a read-write key, not the read-only one)"
    sed -n 's/.*"ping_url": *"\([^"]*\)".*/\1/p' <<<"$response"
  }
  common='"tz": "Asia/Colombo", "channels": "*", "unique": ["name"]'
  [ -n "$HC_MONITOR_URL" ] ||
    HC_MONITOR_URL=$(hc_check "{\"name\": \"monitor\", \"timeout\": 300, \"grace\": 600, $common}")
  [ -n "$HC_BACKUP_URL" ] ||
    HC_BACKUP_URL=$(hc_check "{\"name\": \"backup\", \"schedule\": \"30 1 * * *\", \"grace\": 3600, $common}")
  [ -n "$HC_RESTORE_URL" ] ||
    HC_RESTORE_URL=$(hc_check "{\"name\": \"restore test\", \"schedule\": \"30 2 1 * *\", \"grace\": 7200, $common}")
  if [ -z "$HC_MONITOR_URL" ] || [ -z "$HC_BACKUP_URL" ] || [ -z "$HC_RESTORE_URL" ]; then
    die "healthchecks.io answered without a ping URL"
  fi
  note "monitor, backup and restore test are ready"
elif [ -z "$HC_MONITOR_URL$HC_BACKUP_URL$HC_RESTORE_URL" ]; then
  note "warning: no HC_API_KEY or ping URLs in settings.env, so nobody is emailed when something fails"
fi

if [ "$new_key" = 1 ]; then
  step "Removing the old GitHub Actions key"
  remote "sudo rm -f $DEPLOY_KEY $DEPLOY_KEY.pub && sudo sed -i '/github-actions-deploy\$/d' /home/deploy/.ssh/authorized_keys"
fi

step "Copying the server files"
tar -C "$REPO_ROOT/deploy/ec2" -cf - . |
  remote 'rm -rf ~/diviyata-setup && mkdir ~/diviyata-setup && tar -xf - -C ~/diviyata-setup'

step "server-setup.sh on the server (a few minutes the first time)"
args=(--domain "$DOMAIN" --email "$OPS_EMAIL"
  --backups "s3:s3.$AWS_REGION.amazonaws.com/$BACKUP_BUCKET/$BACKUP_FOLDER")
[ -z "$HC_MONITOR_URL" ] || args+=(--hc-monitor "$HC_MONITOR_URL")
[ -z "$HC_BACKUP_URL" ] || args+=(--hc-backup "$HC_BACKUP_URL")
[ -z "$HC_RESTORE_URL" ] || args+=(--hc-restore "$HC_RESTORE_URL")
# shellcheck disable=SC2029
remote "sudo bash ~/diviyata-setup/setup/server-setup.sh --quiet $(printf '%q ' "${args[@]}") && rm -rf ~/diviyata-setup"

step "The server's settings from settings.env"
push_server_settings || note "none filled in (the email for forgotten passwords stays off; ops env push sends them later)"

step "GitHub: $GITHUB_REPO"
gh api -X PUT "repos/$GITHUB_REPO/environments/production" >/dev/null
# A repository variable, not the environment's: deploy.yml's "if" reads it before the job enters
# the environment, when only repository variables are visible.
gh variable set DEPLOY_HOST --repo "$GITHUB_REPO" --body "$DOMAIN"
gh variable delete DEPLOY_HOST --env production --repo "$GITHUB_REPO" >/dev/null 2>&1 || true
host_key=$(remote 'cut -d " " -f 1-2 /etc/ssh/ssh_host_ed25519_key.pub')
gh secret set DEPLOY_KNOWN_HOSTS --env production --repo "$GITHUB_REPO" --body "$DOMAIN $host_key"
if remote "sudo test -f $DEPLOY_KEY"; then
  # Straight from the server to GitHub: the private key never lands on this computer.
  remote "sudo cat $DEPLOY_KEY" | gh secret set DEPLOY_SSH_KEY --env production --repo "$GITHUB_REPO"
  remote "sudo shred -u $DEPLOY_KEY"
  note "DEPLOY_SSH_KEY set, and removed from the server"
elif gh secret list --env production --repo "$GITHUB_REPO" --json name --jq '.[].name' | grep -qx DEPLOY_SSH_KEY; then
  note "DEPLOY_SSH_KEY was set by an earlier run"
else
  die "the deploy key is gone from the server but not in GitHub: run this again with --new-deploy-key"
fi
note "variable DEPLOY_HOST=$DOMAIN; environment production: DEPLOY_KNOWN_HOSTS, DEPLOY_SSH_KEY"

gh api -X PUT "repos/$GITHUB_REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
note "workflow permissions: read"

if [ "$PROTECT_MAIN" = yes ]; then
  gh api -X PUT "repos/$GITHUB_REPO/branches/main/protection" --input - >/dev/null <<'EOF'
{
  "required_status_checks": { "strict": false, "contexts": ["server-files", "check"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
EOF
  note "main: pull requests with the server-files and check checks"
fi

if [ "$force_deploy" = 1 ] || ! remote 'sudo test -f /opt/diviyata/release.env'; then
  step "Deploying main (about 15 minutes)"
  run_deploy main
else
  step "A release is already running (ops deploy deploys again)"
fi

step "The site"
check_health

step "Backups: one now into S3, then the restore test"
check_backups

if [ -n "$ADMIN_NAME" ]; then
  step "The first admin"
  bash "$HERE/create-admin.sh" || note "no new admin (see above); an existing admin adds accounts on the users screen"
fi

show_restic_password
cat <<EOF

Done. The site is https://$DOMAIN (staging: made-up data only until launch day).
See how it is with: ops status
EOF
