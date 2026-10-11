#!/usr/bin/env bash
# Creates the first admin account (ADM-2, AUTH-3), as the deploy user:
#
#   /opt/diviyata/scripts/create-admin.sh --name "ආර්. සිල්වා" --mobile 0712345678
#
# The username and a temporary password are shown once; the admin sets their own password at first
# sign-in, then creates every other account on the users screen. It refuses while an active admin
# exists; --another adds one anyway, for when no admin can sign in.
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
load_env
[ -n "${TOOLS_IMAGE:-}" ] || die "nothing has been deployed yet"
compose run --rm tools npx tsx scripts/create-admin.ts "$@"
