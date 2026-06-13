# Cal-AgentKit Celo Contracts

EVM/Celo contracts for the Cal-AgentKit portable agent infrastructure layer.

## Contracts

- `AegisCeloRegistry.sol`: agent identity, reputation, and manifest hash registry.
- `AegisCeloPolicy.sol`: per-task and per-session spend policy checks.

## Deploy

Requires Foundry (`forge` and `cast`).

```bash
export CELO_DEPLOYER_PRIVATE_KEY=0x...
export CALAGENT_CELO_NETWORK=alfajores
export CELO_RPC_URL=https://alfajores-forno.celo-testnet.org

npm run deploy:celo-contracts
```

The script prints:

```bash
CELO_REGISTRY_ADDRESS=0x...
CELO_POLICY_ADDRESS=0x...
```

After deploying and running the dashboard, publish Celo agent manifest hashes:

```bash
export CALAGENT_AGENTS_URL=https://your-calagent-domain.com/api/agents?chain=celo
npm run publish:celo-manifest-hashes
```
