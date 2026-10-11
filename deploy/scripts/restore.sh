#!/usr/bin/env bash
# Restores from the nightly backups (SEC-10), as root.
#
#   restore.sh --list                  the snapshots kept (the last 30 days)
#   restore.sh --test                  the monthly restore test, run by cron on the 1st at 02:30: the
#                                      latest snapshot goes into a scratch database and folder, is
#                                      checked, and is removed again. The live system is not touched.
#   restore.sh <snapshot|latest> --yes a full restore: the database and the uploaded files are put
#                                      back as they were in the snapshot, and every change since is
#                                      lost. The app is stopped meanwhile.
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

[ "$(id -u)" -eq 0 ] || die "run as root: the uploads volume belongs to root"
load_env
export RESTIC_REPOSITORY RESTIC_PASSWORD

dump_path=/var/backups/diviyata/diviyata.dump
files_dir=$(docker volume inspect "$FILES_VOLUME" --format '{{.Mountpoint}}' 2>/dev/null || true)

# Restores a snapshot into a new temporary folder and prints the folder.
restore_to_temp() {
  local snapshot=$1 target
  target=$(mktemp -d /var/tmp/diviyata-restore.XXXXXX)
  chmod 700 "$target"
  restic restore "$snapshot" --host diviyata --target "$target" >&2
  [ -s "$target$dump_path" ] || die "the snapshot holds no database dump"
  echo "$target"
}

# The uploads folder inside a restored snapshot (its path on the server that made it).
restored_files() {
  find "$1" -type d -path "*/${FILES_VOLUME}/_data" -print -quit
}

restore_test() {
  local target scratch=diviyata_restore_test files counts
  ping_alert "${HC_RESTORE_URL:-}" /start
  trap 'ping_alert "${HC_RESTORE_URL:-}" /fail "restore test failed at line $LINENO"; rm -rf "${target:-/nonexistent}"' ERR

  target=$(restore_to_temp latest)
  psql_owner postgres -c "DROP DATABASE IF EXISTS $scratch WITH (FORCE)"
  psql_owner postgres -c "CREATE DATABASE $scratch OWNER diviyata"
  compose exec -T db pg_restore -U diviyata -d "$scratch" --no-owner --no-acl --exit-on-error <"$target$dump_path"

  # The restored database must hold the migrations and the lists, and answer the usual queries.
  counts=$(psql_owner "$scratch" -F ' ' -c "SELECT
      (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL),
      (SELECT count(*) FROM ds_office),
      (SELECT count(*) FROM \"case\"),
      (SELECT count(*) FROM audit_log)")
  read -r migrations offices cases audits <<<"$counts"
  if [ "$migrations" -eq 0 ] || [ "$offices" -eq 0 ]; then die "the restored database is incomplete: $counts"; fi

  files=$(restored_files "$target")
  local file_count=0
  if [ -n "$files" ]; then file_count=$(find "$files" -type f | wc -l); fi

  psql_owner postgres -c "DROP DATABASE $scratch WITH (FORCE)"
  rm -rf "$target"
  trap - ERR
  local summary="restore test passed: $migrations migrations, $offices offices, $cases cases, $audits audit rows, $file_count files"
  log "$summary"
  ping_alert "${HC_RESTORE_URL:-}" "" "$summary"
}

full_restore() {
  local snapshot=$1 target files
  exec 9>"$DIVIYATA_DIR/.deploy.lock"
  flock -n 9 || die "a deploy or rollback is running"
  [ -n "$files_dir" ] || die "the uploads volume $FILES_VOLUME doesn't exist: deploy once first"

  target=$(restore_to_temp "$snapshot")
  db_restore "$target$dump_path"
  files=$(restored_files "$target")
  if [ -n "$files" ]; then
    log "putting back the uploaded files"
    rsync -a --delete "$files/" "$files_dir/"
  fi
  rm -rf "$target"
  compose up -d --wait --wait-timeout 180 app proxy
  log "restored from snapshot $snapshot; the app is running"
}

case "${1:-}" in
  --list) restic snapshots --host diviyata ;;
  --test) restore_test ;;
  "" | --*) die "usage: restore.sh --list | --test | <snapshot|latest> --yes" ;;
  *)
    [ "${2:-}" = "--yes" ] || die "a full restore replaces the live data: add --yes to go ahead"
    full_restore "$1"
    ;;
esac
