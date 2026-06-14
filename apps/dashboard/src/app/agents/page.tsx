import type { CSSProperties } from "react";
import { buildAgentManifests } from "@/lib/agentRegistry";
import { AgentsTable } from "@/components/AgentsTable";

type AgentsPageProps = {
  searchParams?: Promise<{
    chain?: string;
  }>;
};

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
          Discoverable Cal-AgentKit agent manifests for Celo-native agent routing,
          x402 payments, policy checks, and MCP tooling.
        </p>
      </div>

      <div className="module">
        <div className="mod-header">
          AGENTS
          <span style={{ marginLeft: "auto" }}>{agents.length}</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", padding: "0.5rem 0.75rem 0" }}>
          <a href={filterHref()} style={filterStyle(!chain)}>
            All
          </a>
          <a href={filterHref("celo")} style={filterStyle(chain === "celo")}>
            Celo
          </a>
        </div>
        <AgentsTable manifests={agents as Parameters<typeof AgentsTable>[0]["manifests"]} />
      </div>
    </div>
  );
}
