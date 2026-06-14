"use client";

import { useState } from "react";

interface AgentManifest {
  id: string;
  name: string;
  chain?: string;
  capabilities?: string[];
  walletAddress?: string;
  payments: { protocol?: string; asset?: string; network?: string; price?: string }[];
  policies?: { allowedAssets?: string[]; minCounterpartyReputation?: number };
  manifestHash?: string;
  endpoint?: { url?: string };
}

function join(value: string[] | undefined): string {
  return value && value.length > 0 ? value.join(", ") : "-";
}

function short(value: string | undefined): string {
  if (!value) return "-";
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

export function AgentsTable({ manifests }: { manifests: AgentManifest[] }) {
  const [tryAgent, setTryAgent] = useState<AgentManifest | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  async function runAgent() {
    if (!tryAgent || !input.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setReceiptId(null);
    try {
      const res = await fetch(`/api/agents/${tryAgent.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: input }),
      });
      const data = await res.json() as { output?: string; result?: string; receipt?: { runId?: string } };
      setResult(data.output ?? data.result ?? JSON.stringify(data, null, 2));
      if (data.receipt?.runId) setReceiptId(data.receipt.runId);
    } catch (err) {
      setResult(`Error: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          {manifests.map((agent) => (
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
              <td>
                <button className="agents-try-btn" onClick={() => { setTryAgent(agent); setResult(null); setInput(""); setReceiptId(null); }}>
                  TRY
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {tryAgent && (
        <>
          <div className="playground-overlay" onClick={() => setTryAgent(null)} />
          <div className="playground-modal">
            <div className="mod-header">
              PLAYGROUND &mdash; {tryAgent.name}
              <button className="drawer-close" style={{ marginLeft: "auto" }} onClick={() => setTryAgent(null)}>
                &times;
              </button>
            </div>
            <div style={{ padding: "1rem" }}>
              <input
                className="playground-input"
                placeholder={`Enter a task for ${tryAgent.name}…`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runAgent(); }}
                disabled={loading}
              />
              <button
                className="cmd-exec"
                style={{ width: "100%", borderLeft: "none", border: "1px solid var(--border)", borderRadius: "var(--radius)", height: 38, marginTop: 8, justifyContent: "center" }}
                onClick={runAgent}
                disabled={loading || !input.trim()}
              >
                {loading ? <><span className="spinner" /> RUNNING</> : "RUN AGENT"}
              </button>
              {result && (
                <div className="playground-result">
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.72rem", lineHeight: 1.6, color: "var(--text-mid)" }}>
                    {result}
                  </pre>
                  {receiptId && (
                    <a href={`/receipts/${receiptId}`} style={{ fontSize: "0.68rem", color: "var(--accent)", textDecoration: "none" }}>
                      View receipt &rarr;
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
