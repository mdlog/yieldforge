#!/usr/bin/env bash
# Build the v3 series contract and shrink it with binaryen's wasm-opt.
# Output: contracts/target/yieldforge_series_v3.wasm (set CARGO_TARGET_DIR to build elsewhere).
set -euo pipefail
cd "$(dirname "$0")/../contracts"

# Use rustup's toolchain (it has the wasm32 std); a standalone Rust install earlier in PATH does not.
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --quiet
cargo build --release --target wasm32-unknown-unknown

RAW=${CARGO_TARGET_DIR:-target}/wasm32-unknown-unknown/release/yieldforge_series.wasm
mkdir -p target
OUT=target/yieldforge_series_v3.wasm
# Keep exactly the wasm features rustc already emits (these are accepted by NEAR testnet).
npx --yes -p binaryen@132 wasm-opt -Oz --strip-debug --strip-producers \
  --enable-sign-ext --enable-mutable-globals --enable-bulk-memory \
  --enable-nontrapping-float-to-int --enable-reference-types --enable-multivalue \
  "$RAW" -o "$OUT" 2>/dev/null || {
  echo "wasm-opt unavailable; deploying the unoptimized build (larger storage stake)"
  cp "$RAW" "$OUT"
}
ls -la "$OUT"
