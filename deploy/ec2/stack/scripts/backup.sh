#!/usr/bin/env bash
# The nightly backup (SEC-10), run as root by /etc/cron.d/diviyata at 01:30:
#
#   /opt/diviyata/scripts/backup.sh
#
# The database dump and the uploaded files go into a restic repository in the S3 bucket
# (RESTIC_REPOSITORY). restic encrypts everything on the server with RESTIC_PASSWORD before it
# leaves, and reaches the bucket with the server's own AWS role, so no AWS key is stored here.
# Snapshots are kept for 30 days. The alert service hears the start and the outcome (OPS-4).
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

[ "$(id -u)" -eq 0 ] || die "run as root: the uploads volume belongs to root"
load_env
[ -n "${RESTIC_REPOSITORY:-}" ] || die "RESTIC_REPOSITORY is not set in .env"
[ -n "${RESTIC_PASSWORD:-}" ] || die "RESTIC_PASSWORD is not set in .env"
export RESTIC_REPOSITORY RESTIC_PASSWORD

ping_alert "${HC_BACKUP_URL:-}" /start
trap 'ping_alert "${HC_BACKUP_URL:-}" /fail "backup failed at line $LINENO"' ERR

work=/var/backups/diviyata
install -d -m 700 "$work"
files_dir=$(docker volume inspect "$FILES_VOLUME" --format '{{.Mountpoint}}')

log "dumping the database"
db_dump "$work/diviyata.dump"
chmod 600 "$work/diviyata.dump"

if ! restic cat config >/dev/null 2>&1; then
  log "starting the backup repository"
  restic init
fi

log "backing up"
restic backup --quiet --host diviyata --tag nightly "$work" "$files_dir"
restic forget --quiet --host diviyata --keep-within 30d --prune

summary=$(restic snapshots --host diviyata --latest 1 --compact | sed -n '3p')
trap - ERR
log "done: $summary"
ping_alert "${HC_BACKUP_URL:-}" "" "backup done: $summary"
