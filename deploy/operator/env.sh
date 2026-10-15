#!/usr/bin/env bash
# The server's settings (/opt/diviyata/.env), from your own computer, in Git Bash:
#
#   ops env show                  every setting; passwords and keys hidden
#   ops env push                  the server's settings from settings.env (SERVER_KEYS in lib.sh)
#   ops env set KEY=VALUE [...]   one or more settings; KEY= empties one
#
# push sends only settings.env's SERVER_KEYS that have a value (the SMTP_* settings); SSH_KEY, the
# healthchecks.io key and the rest never leave this computer. push and set hand the lines to the
# server's scripts/env.sh through SSH's standard input, so a value is never on a command line there.
# It saves them, then recreates the app and the proxy if their settings changed, so the new values
# take effect at once. The passwords and keys made on the server are refused (scripts/env.sh says why).
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() { die "env show | env push | env set KEY=VALUE [KEY=VALUE ...]"; }

need ssh
sub=${1:-}
[ $# -eq 0 ] || shift
case "$sub" in
  show)
    [ $# -eq 0 ] || usage
    load_ready
    server_script env.sh show
    ;;

  push)
    [ $# -eq 0 ] || usage
    load_ready
    step "The server's settings from $SETTINGS"
    push_server_settings || die "${SERVER_KEYS[*]} are all empty in $SETTINGS: nothing to send"
    ;;

  set)
    [ $# -gt 0 ] || usage
    for pair in "$@"; do [[ $pair == *=* ]] || die "set takes KEY=VALUE, not '${pair:0:30}'"; done
    load_ready
    step "Sending $(printf '%s\n' "${@%%=*}" | tr '\n' ' ')"
    printf '%s\n' "$@" | server_script env.sh set
    ;;

  *) usage ;;
esac
