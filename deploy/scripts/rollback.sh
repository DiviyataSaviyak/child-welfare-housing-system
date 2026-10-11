#!/usr/bin/env bash
# Goes back to the previous release by hand (OPS-3), as the deploy user:
#
#   /opt/diviyata/scripts/rollback.sh                   the previous app, the database as it is
#   /opt/diviyata/scripts/rollback.sh --with-database   also puts the database back as it was just
#                                                       before the current release was deployed
#
# --with-database loses every change made since that deploy, so use it only when the current
# release's migrations must be undone. Without it, the rollback refuses when the database has
# migrations the previous release doesn't know. Running it again goes forward again.
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

with_database=false
case "${1:-}" in
  "") ;;
  --with-database) with_database=true ;;
  *) die "usage: rollback.sh [--with-database]" ;;
esac

exec 9>"$DIVIYATA_DIR/.deploy.lock"
flock -n 9 || die "a deploy or rollback is running"

[ -f release.env ] || die "nothing has been deployed yet"
[ -f previous.env ] || die "there is no previous release to go back to"
load_env
current_dump=${PRE_DEPLOY_DUMP:-}
previous_app=$(sed -n 's/^APP_IMAGE=//p' previous.env)
previous_tools=$(sed -n 's/^TOOLS_IMAGE=//p' previous.env)

if $with_database; then
  [ -n "$current_dump" ] || die "release.env names no pre-deploy backup"
  db_restore "$current_dump"
else
  unknown=$(comm -23 <(applied_migrations) <(shipped_migrations "$previous_tools") | sed '/^$/d')
  [ -z "$unknown" ] || die "the database has migrations the previous release doesn't know:
$unknown
Run again with --with-database to restore the database from before this release ($current_dump)."
fi

log "going back to $previous_app"
mv release.env release.env.swap
mv previous.env release.env
mv release.env.swap previous.env
compose up -d --wait --wait-timeout 180 app proxy
echo "$(date --iso-8601=seconds) $previous_app (rollback$($with_database && echo ', with the database'))" >>deploys.log
log "done: $previous_app is running"
