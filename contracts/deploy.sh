#!/usr/bin/env bash
# Deploy and initialize both Soroban contracts to Stellar testnet.
# Run from the repo root:  bash contracts/deploy.sh
#
# Prerequisites:
#   - stellar CLI installed  (stellar --version)
#   - wasm32-unknown-unknown target:  rustup target add wasm32-unknown-unknown
#   - calagent-admin key in stellar keystore:  stellar keys generate calagent-admin --network testnet --fund
#
# Output: prints SHIELD_CONTRACT_ID and REGISTRY_CONTRACT_ID — paste into .env.local

set -euo pipefail

ADMIN_ALIAS="calagent-admin"
NETWORK="testnet"
WASM_DIR="contracts/target/wasm32-unknown-unknown/release"

echo ""
echo "=== CAL-AGENTKIT — Soroban Contract Deployment ==="
echo ""

# ── 0. Fund admin if needed ──────────────────────────────────────────────────
ADMIN_PK=$(stellar keys public-key "$ADMIN_ALIAS")
echo "Admin pubkey: $ADMIN_PK"

BALANCE=$(curl -s "https://horizon-testnet.stellar.org/accounts/$ADMIN_PK" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); b=[x for x in d.get('balances',[]) if x['asset_type']=='native']; print(b[0]['balance'] if b else 'unfunded')" 2>/dev/null || echo "unfunded")

if [[ "$BALANCE" == "unfunded" ]]; then
  echo "Funding admin account via Friendbot..."
  curl -s "https://friendbot.stellar.org?addr=$ADMIN_PK" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Funded! hash:', d.get('hash','(no hash)'))"
  sleep 3
else
  echo "Admin balance: $BALANCE XLM ✓"
fi

# ── 1. Build ──────────────────────────────────────────────────────────────────
echo ""
echo "Building contracts..."
cd contracts
cargo build --target wasm32-unknown-unknown --release --quiet
cd ..
echo "Build complete ✓"

# ── 2. Deploy Shield Contract ─────────────────────────────────────────────────
echo ""
echo "Deploying Shield Contract..."
SHIELD_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/shield_contract.wasm" \
  --source-account "$ADMIN_ALIAS" \
  --network "$NETWORK" 2>&1 | tail -1)
echo "Shield Contract ID: $SHIELD_ID"

# ── 3. Initialize Shield Contract ────────────────────────────────────────────
echo ""
echo "Initializing Shield Contract..."
stellar contract invoke \
  --id "$SHIELD_ID" \
  --source-account "$ADMIN_ALIAS" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_PK"
echo "Shield initialized ✓"

# ── 4. Deploy Identity Registry ───────────────────────────────────────────────
echo ""
echo "Deploying Identity Registry..."
REGISTRY_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/identity_registry.wasm" \
  --source-account "$ADMIN_ALIAS" \
  --network "$NETWORK" 2>&1 | tail -1)
echo "Identity Registry ID: $REGISTRY_ID"

# ── 5. Initialize Identity Registry ──────────────────────────────────────────
echo ""
echo "Initializing Identity Registry..."
stellar contract invoke \
  --id "$REGISTRY_ID" \
  --source-account "$ADMIN_ALIAS" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_PK"
echo "Identity Registry initialized ✓"

# ── 6. Print env vars ─────────────────────────────────────────────────────────
echo ""
echo "=== Add these to apps/dashboard/.env.local ==="
echo ""
echo "SHIELD_CONTRACT_ID=$SHIELD_ID"
echo "REGISTRY_CONTRACT_ID=$REGISTRY_ID"
echo ""
echo "Done! ✓"
