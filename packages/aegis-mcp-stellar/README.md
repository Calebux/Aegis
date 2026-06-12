# aegis-mcp-stellar

MCP server for discovering Aegis Stellar agents from the dashboard
`/api/agents` endpoint and calling their external x402-compatible run
endpoints.

This is the first bridge between Aegis agent manifests and MCP-compatible agent
runtimes. It reuses the `@calebux/agent-kit` discovery shape instead of
inventing a separate metadata model.

## Run

Start the Aegis dashboard first:

```bash
npm run dev --workspace=apps/dashboard
```

Then point the MCP server at the dashboard endpoint:

```bash
AEGIS_AGENTS_URL=http://localhost:3000/api/agents npm run build --workspace=packages/aegis-mcp-stellar
AEGIS_AGENTS_URL=http://localhost:3000/api/agents node packages/aegis-mcp-stellar/dist/index.js
```

If `AEGIS_AGENTS_URL` is omitted, the server defaults to
`http://localhost:3000/api/agents`.

## Tools

- `discover_agents`: filter manifests by capability, protocol, asset, network,
  and minimum reputation.
- `get_agent_manifest`: return one manifest by agent ID.
- `aegis_agents_endpoint`: show the `/api/agents` endpoint currently in use.
- `run_agent_task`: run an Aegis task through the dashboard API and return the
  final report plus receipt.
- `call_external_agent`: call one discovered agent through
  `POST /api/agents/:id/run`; returns either a result and `aegis.receipt.v1`
  receipt, or a Stellar USDC x402 payment requirement.
- `get_task_status`: fetch task/subtask state and receipt pointers by task ID.
- `get_run_receipt`: fetch a verifiable Aegis run receipt.
- `verify_run_receipt`: verify a receipt hash chain and Stellar signature.

Typical agent flow:

```text
discover_agents -> call_external_agent -> get_run_receipt -> verify_run_receipt
```

When `AEGIS_X402_ENFORCE=true` is set on the dashboard, `call_external_agent`
will surface the `402 Payment Required` challenge instead of hiding it as an
HTTP error.

## Example MCP Config

```json
{
  "mcpServers": {
    "aegis-stellar": {
      "command": "node",
      "args": ["packages/aegis-mcp-stellar/dist/index.js"],
      "env": {
        "AEGIS_AGENTS_URL": "http://localhost:3000/api/agents"
      }
    }
  }
}
```
