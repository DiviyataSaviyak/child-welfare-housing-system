#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server for the system (OPS-2, SEC-9). Run it once as root, from the
# repository's deploy/ folder copied to the server (docs/RUNBOOK.md, "Set up the server"):
#
#   sudo bash deploy/server-setup.sh --domain diviyata.example.lk --email ops@example.lk \
#     --backups s3:s3.ap-south-1.amazonaws.com/<bucket>/diviyata
#
# Running it again changes nothing that is already in place, and never overwrites a value in .env;
# a flag given again replaces only its own value. It:
#   - installs Docker Engine and Compose from Docker's repository, restic and rsync
#   - turns on automatic security updates, rebooting at 03:30 when one needs it
#   - sets the time zone to Asia/Colombo, adds a 2 GB swap file and limits Docker's logs
#   - allows SSH with keys only
#   - makes the deploy user, with its own SSH key for GitHub Actions
#   - makes /opt/diviyata with the stack's files, an .env of generated secrets, and the cron jobs
set -Eeuo pipefail

DIR=/opt/diviyata
SOURCE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
DEPLOY_USER=deploy
DEPLOY_KEY=/home/$DEPLOY_USER/.ssh/github-actions

domain="" email="" backups=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) domain=$2 && shift 2 ;;
    --email) email=$2 && shift 2 ;;
    --backups) backups=$2 && shift 2 ;;
    *) echo "unknown option: $1" >&2 && exit 1 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0" >&2 && exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = "24.04" ] || echo "warning: written for Ubuntu 24.04, this is $PRETTY_NAME"

# Writes a file only when its content differs; answers 0 when it changed.
put_file() {
  local path=$1 mode=$2 content
  content=$(cat)
  if [ -f "$path" ] && [ "$(cat "$path")" = "$content" ]; then return 1; fi
  printf '%s\n' "$content" >"$path"
  chmod "$mode" "$path"
}

step "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg openssl unattended-upgrades restic rsync
install -m 0755 -d /etc/apt/keyrings
if [ ! -s /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
put_file /etc/apt/sources.list.d/docker.list 644 <<EOF || true
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable
EOF
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

step "Docker's logs: at most 3 files of 20 MB per container"
if put_file /etc/docker/daemon.json 644 <<'EOF'; then
{
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "3" }
}
EOF
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

step "Automatic security updates, rebooting at 03:30 when needed"
put_file /etc/apt/apt.conf.d/20auto-upgrades 644 <<'EOF' || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
put_file /etc/apt/apt.conf.d/52diviyata-upgrades 644 <<'EOF' || true
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades >/dev/null

step "Time zone: Asia/Colombo"
if [ "$(timedatectl show -p Timezone --value)" != "Asia/Colombo" ]; then
  timedatectl set-timezone Asia/Colombo
  systemctl restart cron
fi

step "Swap: 2 GB"
if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
if put_file /etc/sysctl.d/60-diviyata-swap.conf 644 <<<'vm.swappiness=10'; then sysctl -q --system; fi

step "SSH: keys only"
if put_file /etc/ssh/sshd_config.d/50-diviyata.conf 644 <<'EOF'; then
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PermitEmptyPasswords no
X11Forwarding no
EOF
  sshd -t
  systemctl try-reload-or-restart ssh
fi

step "The deploy user, for GitHub Actions"
id "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [ ! -f "$DEPLOY_KEY.pub" ]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -q -t ed25519 -N "" -C "github-actions-deploy" -f "$DEPLOY_KEY"
fi
# "restrict": commands and file copies only; no terminal, no forwarding.
authorized="restrict $(cat "$DEPLOY_KEY.pub")"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
grep -qxF "$authorized" "/home/$DEPLOY_USER/.ssh/authorized_keys" ||
  echo "$authorized" >>"/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

# The deploy user's shell starts in the stack's folder, with "dc" for its docker compose.
bashrc=/home/$DEPLOY_USER/.bashrc
grep -q 'alias dc=' "$bashrc" ||
  printf '%s\n' "cd $DIR" "alias dc='docker compose --project-directory $DIR -f $DIR/compose.yml --env-file $DIR/.env --env-file $DIR/release.env'" >>"$bashrc"

step "$DIR"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DIR" "$DIR/caddy" "$DIR/scripts"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DIR/backups"
install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE/compose.yml" "$DIR/compose.yml"
install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE"/caddy/* "$DIR/caddy/"
install -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE"/scripts/*.sh "$DIR/scripts/"
install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE"/scripts/*.sql "$DIR/scripts/"
install -m 644 -o root -g root "$SOURCE/cron" /etc/cron.d/diviyata

step "$DIR/.env"
env_file=$DIR/.env
[ -f "$env_file" ] || install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE/env.example" "$env_file"
chmod 600 "$env_file"
chown "$DEPLOY_USER:$DEPLOY_USER" "$env_file"

# Sets KEY to VALUE: replaces an empty value always, a set one only when asked (overwrite=1).
set_env() {
  local key=$1 value=$2 overwrite=${3:-0} current
  current=$(sed -n "s/^$key=//p" "$env_file" | tail -n 1)
  if [ -n "$current" ] && [ "$overwrite" != 1 ]; then return; fi
  [ "$current" = "$value" ] && return
  if grep -q "^$key=" "$env_file"; then
    sed -i "s|^$key=.*|$key=$value|" "$env_file"
  else
    echo "$key=$value" >>"$env_file"
  fi
}
secret() { openssl rand -hex 32; }

[ -z "$domain" ] || set_env SITE_DOMAIN "$domain" 1
[ -z "$email" ] || set_env ACME_EMAIL "$email" 1
[ -z "$backups" ] || set_env RESTIC_REPOSITORY "$backups" 1
set_env APP_ENV staging
set_env DB_OWNER_PASSWORD "$(secret)"
set_env APP_DB_PASSWORD "$(secret)"
set_env BETTER_AUTH_SECRET "$(secret)"
set_env RESTIC_PASSWORD "$(secret)"

missing=$(grep -E '^(SITE_DOMAIN|ACME_EMAIL|RESTIC_REPOSITORY)=$' "$env_file" | cut -d= -f1 | tr '\n' ' ' || true)
host=$(sed -n 's/^SITE_DOMAIN=//p' "$env_file")
host=${host:-<the domain name or Elastic IP>}
host_key=$(cut -d ' ' -f 1-2 /etc/ssh/ssh_host_ed25519_key.pub)

step "Done"
echo "The server is ready for its first deploy."
if [ -n "$missing" ]; then
  echo
  echo "Still empty in $env_file: $missing"
  echo "Set them with this script's flags, or edit the file: sudo -u $DEPLOY_USER nano $env_file"
fi
cat <<EOF

GitHub (Settings > Environments > production), from docs/RUNBOOK.md:
  variable DEPLOY_HOST          $host
  secret   DEPLOY_SSH_KEY       the private key: sudo cat $DEPLOY_KEY
                                 (then remove it from the server: sudo shred -u $DEPLOY_KEY)
  secret   DEPLOY_KNOWN_HOSTS   $host $host_key

Keep a copy of RESTIC_PASSWORD off the server, with the Ministry (SEC-10):
  sudo grep RESTIC_PASSWORD $env_file
EOF
