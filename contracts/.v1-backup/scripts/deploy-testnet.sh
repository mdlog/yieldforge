#!/usr/bin/env bash
set -euo pipefail

# YieldForge — Testnet deploy (blocked until credentials provided)
# Usage: NEAR_ACCOUNT=yieldforge.testnet NEAR_KEY_PATH=~/.near-credentials/testnet/yieldforge.testnet.json ./scripts/deploy-testnet.sh

: "${NEAR_ACCOUNT:?Set NEAR_ACCOUNT to your testnet account (e.g. yieldforge.testnet)}"

NETWORK="testnet"
SERIES_CONTRACT="series.${NEAR_ACCOUNT}"
PT_CONTRACT="pt.${NEAR_ACCOUNT}"
YT_CONTRACT="yt.${NEAR_ACCOUNT}"
MARKET_CONTRACT="market.${NEAR_ACCOUNT}"
STNEAR_CONTRACT="meta-v2.pool.testnet"

echo "=== YieldForge testnet deploy ==="
echo "Network: ${NETWORK}"
echo "Deployer: ${NEAR_ACCOUNT}"
echo "Series:  ${SERIES_CONTRACT}"
echo "PT:      ${PT_CONTRACT}"
echo "YT:      ${YT_CONTRACT}"
echo "Market:  ${MARKET_CONTRACT}"
echo "stNEAR:  ${STNEAR_CONTRACT}"
echo ""

if ! command -v cargo &> /dev/null; then echo "cargo not found"; exit 1; fi
if ! command -v near &> /dev/null; then echo "near-cli not found: npm i -g near-cli"; exit 1; fi

echo "--- Building contracts (release) ---"
cargo build --manifest-path contracts/Cargo.toml --release --target wasm32-unknown-unknown

echo "--- Deploy FT (PT) ---"
near deploy --wasmFile contracts/target/wasm32-unknown-unknown/release/yieldforge_ft.wasm --accountId "${PT_CONTRACT}" --initFunction new --initArgs "{\"owner\":\"${NEAR_ACCOUNT}\",\"controller\":\"${SERIES_CONTRACT}\",\"metadata\":{\"spec\":\"ft-1.0.0\",\"name\":\"YieldForge PT - stNEAR 90D 01\",\"symbol\":\"PT-YF-90D\",\"icon\":null,\"reference\":null,\"reference_hash\":null,\"decimals\":24},\"series_id\":\"stnear-90d-01\",\"maturity\":\"2026-07-18\"}"

echo "--- Deploy FT (YT) ---"
near deploy --wasmFile contracts/target/wasm32-unknown-unknown/release/yieldforge_ft.wasm --accountId "${YT_CONTRACT}" --initFunction new --initArgs "{\"owner\":\"${NEAR_ACCOUNT}\",\"controller\":\"${SERIES_CONTRACT}\",\"metadata\":{\"spec\":\"ft-1.0.0\",\"name\":\"YieldForge YT - stNEAR 90D 01\",\"symbol\":\"YT-YF-90D\",\"icon\":null,\"reference\":null,\"reference_hash\":null,\"decimals\":24},\"series_id\":\"stnear-90d-01\",\"maturity\":\"2026-07-18\"}"

echo "--- Deploy Series ---"
near deploy --wasmFile contracts/target/wasm32-unknown-unknown/release/yieldforge_series.wasm --accountId "${SERIES_CONTRACT}" --initFunction new --initArgs "{\"owner\":\"${NEAR_ACCOUNT}\",\"series_id\":\"stnear-90d-01\",\"underlying_token\":\"${STNEAR_CONTRACT}\",\"pt_token\":\"${PT_CONTRACT}\",\"yt_token\":\"${YT_CONTRACT}\",\"stnear_contract\":\"${STNEAR_CONTRACT}\",\"maturity_at\":\"1780000000000000000\",\"deposits_close_at\":\"1776000000000000000\"}"

echo "--- Deploy Marketplace ---"
near deploy --wasmFile contracts/target/wasm32-unknown-unknown/release/yieldforge_marketplace.wasm --accountId "${MARKET_CONTRACT}" --initFunction new --initArgs "{\"owner\":\"${NEAR_ACCOUNT}\",\"yt_token\":\"${YT_CONTRACT}\",\"series_id\":\"stnear-90d-01\",\"fee_collector\":\"${NEAR_ACCOUNT}\"}"

echo "--- Verify ---"
near view "${SERIES_CONTRACT}" get_series
near view "${MARKET_CONTRACT}" get_config

echo "Done. Update yieldforge/.env with:"
echo "VITE_SERIES_CONTRACT=${SERIES_CONTRACT}"
echo "VITE_PT_CONTRACT=${PT_CONTRACT}"
echo "VITE_YT_CONTRACT=${YT_CONTRACT}"
echo "VITE_MARKETPLACE_CONTRACT=${MARKET_CONTRACT}"
echo "VITE_NEAR_LIVE=true"
