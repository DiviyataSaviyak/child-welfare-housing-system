#!/usr/bin/env bash
# Creates the first admin on the server (RUNBOOK step 6), from your own computer, in Git Bash:
#
#   ops create-admin             # ADMIN_NAME, ADMIN_MOBILE, ... from settings.env
#   ops create-admin --another   # one more, when no admin can sign in
#
# The details come from settings.env rather than the command line, so a Sinhala name reaches the
# server intact. The username and temporary password are shown once: give them to the admin in
# person. It refuses while an active admin exists, unless --another.
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need ssh
load_settings
if [ -z "$ADMIN_NAME" ] || [ -z "$ADMIN_MOBILE" ]; then die "set ADMIN_NAME and ADMIN_MOBILE in $SETTINGS"; fi

args=(--name "$ADMIN_NAME" --mobile "$ADMIN_MOBILE")
[ -z "$ADMIN_DESIGNATION" ] || args+=(--designation "$ADMIN_DESIGNATION")
[ -z "$ADMIN_EMAIL" ] || args+=(--email "$ADMIN_EMAIL")
args+=("$@")

# shellcheck disable=SC2029 # the arguments are quoted here, on purpose
remote "sudo -u deploy -H /opt/diviyata/scripts/create-admin.sh $(printf '%q ' "${args[@]}")"
