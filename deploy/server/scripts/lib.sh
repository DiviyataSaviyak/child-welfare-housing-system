# shellcheck shell=bash
# Shared by the server scripts in /opt/diviyata/scripts. Each one starts with
#   . "$(dirname "$(readlink -f "$0")")/lib.sh"
set -Eeuo pipefail

DIVIYATA_DIR=${DIVIYATA_DIR:-/opt/diviyata}
cd "$DIVIYATA_DIR"

# The uploads volume; compose.yml's project name is "diviyata". Read by the scripts that source this.
# shellcheck disable=SC2034
FILES_VOLUME=diviyata_files

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
die() {
  log "ERROR: $*" >&2
  exit 1
}

# The server's settings (.env, SEC-9) and the running release (release.env), as shell variables.
load_env() {
  [ -r .env ] || die "$DIVIYATA_DIR/.env is missing or unreadable: run server-setup.sh first"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  # Read, but not exported: an exported APP_IMAGE would win over release.env in every compose call
  # below, and the app would never be swapped.
  # shellcheck disable=SC1091
  if [ -f release.env ]; then . ./release.env; fi
}

# docker compose with the server's two env files. A variable set in the shell wins over both, which
# is how deploy.sh runs the new release's tools before the release is switched.
compose() {
  local env_files=(--env-file .env)
  if [ -f release.env ]; then env_files+=(--env-file release.env); fi
  docker compose --project-directory "$DIVIYATA_DIR" -f compose.yml "${env_files[@]}" "$@"
}

# psql as the database owner, inside the db container. First argument: the database.
psql_owner() {
  local database=$1
  shift
  compose exec -T db psql -U diviyata -d "$database" -v ON_ERROR_STOP=1 -qAt "$@"
}

# The app's own database account and what it may do (SEC-3).
apply_grants() {
  compose exec -T db psql -U diviyata -d diviyata -v ON_ERROR_STOP=1 -q \
    -v app_password="$APP_DB_PASSWORD" -f - <scripts/db-grants.sql
}

# The whole database in PostgreSQL's custom format, written to $1.
db_dump() {
  compose exec -T db pg_dump -U diviyata -d diviyata --format=custom >"$1"
}

# Puts the database back as it is in the dump $1. The app is stopped first and stays stopped.
db_restore() {
  local dump=$1
  [ -s "$dump" ] || die "the dump $dump is missing or empty"
  log "restoring the database from $dump"
  compose stop app
  psql_owner postgres -c 'DROP DATABASE IF EXISTS diviyata WITH (FORCE)'
  psql_owner postgres -c 'CREATE DATABASE diviyata OWNER diviyata'
  compose exec -T db pg_restore -U diviyata -d diviyata --exit-on-error <"$dump"
  apply_grants
}

# The migrations already applied to the database, one name per line (none before the first deploy).
applied_migrations() {
  psql_owner diviyata -c "SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1" 2>/dev/null || true
}

# The migrations a tools image carries, one name per line.
shipped_migrations() {
  docker run --rm --entrypoint ls "$1" prisma/migrations | grep -v '^migration_lock.toml$' | sort
}

# Reports to the alert service (OPS-4): ping_alert <url> <"" | /start | /fail> <message>.
# Only short status lines are sent, never case data. No URL set: nothing is sent.
ping_alert() {
  local url=$1 suffix=$2 message=${3:-}
  [ -n "$url" ] || return 0
  curl -fsS -m 10 --retry 3 --data-raw "$message" "$url$suffix" >/dev/null ||
    log "could not reach the alert service"
}
