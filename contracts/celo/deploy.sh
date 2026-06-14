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
POLICY_NONCE="$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL")"
wait_for_nonce "$POLICY_NONCE"

# ── ERC-8004 Adapter ──────────────────────────────────────────────────────────
ERC8004_IDENTITY="${ERC8004_IDENTITY_REGISTRY:-0x8004A169FB4a3325136EB29fA0ceB6D2e539a432}"
ERC8004_REPUTATION="${ERC8004_REPUTATION_REGISTRY:-0x8004BAa17C55a88189AE136b182e5fdA19dE9b63}"

echo "Deploying Erc8004Adapter..."
echo "ERC-8004 Identity Registry: $ERC8004_IDENTITY"
echo "ERC-8004 Reputation Registry: $ERC8004_REPUTATION"

if [[ -n "$GAS_PRICE_WEI" ]]; then
  ADAPTER_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      --legacy \
      --gas-price "$GAS_PRICE_WEI" \
      src/Erc8004Adapter.sol:Erc8004Adapter \
      --constructor-args "$ADMIN_ADDRESS" "$ERC8004_IDENTITY" "$ERC8004_REPUTATION"
  )"
else
  ADAPTER_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      src/Erc8004Adapter.sol:Erc8004Adapter \
      --constructor-args "$ADMIN_ADDRESS" "$ERC8004_IDENTITY" "$ERC8004_REPUTATION"
  )"
fi
echo "$ADAPTER_OUTPUT"
ERC8004_ADAPTER_ADDRESS="$(echo "$ADAPTER_OUTPUT" | awk '/Deployed to:/ { print $3 }')"

# ── Agent Staking ────────────────────────────────────────────────────────────
USDM_TOKEN="${CELO_USDM_TOKEN:-0x765DE816845861e75A25fCA122bb6898B8B1282a}"
COOLDOWN_SECONDS="${CELO_STAKING_COOLDOWN:-86400}"

echo "Deploying AgentStaking..."
echo "USDm token: $USDM_TOKEN"
echo "Cooldown: ${COOLDOWN_SECONDS}s"

STAKING_NONCE="$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL")"
if [[ -n "$GAS_PRICE_WEI" ]]; then
  STAKING_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      --legacy \
      --gas-price "$GAS_PRICE_WEI" \
      src/AgentStaking.sol:AgentStaking \
      --constructor-args "$ADMIN_ADDRESS" "$USDM_TOKEN" "$COOLDOWN_SECONDS"
  )"
else
  STAKING_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      src/AgentStaking.sol:AgentStaking \
      --constructor-args "$ADMIN_ADDRESS" "$USDM_TOKEN" "$COOLDOWN_SECONDS"
  )"
fi
echo "$STAKING_OUTPUT"
STAKING_ADDRESS="$(echo "$STAKING_OUTPUT" | awk '/Deployed to:/ { print $3 }')"
wait_for_nonce "$((STAKING_NONCE + 1))"

# ── Consensus Voting ─────────────────────────────────────────────────────────
echo "Deploying ConsensusVoting..."

VOTING_NONCE="$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL")"
if [[ -n "$GAS_PRICE_WEI" ]]; then
  VOTING_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      --legacy \
      --gas-price "$GAS_PRICE_WEI" \
      src/ConsensusVoting.sol:ConsensusVoting \
      --constructor-args "$ADMIN_ADDRESS"
  )"
else
  VOTING_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      src/ConsensusVoting.sol:ConsensusVoting \
      --constructor-args "$ADMIN_ADDRESS"
  )"
fi
echo "$VOTING_OUTPUT"
VOTING_ADDRESS="$(echo "$VOTING_OUTPUT" | awk '/Deployed to:/ { print $3 }')"

# ── Task Escrow ──────────────────────────────────────────────────────────────
echo "Deploying TaskEscrow..."
echo "USDm token: $USDM_TOKEN"

ESCROW_NONCE="$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL")"
if [[ -n "$GAS_PRICE_WEI" ]]; then
  ESCROW_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      --legacy \
      --gas-price "$GAS_PRICE_WEI" \
      src/TaskEscrow.sol:TaskEscrow \
      --constructor-args "$ADMIN_ADDRESS" "$USDM_TOKEN"
  )"
else
  ESCROW_OUTPUT="$(
    forge create \
      --rpc-url "$RPC_URL" \
      --private-key "$CELO_DEPLOYER_PRIVATE_KEY" \
      --broadcast \
      src/TaskEscrow.sol:TaskEscrow \
      --constructor-args "$ADMIN_ADDRESS" "$USDM_TOKEN"
  )"
fi
echo "$ESCROW_OUTPUT"
ESCROW_ADDRESS="$(echo "$ESCROW_OUTPUT" | awk '/Deployed to:/ { print $3 }')"

cat <<EOF

Add these to your environment:

CELO_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
CELO_POLICY_ADDRESS=$POLICY_ADDRESS
ERC8004_ADAPTER_ADDRESS=$ERC8004_ADAPTER_ADDRESS
CELO_STAKING_ADDRESS=$STAKING_ADDRESS
CELO_CONSENSUS_VOTING_ADDRESS=$VOTING_ADDRESS
CELO_TASK_ESCROW_ADDRESS=$ESCROW_ADDRESS
CELO_RPC_URL=$RPC_URL
CALAGENT_CELO_NETWORK=$NETWORK
EOF
