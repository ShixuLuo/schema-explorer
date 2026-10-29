#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/scripts/runtime-env.sh"
exec cargo run --offline --manifest-path "$ROOT/rust/Cargo.toml"
