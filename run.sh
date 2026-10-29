#!/usr/bin/env bash
# Build (release) and launch Spacescope from this checkout.
# Any flags are passed through:  ./run.sh --home --port 9000
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --quiet
exec ./target/release/spacescope "$@"
