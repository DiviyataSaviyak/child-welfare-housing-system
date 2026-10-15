#!/usr/bin/env bash
# The server's settings in .env (SEC-9), read or changed without an editor. "ops env" (deploy/ops.sh)
# runs it over SSH; on the server, as the deploy user:
#
#   scripts/env.sh show                                   every setting; passwords and keys hidden
#   printf 'SMTP_HOST=smtp.gmail.com\n' | scripts/env.sh set
#
# set reads KEY=VALUE lines on standard input, so a value never shows in the process list or a
# shell's history on the server; KEY= empties a setting. It checks the new file with Compose, keeps
# the old one as .env.previous, and recreates the app and the proxy if their settings changed (a
# plain "docker compose restart" would keep the old values). If they don't come back, the old file
# and containers are put back.
#
# The generated secrets are refused: the database keeps the passwords it was first started with,
# RESTIC_PASSWORD opens the existing backups, and BETTER_AUTH_SECRET signs every session. Only
# launch day (deploy/operator/launch.sh) changes them, with APP_ENV.
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

PROTECTED=(DB_OWNER_PASSWORD APP_DB_PASSWORD RESTIC_PASSWORD BETTER_AUTH_SECRET APP_ENV)

[ -r .env ] || die "$DIVIYATA_DIR/.env is missing or unreadable: run server-setup.sh first"

show() {
  awk '/^[A-Za-z_][A-Za-z0-9_]*=/ {
    key = substr($0, 1, index($0, "=") - 1)
    value = substr($0, index($0, "=") + 1)
    if (value ~ /^'.*'$/) value = substr(value, 2, length(value) - 2)
    if (value == "") shown = "(empty)"
    else if (key ~ /PASSWORD|SECRET|TOKEN|_KEY$/) shown = length(value) > 8 ? "****" substr(value, length(value) - 3) : "****"
    else shown = value
    printf "%-20s %s\n", key, shown
  }' .env
}

set_values() {
  local line key value written old new changed=()
  take_lock
  work=$(mktemp .env.XXXXXX)
  trap 'rm -f "$work"' EXIT
  cat .env >"$work"

  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    [ -n "$line" ] || continue
    key=${line%%=*} value=${line#*=}
    # Never print the value: it may be a password.
    [[ $line == *=* && $key =~ ^[A-Z][A-Z0-9_]*$ ]] || die "not a KEY=VALUE line (the key: ${key:0:30})"
    for protected in "${PROTECTED[@]}"; do
      [ "$key" != "$protected" ] || die "$key is made on the server and can't be changed this way (scripts/env.sh says why)"
    done
    [[ $value != *"'"* ]] || die "$key: a value can't hold a single quote"
    # Compose and bash (load_env) both read a single-quoted value as it is.
    if [[ $value =~ ^[A-Za-z0-9_.@:/+,=-]*$ ]]; then written=$value; else written="'$value'"; fi

    old=$(sed -n "s/^$key=//p" "$work" | tail -n 1)
    if [ "$old" = "$written" ] && grep -q "^$key=" "$work"; then
      log "$key: unchanged"
      continue
    fi
    new=$(K=$key V=$written awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
      index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }' "$work")
    printf '%s\n' "$new" >"$work"
    if [ -z "$value" ]; then log "$key: emptied"; else log "$key: set"; fi
    changed+=("$key")
  done

  if [ ${#changed[@]} -eq 0 ]; then
    log "nothing changed"
    return
  fi

  docker compose --project-directory "$DIVIYATA_DIR" -f compose.yml --env-file "$work" config --quiet ||
    die "Compose can't read the new settings; .env is unchanged"
  cp -p .env .env.previous
  mv "$work" .env
  log "saved; the old file is .env.previous"

  if [ ! -f release.env ]; then
    log "nothing is deployed yet: the first deploy starts with these settings"
    return
  fi
  # Compose recreates only a container whose settings changed.
  if ! compose up -d --wait --wait-timeout 180 app proxy; then
    log "the app didn't come back: putting the old settings back"
    mv .env.previous .env
    compose up -d --wait --wait-timeout 180 app proxy || log "it didn't come back either: see docs/RUNBOOK.md"
    die "the new settings were undone. Read the app's log: dc logs --since 10m app"
  fi
  log "the app and the proxy run with the new settings"
}

case "${1:-}" in
  show) show ;;
  set) set_values ;;
  *) die "usage: env.sh show | env.sh set (KEY=VALUE lines on standard input)" ;;
esac
