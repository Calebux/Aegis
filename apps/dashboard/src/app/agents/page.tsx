import type { CSSProperties } from "react";
import { buildAgentManifests } from "@/lib/agentRegistry";

type AgentsPageProps = {
  searchParams?: Promise<{
    chain?: string;
  }>;
};

function join(value: string[] | undefined): string {
  return value && value.length > 0 ? value.join(", ") : "-";
}

function short(value: string | undefined): string {
  if (!value) return "-";
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function filterHref(chain?: string): string {
  return chain ? `/agents?chain=${encodeURIComponent(chain)}` : "/agents";
}

function filterStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 34,
    padding: "0 12px",
    border: "1px solid var(--border)",
    background: active ? "var(--text)" : "transparent",
    color: active ? "var(--bg)" : "var(--text)",
    textDecoration: "none",
    fontSize: 13,
  };
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const params = await searchParams;
  const chain = params?.chain;
  const agents = buildAgentManifests().filter((agent) =>
    chain ? agent.chain === chain : true
  );

  return (
    <div className="receipt-page">
      <div className="module receipt-page-title">
        <h1>Agent Registry</h1>
        <p>
          Discoverable Aegis agent manifests for Celo-native agent routing,
          x402 payments, policy checks, and MCP tooling.
        </p>
      </div>

      <div className="module">
        <div className="mod-header">
          AGENTS
          <span style={{ marginLeft: "auto" }}>{agents.length}</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <a href={filterHref()} style={filterStyle(!chain)}>
            All
          </a>
          <a href={filterHref("celo")} style={filterStyle(chain === "celo")}>
            Celo
          </a>
        </div>
        <table className="receipt-detail-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Chain</th>
              <th>Capabilities</th>
              <th>Wallet</th>
              <th>Payments</th>
              <th>Policy</th>
              <th>Manifest</th>
              <th>Endpoint</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td>
                  <strong>{agent.name}</strong>
                  <br />
                  <span>{agent.id}</span>
                </td>
                <td>{agent.chain ?? "-"}</td>
                <td>{join(agent.capabilities)}</td>
                <td>{short(agent.walletAddress)}</td>
                <td>
                  {agent.payments
                    .map((payment) =>
                      [payment.protocol, payment.asset, payment.network, payment.price]
                        .filter(Boolean)
                        .join(" / ")
                    )
                    .join("; ")}
                </td>
                <td>
                  assets: {join(agent.policies?.allowedAssets)}
                  <br />
                  min rep: {agent.policies?.minCounterpartyReputation ?? "-"}
                </td>
                <td>{short(agent.manifestHash)}</td>
                <td>{agent.endpoint?.url ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
