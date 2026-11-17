#!/bin/sh
# Prove a starter guest image really has its toolchain on the PATH a command
# gets — not just in an interactive shell.
#
#   msb exec <sandbox> -- sh deploy/guest/guest-toolchain-probe.sh \$'...script...'
#
# The first half is the API's own `GUEST_INIT`, copied out of
# apps/api/src/modules/driver/microsandbox.ts; the second half is its
# `AS_GUEST_USER` wrapper, which is what `msb exec` runs for every unprivileged
# command. Running both means the probe fails for the same reasons a real
# request would.
#
# The script to check is `$1`. `msb exec -- sh -c` has its own trap: everything
# after `sh` becomes the positional list, so a folded `set --` does not see it —
# pass the script straight to this file instead.
#
set -eu

mkdir -p /home/user
if ! id -u user >/dev/null 2>&1; then
  useradd -m -u 1000 -d /home/user -s /bin/sh user >/dev/null 2>&1 || true
fi
chown -R 1000:1000 /home/user 2>/dev/null || true
if [ -d /etc/sudoers.d ]; then
  echo 'user ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/spaces-user
  chmod 0440 /etc/sudoers.d/spaces-user
fi
chmod 1777 /tmp 2>/dev/null || true

# The snippet below is the driver's wrapper verbatim: `$1` is the folded script.
s=$1
if [ "$(id -u)" = 0 ] && id -u user >/dev/null 2>&1; then
  if command -v su >/dev/null 2>&1; then
    exec su user -s /bin/sh -c "$s"
  fi
  if command -v setpriv >/dev/null 2>&1 && setpriv --reuid=0 true >/dev/null 2>&1; then
    exec setpriv --reuid=1000 --regid=1000 --clear-groups \
      env HOME=/home/user USER=user sh -c "$s"
  fi
fi
exec sh -c "$s"
