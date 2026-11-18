#!/usr/bin/env bash
# Installs a spaces runtime on this machine: the `spaces` command, then a service that dials out
# to a control plane and runs sandboxes (decision 0043).
#
# Register a runtime in the console (Runtimes > Register) and run what it shows, here:
#
#   curl -fsSL https://raw.githubusercontent.com/anvia-hq/spaces/main/install.sh | bash -s -- \
#     --runtime --url https://spaces.example.com --token spr_...
#
# Everything after `bash -s --` goes to `spaces install` (see `spaces help`):
#   --runtime            install a runtime (the only thing this installs)
#   --url URL            the control plane's address
#   --token TOKEN        the runtime's token (or set SPACES_RUNTIME_TOKEN, to keep it out of `ps`)
#   --public-host HOST   host clients use to reach this runtime's published ports
#   --image REF          OCI image for new sandboxes
#
# Run it again, with no arguments, to update: the settings in ~/.spaces/runtime.env are kept.
#
# Settings, as environment variables:
#   SPACES_INSTALL_REF   a branch or tag to install (default: main)
#   SPACES_SOURCE_URL    where the source archive comes from (default: GitHub's archive of the ref)
#   SPACES_HOME          where everything lives (default: ~/.spaces)
#   SPACES_BIN_DIR       where to put `spaces` (default: /usr/local/bin if writable, else ~/.local/bin)
#   SPACES_YES=1         install Bun and msb without asking when they are missing
set -euo pipefail

REF="${SPACES_INSTALL_REF:-main}"
SOURCE_URL="${SPACES_SOURCE_URL:-https://github.com/anvia-hq/spaces/archive/${REF}.tar.gz}"
HOME_DIR="${SPACES_HOME:-$HOME/.spaces}"

say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Piped to bash, stdin is the script, so a question needs the terminal, and it needs someone
# watching: with output going to a pipe or a file there is nobody to answer.
have_tty() { [ -t 1 ] && (: </dev/tty) 2>/dev/null; }

ask() {
  if [ "${SPACES_YES:-}" = 1 ]; then return 0; fi
  have_tty || return 1
  local reply
  printf '%s [y/N] ' "$1" >/dev/tty
  read -r reply </dev/tty || return 1
  case "$reply" in [yY]*) return 0 ;; *) return 1 ;; esac
}

detect_platform() {
  case "$(uname -s)" in
    Darwin | Linux) ;;
    *) fail "spaces installs on macOS and Linux. On Windows, use WSL2 with Ubuntu and run this there." ;;
  esac
}

need_tools() {
  local tool
  for tool in curl tar; do have "$tool" || fail "$tool is required."; done
}

find_bun() {
  if have bun; then command -v bun; return; fi
  if [ -x "$HOME/.bun/bin/bun" ]; then printf '%s\n' "$HOME/.bun/bin/bun"; return; fi
  return 1
}

find_msb() {
  if have msb; then command -v msb; return; fi
  local path
  for path in "$HOME/.microsandbox/bin/msb" "$HOME/.local/bin/msb"; do
    if [ -x "$path" ]; then printf '%s\n' "$path"; return; fi
  done
  return 1
}

ensure_bun() {
  find_bun >/dev/null && return 0
  say "Bun is missing. spaces is written in TypeScript and runs on it."
  ask "Install Bun now (bun.sh/install)?" || fail "Install Bun (https://bun.sh), then run this again."
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || fail "Bun's installer failed."
  find_bun >/dev/null || fail "Bun was installed but is not at ~/.bun/bin/bun."
}

ensure_msb() {
  find_msb >/dev/null && return 0
  say "msb (microsandbox) is missing. It is the hypervisor layer sandboxes run on."
  ask "Install msb now (install.microsandbox.dev)?" || fail "Install msb (https://microsandbox.dev), then run this again."
  curl -fsSL https://install.microsandbox.dev | sh >/dev/null 2>&1 || fail "msb's installer failed."
  find_msb >/dev/null || fail "msb was installed but could not be found."
}

# The new tree is built beside the old one and swapped in by rename, so a runtime that is
# running from the old one is never half-replaced, and a failed download changes nothing.
fetch_source() {
  local tmp archive src="$HOME_DIR/src"
  tmp="$(mktemp -d)"
  archive="$tmp/source.tar.gz"
  say "Fetching spaces ($REF)..."
  curl -fsSL "$SOURCE_URL" -o "$archive" || { rm -rf "$tmp"; fail "Could not download $SOURCE_URL. Does the ref '$REF' exist?"; }
  mkdir -p "$HOME_DIR"
  rm -rf "$src.new" "$src.old"
  mkdir -p "$src.new"
  tar -xzf "$archive" -C "$src.new" --strip-components=1 || { rm -rf "$tmp" "$src.new"; fail "Could not unpack the source archive."; }
  rm -rf "$tmp"
  [ -f "$src.new/apps/cli/src/main.ts" ] || { rm -rf "$src.new"; fail "That archive is not a spaces source tree (no apps/cli)."; }
  printf '%s\n' "$REF" >"$src.new/.spaces-ref"
  if [ -d "$src" ]; then mv "$src" "$src.old"; fi
  mv "$src.new" "$src"
  rm -rf "$src.old"
}

install_dependencies() {
  say "Installing dependencies..."
  (cd "$HOME_DIR/src" && "$bun" install --frozen-lockfile >/dev/null 2>&1 || "$bun" install >/dev/null 2>&1) \
    || fail "bun install failed in $HOME_DIR/src."
}

pick_bin_dir() {
  if [ -n "${SPACES_BIN_DIR:-}" ]; then bin_dir="$SPACES_BIN_DIR"
  elif [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then bin_dir=/usr/local/bin
  else bin_dir="$HOME/.local/bin"
  fi
}

# A launcher, not a copy: `spaces` is always the source that was just fetched.
write_launcher() {
  mkdir -p "$bin_dir"
  printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$bun" "$HOME_DIR/src/apps/cli/src/main.ts" >"$bin_dir/.spaces.new"
  chmod 755 "$bin_dir/.spaces.new"
  mv -f "$bin_dir/.spaces.new" "$bin_dir/spaces"
}

ensure_on_path() {
  case ":$PATH:" in *":$bin_dir:"*) return ;; esac
  local rc
  case "${SHELL:-}" in */zsh) rc="$HOME/.zshrc" ;; */bash) rc="$HOME/.bashrc" ;; *) rc="" ;; esac
  if [ -n "$rc" ]; then
    if ! grep -qsF "$bin_dir" "$rc"; then
      # The $PATH stays literal: the startup file expands it.
      # shellcheck disable=SC2016
      printf '\nexport PATH="%s:$PATH"\n' "$bin_dir" >>"$rc"
    fi
    say "$bin_dir is on your PATH in $rc. Open a new terminal to use \`spaces\`."
  else
    say "Add $bin_dir to your PATH to use \`spaces\`."
  fi
}

usage() {
  cat <<'USAGE'
Installs a spaces runtime: a service on this machine that runs sandboxes for a control plane.

Register a runtime in the console (Runtimes > Register) and run what it shows:

  curl -fsSL https://raw.githubusercontent.com/anvia-hq/spaces/main/install.sh | bash -s -- \
    --runtime --url https://spaces.example.com --token spr_...

Everything after `bash -s --` goes to `spaces install` (see `spaces help`). Run it again, with no
arguments, to update.

Settings, as environment variables:
  SPACES_INSTALL_REF   a branch or tag to install (default: main)
  SPACES_SOURCE_URL    where the source archive comes from (default: GitHub's archive of the ref)
  SPACES_HOME          where everything lives (default: ~/.spaces)
  SPACES_BIN_DIR       where to put `spaces` (default: /usr/local/bin if writable, else ~/.local/bin)
  SPACES_YES=1         install Bun and msb without asking when they are missing
USAGE
}

main() {
  case "${1:-}" in
    -h | --help) usage; exit 0 ;;
  esac

  if [ $# -eq 0 ]; then
    [ -f "$HOME_DIR/runtime.env" ] || { usage; fail "Nothing to update here, and no arguments: pass --runtime, --url and --token."; }
    set -- --runtime
  fi

  detect_platform
  need_tools
  ensure_bun
  ensure_msb
  bun="$(find_bun)"
  fetch_source
  install_dependencies
  pick_bin_dir
  write_launcher
  ensure_on_path

  exec "$bun" "$HOME_DIR/src/apps/cli/src/main.ts" install "$@"
}

main "$@"
