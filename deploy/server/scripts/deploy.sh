#!/usr/bin/env bash
# Deploys one release (OPS-3). GitHub Actions runs it over SSH, as the deploy user, after CI passed
# and the images were pushed (.github/workflows/deploy.yml):
#
#   /opt/diviyata/scripts/deploy.sh <app image> <tools image>
#
# 1. Backs up the database (kept in /opt/diviyata/backups, the newest 5).
# 2. With migrations to run, stops the app (Caddy shows the maintenance page), runs them, then the
#    lists seed and the grants. Without, the old app keeps answering until the swap.
# 3. Swaps the app and waits for its health check.
# If anything fails, the previous release runs again, and the database is put back from step 1's
# backup if a migration had started. scripts/rollback.sh goes back by hand.
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

[ $# -eq 2 ] || die "usage: deploy.sh <app image> <tools image>"
new_app=$1
new_tools=$2

exec 9>"$DIVIYATA_DIR/.deploy.lock"
flock -n 9 || die "another deploy or rollback is running"

load_env
previous_app=${APP_IMAGE:-}
previous_tools=${TOOLS_IMAGE:-}
dump=""
migrating=false
switched=false

on_failure() {
  trap - ERR
  set +e
  log "the deploy of $new_app failed"
  # Put the release files back as they were before this deploy.
  if $switched; then
    rm -f release.env
    if [ -f previous.env ]; then mv previous.env release.env; fi
    if [ -f previous.env.before ]; then mv previous.env.before previous.env; fi
  fi
  if $migrating && [ -n "$dump" ]; then db_restore "$dump"; fi
  if [ -n "$previous_app" ]; then
    log "starting the previous release again: $previous_app"
    compose up -d --wait --wait-timeout 180 app proxy || log "the previous release did not come back: see docs/RUNBOOK.md"
  else
    log "there is no previous release; the app stays stopped"
    compose stop app
  fi
  echo "$(date --iso-8601=seconds) $new_app FAILED, $previous_app kept" >>deploys.log
  exit 1
}
trap on_failure ERR

log "deploying $new_app"
# Run by hand without a registry login, an image already on the server is used as it is.
for image in "$new_app" "$new_tools"; do
  docker pull -q "$image" >/dev/null || docker image inspect "$image" >/dev/null
done

compose up -d --wait db

install -d -m 700 backups
dump="backups/pre-deploy-$(date '+%Y%m%d-%H%M%S').dump"
db_dump "$dump"
chmod 600 "$dump"
log "database backed up to $dump"
# shellcheck disable=SC2012 # the names are ours: dates and digits only
ls -1t backups/pre-deploy-*.dump | tail -n +6 | xargs -r rm -f

shipped=$(shipped_migrations "$new_tools")
applied=$(applied_migrations)
pending=$(comm -13 <(echo "$applied") <(echo "$shipped") | sed '/^$/d')
if [ -n "$pending" ]; then
  log "migrations to run: $(echo "$pending" | tr '\n' ' ')"
  compose stop app
  migrating=true
  TOOLS_IMAGE=$new_tools compose run --rm tools npx prisma migrate deploy
fi
# The lists seed only adds missing rows, so it never undoes the admin's changes.
TOOLS_IMAGE=$new_tools compose run --rm tools npx prisma db seed
apply_grants

{
  echo "APP_IMAGE=$new_app"
  echo "TOOLS_IMAGE=$new_tools"
  echo "PRE_DEPLOY_DUMP=$dump"
  echo "DEPLOYED_AT=$(date --iso-8601=seconds)"
} >release.env.new
rm -f previous.env.before
if [ -f previous.env ]; then cp -p previous.env previous.env.before; fi
if [ -f release.env ]; then mv release.env previous.env; fi
mv release.env.new release.env
switched=true

compose up -d --wait --wait-timeout 180 app proxy
trap - ERR
rm -f previous.env.before
log "the app is healthy: $new_app"

# Keep the images of this release and the previous one; remove older ones.
keep=$(printf '%s\n' "$new_app" "$new_tools" "$previous_app" "$previous_tools")
repos=$(printf '%s\n' "${new_app%:*}" "${new_tools%:*}")
docker image ls --format '{{.Repository}}:{{.Tag}}' |
  grep -Fx -v -f <(echo "$keep") |
  grep -F -f <(echo "$repos") |
  xargs -r docker image rm >/dev/null 2>&1 || true

echo "$(date --iso-8601=seconds) $new_app" >>deploys.log
log "done"
