#!/usr/bin/env bash
set -euo pipefail

: "${CELO_DEPLOYER_PRIVATE_KEY:?Set CELO_DEPLOYER_PRIVATE_KEY}"

NETWORK="${CALAGENT_CELO_NETWORK:-alfajores}"
RPC_URL="${CELO_RPC_URL:-https://alfajores-forno.celo-testnet.org}"
ADMIN_ADDRESS="${CELO_ADMIN_ADDRESS:-}"
GAS_PRICE_WEI="${CELO_GAS_PRICE_WEI:-}"

if [[ "$NETWORK" == "mainnet" && -z "${CELO_RPC_URL:-}" ]]; then
  RPC_URL="https://forno.celo.org"
fi

if [[ -z "$ADMIN_ADDRESS" ]]; then
  ADMIN_ADDRESS="$(cast wallet address --private-key "$CELO_DEPLOYER_PRIVATE_KEY")"
fi
DEPLOYER_ADDRESS="$(cast wallet address --private-key "$CELO_DEPLOYER_PRIVATE_KEY")"

wait_for_nonce() {
  local target_nonce="$1"
  local current_nonce

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    current_nonce="$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL")"
    if (( current_nonce >= target_nonce )); then
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for nonce $target_nonce; continuing anyway." >&2
}

echo "Deploying Cal-AgentKit Celo contracts"
echo "Network: $NETWORK"
echo "RPC: $RPC_URL"
echo "Admin: $ADMIN_ADDRESS"
if [[ -n "$GAS_PRICE_WEI" ]]; then
  echo "Gas price: $GAS_PRICE_WEI wei"
fi
REGISTRY_NONCE="$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL")"

if [[ -n "$GAS_PRICE_WEI" ]]; then
  REGISTRY_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      --legacy \
      --gas-price "$GAS_PRICE_WEI" \
      src/AegisCeloRegistry.sol:AegisCeloRegistry \
      --constructor-args "$ADMIN_ADDRESS"
  )"
else
  REGISTRY_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      src/AegisCeloRegistry.sol:AegisCeloRegistry \
      --constructor-args "$ADMIN_ADDRESS"
  )"
fi
echo "$REGISTRY_OUTPUT"
REGISTRY_ADDRESS="$(echo "$REGISTRY_OUTPUT" | awk '/Deployed to:/ { print $3 }')"
wait_for_nonce "$((REGISTRY_NONCE + 1))"

if [[ -n "$GAS_PRICE_WEI" ]]; then
  POLICY_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      --legacy \
      --gas-price "$GAS_PRICE_WEI" \
      src/AegisCeloPolicy.sol:AegisCeloPolicy \
      --constructor-args "$ADMIN_ADDRESS"
  )"
else
  POLICY_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      src/AegisCeloPolicy.sol:AegisCeloPolicy \
      --constructor-args "$ADMIN_ADDRESS"
  )"
fi
echo "$POLICY_OUTPUT"
POLICY_ADDRESS="$(echo "$POLICY_OUTPUT" | awk '/Deployed to:/ { print $3 }')"

cat <<EOF

Add these to your environment:

CELO_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
CELO_POLICY_ADDRESS=$POLICY_ADDRESS
CELO_RPC_URL=$RPC_URL
CALAGENT_CELO_NETWORK=$NETWORK
EOF
