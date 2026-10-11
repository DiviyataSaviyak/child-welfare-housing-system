#!/usr/bin/env bash
# The 5-minute check (OPS-4), run by /etc/cron.d/diviyata as the deploy user. It asks the site's
# /health through HTTPS, as an office would reach it, and looks at the disk. It reports to the alert
# service either way, so the service also notices when the reports stop (the server is down).
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
trap - ERR
load_env

problems=()

if ! curl -fsS -m 20 -o /dev/null "https://$SITE_DOMAIN/health"; then
  problems+=("https://$SITE_DOMAIN/health does not answer")
fi

# The database, the uploads and the images all live on the root disk.
used=$(df --output=pcent / | tail -n 1 | tr -dc '0-9')
if [ "$used" -ge 80 ]; then problems+=("the disk is $used% full"); fi

if [ ${#problems[@]} -gt 0 ]; then
  message=$(printf '%s\n' "${problems[@]}")
  log "$message"
  ping_alert "${HC_MONITOR_URL:-}" /fail "$message"
  exit 1
fi
ping_alert "${HC_MONITOR_URL:-}" "" "ok, disk $used% used"
