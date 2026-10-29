#!/usr/bin/env bash
# Install Spacescope.
#
#   ./install.sh                 # build from this checkout and install
#   curl -fsSL https://raw.githubusercontent.com/ForkYeahMan/Spacescope/main/install.sh | bash
#
# Installs the `spacescope` binary into Cargo's bin dir (~/.cargo/bin), which
# is normally already on your PATH. Needs Rust 1.85+; offers to install it.
set -euo pipefail

REPO="https://github.com/ForkYeahMan/Spacescope"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

if ! command -v cargo >/dev/null 2>&1; then
  say "Rust is not installed."
  if [ -t 0 ]; then
    read -r -p "Install it now with rustup? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || die "Install Rust from https://rustup.rs and re-run this script."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  else
    die "Install Rust from https://rustup.rs and re-run this script."
  fi
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/Cargo.toml" ] && grep -q '^name = "spacescope"' "$here/Cargo.toml"; then
  say "Building from $here"
  cargo install --path "$here" --locked --force
else
  say "Building from $REPO"
  cargo install --git "$REPO" --locked --force spacescope
fi

bin="$(dirname "$(command -v cargo)")"
say "Installed. Run:  spacescope"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "    (add $bin to your PATH if the command isn't found)" ;;
esac
