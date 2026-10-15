#!/usr/bin/env bash
# Launch day (RUNBOOK, "9.13 Launch day", steps 1 to 5), from your own computer, in Git Bash, outside
# office hours:
#
#   ops launch
#   ops launch --again   # after a launch that stopped halfway
#
# Only after the Ministry has agreed in writing that the data may be kept on AWS. It asks you to type
# the domain before it changes anything, then:
#   1. stops the stack and removes the staging database, uploads and pre-deploy dumps, every account
#      made on staging with them
#   2. deletes the staging backups from the S3 bucket (restic's folder)
#   3. sets APP_ENV=production and new BETTER_AUTH_SECRET, DB_OWNER_PASSWORD, APP_DB_PASSWORD and
#      RESTIC_PASSWORD in the server's .env
#   4. deploys main: the database starts empty and gets the lists
#   5. backs up into S3 (a new backup repository) and runs the restore test
#   6. creates the first admin from settings.env, and shows the new RESTIC_PASSWORD
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

again=0
case "${1:-}" in
  "") ;;
  --again) again=1 ;;
  *) die "unknown option: $1" ;;
esac

need ssh curl
load_settings

remote 'sudo test -f /opt/diviyata/release.env' || die "nothing is deployed yet: run setup.sh first"
if [ "$again" = 0 ] && remote 'sudo grep -qx APP_ENV=production /opt/diviyata/.env'; then
  die "the server already runs as production, with real data. If a launch stopped halfway, run: ops launch --again"
fi
cat <<EOF

This removes everything on https://$DOMAIN: every case, account, upload and backup, in the
database and in s3://$BACKUP_BUCKET/$BACKUP_FOLDER. It can't be undone.
EOF
read -r -p "Type the domain ($DOMAIN) to go on: " answer
[ "$answer" = "$DOMAIN" ] || die "nothing was changed"

step "Stopping the stack and removing the staging data"
remote 'sudo bash -s' <<'EOF'
. /opt/diviyata/scripts/lib.sh
compose down
for volume in diviyata_dbdata diviyata_files; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then docker volume rm "$volume" >/dev/null; fi
done
rm -f backups/*.dump /var/backups/diviyata/diviyata.dump
log "the database, the uploads and the dumps are gone"
EOF

step "Deleting the staging backups from S3"
# The server's own role may list and delete in the bucket; the AWS CLI runs once in a container,
# on the host's network so it reaches the instance's metadata for the role.
remote 'sudo bash -s' <<'EOF'
. /opt/diviyata/scripts/lib.sh
load_env
repository=${RESTIC_REPOSITORY#s3:}
region=$(sed -n 's|^s3\.\([a-z0-9-]*\)\.amazonaws\.com/.*|\1|p' <<<"$repository")
target=s3://${repository#*/}/
log "removing $target"
docker run --rm --network host amazon/aws-cli:2.17.0 s3 rm --recursive --only-show-errors \
  --region "$region" "$target"
EOF

step "New secrets, and APP_ENV=production"
remote 'sudo bash -s' <<'EOF'
set -euo pipefail
env_file=/opt/diviyata/.env
for key in BETTER_AUTH_SECRET DB_OWNER_PASSWORD APP_DB_PASSWORD RESTIC_PASSWORD; do
  sed -i "s|^$key=.*|$key=$(openssl rand -hex 32)|" "$env_file"
done
sed -i 's|^APP_ENV=.*|APP_ENV=production|' "$env_file"
EOF
note "done"

step "Deploying main (about 15 minutes)"
run_deploy main

step "The site"
check_health

step "Backups: the new repository in S3, then the restore test"
check_backups

if [ -n "$ADMIN_NAME" ]; then
  step "The first admin"
  bash "$HERE/create-admin.sh"
else
  step "The first admin: set ADMIN_NAME and ADMIN_MOBILE in settings.env, then: ops create-admin"
fi

show_restic_password
cat <<EOF

The system is live at https://$DOMAIN. The admin signs in, sets their password, and creates
the Head Office and DS office accounts. Watch healthchecks.io and the app's log this first week.
EOF
