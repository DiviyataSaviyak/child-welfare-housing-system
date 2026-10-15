#!/usr/bin/env bash
# The one command for running the live system, from your own computer, in Git Bash, in the
# repository's folder. deploy/README.md explains each command and when to use it.
#
#   bash deploy/ops.sh help     (or "ops help", after "bash deploy/ops.sh shortcut")
#
# It reads deploy/settings.env (copied from settings.example.env) and reaches the server over
# SSH and GitHub through the gh CLI. Nothing here needs you to log in to the server yourself.
# shellcheck source=operator/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/operator/lib.sh"

usage() {
  cat <<'EOF'
Usage: ops <command>                      (deploy/README.md has the details)
   or: bash deploy/ops.sh <command>, before the shortcut is made (see "shortcut" below)

Once
  setup                     set up the server and GitHub, deploy, back up (safe to run again)
  create-admin [--another]  make an admin from ADMIN_* in settings.env
  launch                    launch day: wipe the made-up data, go to production

Every day
  status                    is the site up, what is deployed, the last deploys and backup
  logs [app|proxy|db] [1h]  the server's log (default: the app, the last hour)
  deploy [branch]           deploy main (or a branch) now, without a new push
  ssh                       a shell on the server as the deploy user

Settings on the server (/opt/diviyata/.env)
  env show                  every setting, passwords and keys hidden
  env push                  send settings.env's SMTP_* lines, then restart what they change
  env set KEY=VALUE [...]   change settings (KEY= empties one), then restart what they change
  restart [app|proxy|db|all]  recreate containers so they read .env and Caddy's files again

When something goes wrong
  rollback [--with-database]  go back to the previous release
  backup                      back up into S3 now
  backups                     list the backups kept (30 days)
  restore-test                restore the latest backup into a scratch copy and check it
  restore <id|latest>         put the database and uploads back as in a backup (loses later changes)
  clean                       free disk space: unused Docker images and build cache

Staging only (refused in production)
  test-data demo|load [--remove]  add or remove made-up cases

This computer
  shortcut                  let "ops <command>" work from any folder in Git Bash
EOF
}

command=${1:-help}
[ $# -eq 0 ] || shift

case "$command" in
  help | -h | --help)
    usage
    ;;

  shortcut)
    # Git Bash reads ~/.bashrc when it opens; the alias points at this checkout.
    line="alias ops='bash \"$(cd "$HERE/.." && pwd)/ops.sh\"'"
    touch ~/.bashrc
    if grep -qxF "$line" ~/.bashrc; then
      note "the shortcut is already there"
    else
      sed -i '/^alias ops=/d' ~/.bashrc
      printf '%s\n' "$line" >>~/.bashrc
      note "added to ~/.bashrc"
    fi
    note "Close Git Bash and open it again, then type: ops status"
    ;;

  setup) bash "$HERE/setup.sh" "$@" ;;
  create-admin) bash "$HERE/create-admin.sh" "$@" ;;
  launch) bash "$HERE/launch.sh" "$@" ;;
  env) bash "$HERE/env.sh" "$@" ;;

  status)
    load_settings
    step "The site: https://$DOMAIN"
    if curl -fsS -m 10 "https://$DOMAIN/health" 2>/dev/null | grep -q '"ok":true'; then
      note "up: /health answers {\"ok\":true}"
    else
      note "DOWN: /health doesn't answer"
    fi
    step "On the server"
    case "$(server_state)" in
      ready) ;;
      new)
        note "reached over SSH, but not set up yet. Next: ops setup"
        exit 0
        ;;
      *) die "can't reach the server over SSH. Check SERVER_IP and SSH_KEY in settings.env, and that the instance is running" ;;
    esac
    # shellcheck disable=SC2016 # expanded on the server
    as_deploy 'load_env
      echo "Mode:      $APP_ENV"
      if [ -n "${APP_IMAGE:-}" ]; then
        echo "Deployed:  commit ${APP_IMAGE##*:} at ${DEPLOYED_AT:-?}"
      else
        echo "Deployed:  nothing yet (the first deploy runs from: ops setup)"
      fi
      echo "Disk:      $(df -h --output=pcent / | tail -n 1 | tr -d " ") used"
      echo; compose ps --format "table {{.Service}}\t{{.Status}}"
      echo; echo "The last deploys:"; tail -n 5 deploys.log 2>/dev/null || echo "  none yet"'
    step "The last backup"
    remote 'sudo journalctl -t diviyata-backup -n 3 --no-pager -o short' || true
    ;;

  logs)
    load_ready
    service=${1:-app} since=${2:-1h}
    case "$service" in app | proxy | db) ;; *) die "logs: app, proxy or db" ;; esac
    as_deploy "compose logs --no-color --since $(printf '%q' "$since") $service"
    ;;

  deploy)
    load_ready
    branch=${1:-main}
    step "Deploying $branch (about 15 minutes)"
    run_deploy "$branch"
    check_health
    ;;

  ssh)
    load_ready
    note "You are the deploy user in /opt/diviyata. 'dc' is docker compose; 'exit' leaves."
    ssh -t -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SSH_USER@$SERVER_IP" 'sudo -iu deploy'
    ;;

  rollback)
    load_ready
    case "${1:-}" in
      "") ;;
      --with-database)
        note "This also puts the database back as it was before the current release went in."
        note "Every case change made since then is lost. Check first: ops status"
        confirm ROLLBACK
        ;;
      *) die "rollback [--with-database]" ;;
    esac
    # shellcheck disable=SC2029
    remote "sudo -u deploy -H /opt/diviyata/scripts/rollback.sh ${1:-}"
    ;;

  restart)
    case "${1:-app}" in app | proxy | db | all) ;; *) die "restart [app|proxy|db|all]" ;; esac
    load_ready
    server_script restart.sh "${1:-app}"
    check_health
    ;;

  clean)
    load_ready
    server_script clean.sh
    ;;

  backup)
    load_ready
    remote 'sudo /opt/diviyata/scripts/backup.sh'
    ;;

  backups)
    load_ready
    remote 'sudo /opt/diviyata/scripts/restore.sh --list'
    ;;

  restore-test)
    load_ready
    remote 'sudo /opt/diviyata/scripts/restore.sh --test'
    ;;

  restore)
    load_ready
    snapshot=${1:-}
    [ -n "$snapshot" ] || die "restore <snapshot id|latest>: see the ids with: ops backups"
    note "This stops the app and puts the database and the uploaded files back as they were in"
    note "backup $snapshot. Every change made since that backup is lost."
    confirm RESTORE
    # shellcheck disable=SC2029
    remote "sudo /opt/diviyata/scripts/restore.sh $(printf '%q' "$snapshot") --yes"
    ;;

  test-data)
    load_ready
    case "${1:-}" in
      demo) script=seed-demo ;;
      load) script=seed-load ;;
      *) die "test-data demo|load [--remove]" ;;
    esac
    remove=""
    case "${2:-}" in "") ;; --remove) remove=--remove ;; *) die "test-data demo|load [--remove]" ;; esac
    as_deploy "load_env
      [ \"\$APP_ENV\" != production ] || die 'the server runs as production: no made-up data'
      compose run --rm tools npx tsx scripts/$script.ts $remove"
    ;;

  *)
    usage >&2
    die "unknown command: $command"
    ;;
esac
