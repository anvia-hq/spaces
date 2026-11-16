#!/usr/bin/env bash
# Install the microsandbox `msb` CLI locally, or on a remote hypervisor host.
#   ./scripts/install-msb.sh              # this machine
#   ./scripts/install-msb.sh big-machine  # over SSH
set -euo pipefail

TARGET="${1:-local}"

if [ "$TARGET" = "local" ]; then
  echo "==> installing msb locally"
  curl -fsSL https://install.microsandbox.dev | sh
  echo
  msb --version 2>/dev/null || "$HOME/.local/bin/msb" --version
  echo
  echo "==> host check"
  msb doctor 2>/dev/null || "$HOME/.local/bin/msb" doctor
  echo
  echo "Done. Start the API with the default config, or set SPACES_MSB_HOST to a remote host."
  exit 0
fi

echo "==> installing msb on $TARGET"
ssh "$TARGET" 'curl -fsSL https://install.microsandbox.dev | sh'
echo
echo "==> host check"
ssh "$TARGET" '~/.local/bin/msb doctor' || ssh "$TARGET" 'PATH=$HOME/.local/bin:$PATH msb doctor'
echo
echo "Done. Point the API at it:"
echo "  SPACES_MSB_HOST=$TARGET bun run dev:api"