# A guest image that is ready on first boot.
#
# The stock `alpine` image has no glibc, no curl, no git, and no `procps`, so a
# sandbox that needs any of them pays `apk`/`apt` on every create. This image
# bakes in the tools the API and its clients assume, and creates the sandbox
# user up front so the first command already runs as `user`.
#
#   docker build -t spaces/guest:ubuntu -f deploy/guest/Dockerfile .
#   docker save spaces/guest:ubuntu | msb load -t spaces/guest:ubuntu
#   SPACES_MSB_IMAGE=spaces/guest:ubuntu ./scripts/deploy.sh <host>
#
# Locally built images are loaded into msb's cache, so no registry is needed.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# ca-certificates: HTTPS without surprises.
# curl, git, tar: what every session reaches for first.
# procps: ps/pgrep, which the stock guest lacks (`GET /processes` needs ps -o).
# sudo: boat gives the sandbox user passwordless sudo; this keeps that true.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git tar procps sudo jq unzip \
 && rm -rf /var/lib/apt/lists/*

# The sandbox user, matching boat: uid/gid 1000, HOME=/home/user.
#
# Ubuntu 24.04 already ships a uid-1000 `ubuntu` account, so it has to go first:
# `useradd -u 1000` fails outright while another user holds the id, and the API's
# guest init would then leave commands running as a user that does not exist.
RUN if id -u 1000 >/dev/null 2>&1 && [ "$(id -un 1000)" != user ]; then \
      userdel -r "$(id -un 1000)" >/dev/null 2>&1 || true; \
      groupdel "$(id -gn 1000)" >/dev/null 2>&1 || true; \
    fi \
 && if ! id -u user >/dev/null 2>&1; then \
      useradd -m -u 1000 -d /home/user -s /bin/bash user; \
    fi \
 && mkdir -p /home/user \
 && chown -R 1000:1000 /home/user \
 && (echo 'user ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/spaces-user) \
 && chmod 0440 /etc/sudoers.d/spaces-user

WORKDIR /home/user

# Deliberately NOT `USER user`.
#
# If the image's default user is not root, `msb exec` can never be root again,
# and the operator plumbing that must change the system — `SPACES_BOOTSTRAP`
# installing packages, sshd provisioning — silently degrades to unprivileged.
# The API drops to `user` per command instead (see docs/internals.md), which
# keeps normal commands unprivileged and root available where it is asked for.
CMD ["sleep", "infinity"]