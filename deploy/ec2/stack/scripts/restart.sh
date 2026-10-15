#!/usr/bin/env bash
# Recreates containers from the running release with the current .env and Caddy files. "ops restart"
# (deploy/ops.sh) runs it over SSH; on the server, as the deploy user:
#
#   scripts/restart.sh [app|proxy|db|all]     (default: app)
#
# A plain "docker compose restart" keeps a container's old settings and files; recreating it reads
# them again. The app is down for a few seconds (Caddy shows the maintenance page); db stops the app's
# work for as long, and all recreates the three. The data lives in volumes and stays.
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

case "${1:-app}" in
  app | proxy | db) services=("${1:-app}") deps=(--no-deps) ;;
  all) services=(db app proxy) deps=() ;;
  *) die "usage: restart.sh [app|proxy|db|all]" ;;
esac

take_lock
[ -f release.env ] || die "nothing is deployed yet"
log "recreating: ${services[*]}"
compose up -d --wait --wait-timeout 180 --force-recreate "${deps[@]}" "${services[@]}"
case " ${services[*]} " in *" proxy "*) caddy_started ;; esac
log "done"
compose ps --format "table {{.Service}}\t{{.Status}}"
