#!/usr/bin/env bash
# Deploy spaces to a Linux host with KVM over SSH.
#
#   ./scripts/deploy.sh homelab-rz              # first deploy
#   ./scripts/deploy.sh homelab-rz              # every deploy after that
#   PORT=9000 ./scripts/deploy.sh homelab-rz    # different port
#
# Deploys the control plane and the runner to the SAME machine, which is the
# supported topology: the API drives microsandbox locally, so commands take
# 20-24 ms instead of crossing an SSH hop. The console is built and served by
# the API itself.
#
# Idempotent. Re-running syncs code, rebuilds the console and restarts the
# service. It does NOT rotate the API key, and restarting the API does not kill
# running sandboxes (see KillMode=process in deploy/spaces.service).
set -euo pipefail

TARGET="${1:-${TARGET:-}}"
PORT="${PORT:-8787}"
APP_NAME="${APP_NAME:-spaces}"

die() { echo "error: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

[ -n "$TARGET" ] || die "usage: $0 <ssh-host>   (e.g. $0 homelab-rz)"

cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"
[ -f deploy/spaces.service ] || die "run this from the repository root"

# ---------------------------------------------------------------- preflight --

step "preflight: $TARGET"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET")
"${SSH[@]}" true 2>/dev/null || die "cannot ssh to $TARGET non-interactively (check your SSH config / keys)"

R_HOME=$("${SSH[@]}" 'echo $HOME')
[ -n "$R_HOME" ] || die "could not determine remote home directory"
APP_DIR="${APP_DIR:-$R_HOME/$APP_NAME}"
BUN="$R_HOME/.bun/bin/bun"
MSB="$R_HOME/.microsandbox/bin/msb"

echo "    host      $TARGET"
echo "    app dir   $APP_DIR"
echo "    bun       $BUN"
echo "    msb       $MSB"

remote_facts=$("${SSH[@]}" 'printf "%s|%s|%s|" "$(. /etc/os-release && echo $PRETTY_NAME)" "$(uname -m)" "$(test -r /dev/kvm && test -w /dev/kvm && echo rw || echo NO)"')
IFS='|' read -r dist arch kvm <<<"$remote_facts"
echo "    system    $dist ($arch), /dev/kvm: $kvm"

case "$arch" in
  x86_64|aarch64) ;;
  *) die "unsupported architecture: $arch" ;;
esac
[ "$kvm" = "rw" ] || die "/dev/kvm is not readable+writable on $TARGET. microsandbox needs KVM:
    - enable VT-x/AMD-V in firmware (physical access required)
    - add your user to the kvm group, or chmod 660 /dev/kvm
  Run 'msb doctor' on the host for the details."

# ------------------------------------------------------------------ install --

if ! "${SSH[@]}" "test -x $BUN"; then
  step "installing bun"
  "${SSH[@]}" 'curl -fsSL https://bun.sh/install | bash' >/dev/null 2>&1 || die "bun install failed"
  "${SSH[@]}" "test -x $BUN" || die "bun not found at $BUN after install"
fi

if ! "${SSH[@]}" "test -x $MSB"; then
  step "installing microsandbox (msb)"
  "${SSH[@]}" 'curl -fsSL https://install.microsandbox.dev | sh' >/dev/null 2>&1 || die "msb install failed"
  "${SSH[@]}" "test -x $MSB" || die "msb not found at $MSB after install"
fi

step "host check"
doctor=$("${SSH[@]}" "$MSB doctor 2>&1" || true)
echo "$doctor" | sed 's/^/    /'
echo "$doctor" | grep -q "Host setup is ready" || die "msb doctor did not report 'Host setup is ready' (see above)"

# --------------------------------------------------------------------- sync --

step "syncing code"
# --delete keeps the tree honest, but data/ (the SQLite database) and
# node_modules are excluded, so an excluded path is never pruned.
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude 'apps/api/.data' \
  --exclude 'apps/web/dist' \
  --exclude '.env' \
  --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' \
  "$REPO_ROOT/" "$TARGET:$APP_DIR/"

# -------------------------------------------------------------------- build --

step "install + build"
"${SSH[@]}" "set -euo pipefail
  cd '$APP_DIR'
  export PATH="$R_HOME/.bun/bin:\$PATH"
  bun install --frozen-lockfile 2>/dev/null || bun install
  bun run --cwd apps/web build
  mkdir -p data
" 2>&1 | tail -8 | sed 's/^/    /'

# ---------------------------------------------------------------------- env --

step "configuration"
ENV_FILE=/etc/spaces/spaces.env

# Probe where the API should live. A heredoc into `bash -s` keeps this free of
# the nested quoting that mangles JSON on the way through ssh.
read -r TS_IP TS_DNS <<<"$("${SSH[@]}" bash -s <<'REMOTE'
ip=$(tailscale ip -4 2>/dev/null | head -1)
dns=$(tailscale status --json 2>/dev/null |
  python3 -c 'import sys,json; print(json.load(sys.stdin)["Self"].get("DNSName","").rstrip("."))' 2>/dev/null)
echo "$ip $dns"
REMOTE
)"

# HTTPS via `tailscale serve` is the default when the tailnet issues certs: a
# real certificate on a MagicDNS name is what makes the console and preview
# links usable in a browser. The API then binds loopback, so it is reachable
# only through TLS on the tailnet — no plaintext listener on the interface.
if [ -n "${TS_DNS:-}" ]; then
  BIND="127.0.0.1"
  PUBLIC_URL="https://$TS_DNS"
  SERVE="yes"
  echo "    tailnet   $TS_DNS (HTTPS via tailscale serve)"
elif [ -n "${TS_IP:-}" ]; then
  BIND="$TS_IP"
  PUBLIC_URL="http://$TS_IP:$PORT"
  SERVE=""
  echo "    tailnet   $TS_IP (no MagicDNS name; plain HTTP)"
else
  BIND="0.0.0.0"
  PUBLIC_URL="http://$(hostname -f 2>/dev/null || echo localhost):$PORT"
  SERVE=""
  echo "    warning: no tailnet address found; binding 0.0.0.0 — set a firewall rule"
fi

if "${SSH[@]}" "sudo -n test -f $ENV_FILE"; then
  echo "    keeping   $ENV_FILE (existing API key preserved)"
  API_KEY=$("${SSH[@]}" "sudo -n sed -n 's/^SPACES_API_KEY=//p' $ENV_FILE" | head -1)
  # Keep the file in step with the topology we just probed: switching to
  # tailscale serve must not leave a stale plain-HTTP origin minting signed URLs.
  "${SSH[@]}" "sudo -n sed -i -e 's|^SPACES_BIND=.*|SPACES_BIND=$BIND|' -e 's|^SPACES_PUBLIC_URL=.*|SPACES_PUBLIC_URL=$PUBLIC_URL|' $ENV_FILE"
else
  API_KEY="sk_live_$(openssl rand -hex 24)"
  echo "    creating  $ENV_FILE"
  # One template, substituted — so the example in deploy/ cannot drift from
  # what is actually installed.
  sed -e "s|/home/indrazm|$R_HOME|g" \
      -e "s|^SPACES_BIND=.*|SPACES_BIND=$BIND|" \
      -e "s|^PORT=.*|PORT=$PORT|" \
      -e "s|^SPACES_PUBLIC_URL=.*|SPACES_PUBLIC_URL=$PUBLIC_URL|" \
      -e "s|^SPACES_API_KEY=.*|SPACES_API_KEY=$API_KEY|" \
      -e "s|^SPACES_AUTH_URL=.*|SPACES_AUTH_URL=$PUBLIC_URL|" \
      -e "s|^SPACES_AUTH_SECRET=.*|SPACES_AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" \
      deploy/spaces.env.example \
    | "${SSH[@]}" "sudo -n install -D -m 0600 /dev/stdin $ENV_FILE"
fi

# Networking and image can be pinned from the command line, e.g.
#   SPACES_NET_RULES='allow@100.104.164.110:tcp:8443' ./scripts/deploy.sh host
#   SPACES_MSB_IMAGE=spaces/guest:ubuntu ./scripts/deploy.sh host
#
# Written by a helper rather than `sed -i`, because the settings being appended
# may not exist yet, and an env file without a trailing newline silently glues
# the new key onto the previous value (`SPACES_TRANSFER_MAX=104857600SPACES_...`).
set_env() {
  local key=$1 value=$2 quiet=${3:-}
  # The value is an argument, not stdin: the script below arrives on stdin, so
  # anything reading stdin here would find the script and silently write nothing.
  # The last line verifies the write, because the first version of this helper
  # reported success while changing nothing.
  "${SSH[@]}" \
    "sudo -n bash -s -- $ENV_FILE $(printf '%q' "$key") $(printf '%q' "$value")" \
    <<'REMOTE' || return 1
set -eu
f=$1; k=$2; v=$3
if grep -q "^$k=" "$f"; then
  esc=$(printf '%s' "$v" | sed 's/[|&\\]/\\&/g')
  sed -i "s|^$k=.*|$k=$esc|" "$f"
else
  # A file without a trailing newline would glue this key onto the previous value.
  [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ] && echo >> "$f"
  printf '%s=%s\n' "$k" "$v" >> "$f"
fi
grep -qx "$k=$v" "$f" || { echo "failed to set $k in $f" >&2; exit 1; }
REMOTE
  if [ -z "$quiet" ]; then echo "    $key     $value"; fi
}

# Better Auth refuses to start without a secret, and it must survive redeploys:
# rotating it signs everyone out. Generated once, written without printing.
if "${SSH[@]}" "sudo -n grep -q '^SPACES_AUTH_SECRET=..*' $ENV_FILE" 2>/dev/null; then
  echo "    keeping   SPACES_AUTH_SECRET (existing)"
else
  set_env SPACES_AUTH_SECRET "$(openssl rand -base64 48 | tr -d '\n')" quiet || die "could not set SPACES_AUTH_SECRET"
fi
set_env SPACES_AUTH_URL "$PUBLIC_URL" || die "could not set SPACES_AUTH_URL"

# ----------------------------------------------------------------- database --

step "postgres"
# Package, service, role and database. Idempotent: a redeploy against a working
# database changes nothing and never rotates the password. The password is
# generated here, written to the env file, and never printed (decision 0030).
if ! "${SSH[@]}" "command -v psql >/dev/null 2>&1"; then
  echo "    installing postgresql"
  "${SSH[@]}" "sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-client" >/dev/null 2>&1 \
    || die "could not install postgresql"
fi

"${SSH[@]}" "sudo -n systemctl enable --now postgresql" >/dev/null 2>&1 || die "could not start postgresql"

HAVE_URL=$("${SSH[@]}" "sudo -n grep -c '^SPACES_DATABASE_URL=postgres' $ENV_FILE" 2>/dev/null || echo 0)
HAVE_ROLE=$("${SSH[@]}" "sudo -n -u postgres psql -tAc \"select 1 from pg_roles where rolname='spaces'\"" 2>/dev/null | tr -d '[:space:]')

if [ "${HAVE_ROLE:-}" != "1" ] || [ "${HAVE_URL:-0}" = "0" ]; then
  DB_PASSWORD=$(openssl rand -hex 24)
  ROLE_SQL=$(mktemp)
  printf "do \$\$\nbegin\n  if exists (select 1 from pg_roles where rolname = 'spaces') then\n    alter role spaces with login password '%s';\n  else\n    create role spaces with login password '%s';\n  end if;\nend\n\$\$;\n" \
    "$DB_PASSWORD" "$DB_PASSWORD" > "$ROLE_SQL"
  # Over scp rather than as an argument: a password in argv is readable by every
  # process on the host, even for a moment.
  scp -q "$ROLE_SQL" "$TARGET:/tmp/spaces-role.sql"
  rm -f "$ROLE_SQL"
  # Redirected as the login user (who owns the file), not read by postgres:
  # the password is on stdin, never in an argv, and the file goes immediately.
  "${SSH[@]}" "sudo -n -u postgres psql -v ON_ERROR_STOP=1 -q < /tmp/spaces-role.sql; rc=\$?; rm -f /tmp/spaces-role.sql; exit \$rc" \
    || die "could not create the database role"
  set_env SPACES_DATABASE_URL "postgres://spaces:$DB_PASSWORD@127.0.0.1:5432/spaces" quiet \
    || die "could not set SPACES_DATABASE_URL"
  printf "    %-30s %s\n" "SPACES_DATABASE_URL" "postgres://spaces@127.0.0.1:5432/spaces (password in the env file)"
  unset DB_PASSWORD
else
  echo "    keeping   SPACES_DATABASE_URL (existing)"
fi

"${SSH[@]}" "sudo -n -u postgres psql -tAc \"select 1 from pg_database where datname='spaces'\"" | grep -q 1 \
  || "${SSH[@]}" "sudo -n -u postgres createdb -O spaces spaces" || die "could not create the database"

# The one-way move out of SQLite (decision 0030): stop the API, take a
# consistent snapshot, import it, and leave the snapshot on disk. Skipped when
# the target already holds rows, so a redeploy is a no-op.
LEGACY_DB="$APP_DIR/data/spaces.db"
LEGACY=$("${SSH[@]}" "test -f $LEGACY_DB && echo yes || echo no")
ROWS=$("${SSH[@]}" "sudo -n bash -s" <<'REMOTE_ROWS' | tr -d '[:space:]'
url=$(sed -n 's|^SPACES_DATABASE_URL=||p' /etc/spaces/spaces.env | head -1)
psql "$url" -tAc 'select count(*) from sandboxes' 2>/dev/null || echo 0
REMOTE_ROWS
)

if [ "$LEGACY" = "yes" ] && [ "${ROWS:-0}" = "0" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  echo "    moving    SQLite -> Postgres (snapshot kept in /tmp/spaces-migrate-$STAMP.db)"
  "${SSH[@]}" "sudo -n systemctl stop $APP_NAME" >/dev/null 2>&1 || true
  "${SSH[@]}" "cd '$APP_DIR' && export PATH=\"$R_HOME/.bun/bin:\$PATH\" && bun run scripts/snapshot-sqlite.ts $LEGACY_DB /tmp/spaces-migrate-$STAMP.db" \
    | sed 's/^/    /' || die "could not snapshot the SQLite database"
  # Quoted heredoc: nothing here may be expanded locally, so the arguments carry
  # the values and the connection string is read from the env file as root.
  "${SSH[@]}" "sudo -n bash -s -- '$STAMP' '$BUN' '$APP_DIR'" <<'REMOTE_IMPORT' | sed 's/^/    /' || die "the SQLite import failed; the snapshot is in /tmp/spaces-migrate-$STAMP.db and $APP_NAME is stopped"
set -euo pipefail
stamp=$1
bun=$2
app_dir=$3
url=$(sed -n 's|^SPACES_DATABASE_URL=||p' /etc/spaces/spaces.env | head -1)
cd "$app_dir"
SPACES_DATABASE_URL="$url" "$bun" run scripts/migrate-sqlite-to-postgres.ts "/tmp/spaces-migrate-$stamp.db"
REMOTE_IMPORT
else
  if [ "$LEGACY" = "yes" ]; then echo "    skipping  SQLite import (target already has data)"; else echo "    skipping  SQLite import (no legacy database)"; fi
fi

[ -n "${SPACES_MSB_IMAGE:-}" ] && { set_env SPACES_MSB_IMAGE "$SPACES_MSB_IMAGE" || die "could not set SPACES_MSB_IMAGE"; }
[ -n "${SPACES_NET:-}" ] && { set_env SPACES_NET "$SPACES_NET" || die "could not set SPACES_NET"; }
[ -n "${SPACES_NET_RULES:-}" ] && { set_env SPACES_NET_RULES "$SPACES_NET_RULES" || die "could not set SPACES_NET_RULES"; }

# --------------------------------------------------------------------- unit --

step "service"
sed -e "s|/home/indrazm|$R_HOME|g" deploy/spaces.service \
  | "${SSH[@]}" "sudo -n install -D -m 0644 /dev/stdin /etc/systemd/system/$APP_NAME.service"

"${SSH[@]}" "set -e
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable $APP_NAME >/dev/null 2>&1
  sudo -n systemctl restart $APP_NAME
"

# -------------------------------------------------------------------- serve --

if [ -n "$SERVE" ]; then
  step "tailscale serve (HTTPS)"
  # Idempotent: re-running replaces the previous mapping rather than stacking.
  if "${SSH[@]}" "sudo -n tailscale serve --bg --https=443 http://127.0.0.1:$PORT" 2>&1 | sed 's/^/    /' \
     && "${SSH[@]}" "sudo -n tailscale serve status" 2>/dev/null | grep -q "127.0.0.1:$PORT"; then
    echo "    tls       $PUBLIC_URL"
  else
    die "tailscale serve failed. HTTPS certificates may be disabled for the tailnet:
    enable MagicDNS + HTTPS in the Tailscale admin console, then re-run."
  fi
fi

# --------------------------------------------------------------------- wait --

step "waiting for the API"
healthy=""
for _ in $(seq 1 40); do
  # Always probe loopback: in serve mode that is the only listener, and it is
  # the same process either way.
  if "${SSH[@]}" "curl -fsS -m 2 -o /dev/null http://127.0.0.1:$PORT/health" 2>/dev/null; then
    healthy="yes"
    break
  fi
  sleep 1
done

if [ -z "$healthy" ]; then
  echo
  "${SSH[@]}" "sudo -n journalctl -u $APP_NAME -n 40 --no-pager" | sed 's/^/    /'
  die "API did not become healthy on http://127.0.0.1:$PORT/health (log above)"
fi

# ------------------------------------------------------------------- verify --

step "verify"
# Checks run through the public origin, not loopback: that exercises TLS, the
# serve mapping and the console's same-origin assumption in one request.
remote_code() {
  "${SSH[@]}" "curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 20 '$1'" 2>/dev/null
}
printf "    %-30s %s\n" "GET /health"          "$(remote_code "$PUBLIC_URL/health")"
printf "    %-30s %s\n" "GET / (console)"      "$(remote_code "$PUBLIC_URL/")"
printf "    %-30s %s\n" "GET /api/v1/sandboxes" "$(remote_code "$PUBLIC_URL/api/v1/sandboxes")"
authed=$("${SSH[@]}" "curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H 'Authorization: Bearer $API_KEY' '$PUBLIC_URL/api/v1/sandboxes'" 2>/dev/null)
printf "    %-30s %s\n" "authenticated list"    "HTTP $authed"

"${SSH[@]}" "sudo -n systemctl is-active $APP_NAME" | sed 's/^/    service: /'

if [ "$authed" != "200" ]; then
  die "authenticated request to $PUBLIC_URL returned HTTP $authed — the key in $ENV_FILE may be stale"
fi

cat <<EOF

Deployed.

  console   $PUBLIC_URL
  api       $PUBLIC_URL/api/v1
  api key   in $ENV_FILE (SPACES_API_KEY), not printed here

  Open $PUBLIC_URL and create an account — the console is session-only.
  $ENV_FILE holds the operator key, which API clients use.
  Over SSH instead:  ssh -L $PORT:127.0.0.1:$PORT $TARGET

  service   sudo -n systemctl status $APP_NAME
  logs      sudo -n journalctl -u $APP_NAME -f
  redeploy  $0 $TARGET

EOF
