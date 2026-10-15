#!/usr/bin/env bash
# Frees disk space Docker no longer needs. "ops clean" (deploy/ops.sh) runs it over SSH; on the
# server, as the deploy user: scripts/clean.sh
#
# It removes images no container uses, except the running release's and the previous one's (a
# rollback needs them, and can't pull without the deploy's registry login), plus dangling layers and
# build cache. Volumes (the database, the uploads, Caddy's certificate) are never touched.
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

take_lock
load_env
echo "Before: $(df -h --output=used,avail,pcent / | tail -n 1 | awk '{ print $1 " used, " $2 " free (" $3 ")" }')"

keep=$({
  printf '%s\n' "${APP_IMAGE:-}" "${TOOLS_IMAGE:-}"
  if [ -f previous.env ]; then sed -n 's/^\(APP\|TOOLS\)_IMAGE=//p' previous.env; fi
  docker ps -a --format '{{.Image}}'
} | sed '/^$/d' | sort -u)

docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -v '<none>' |
  grep -Fxv -f <(echo "$keep") | while read -r image; do
  docker image rm "$image" >/dev/null && log "removed $image"
done || true
docker image prune -f >/dev/null
docker builder prune -af >/dev/null

echo "After:  $(df -h --output=used,avail,pcent / | tail -n 1 | awk '{ print $1 " used, " $2 " free (" $3 ")" }')"
echo
docker system df
