"use client";

/**
 * Aegis Dashboard — main page
 *
 * Sections:
 *  1. Task input
 *  2. Agent status cards (2 × 2 grid)
 *  3. Live execution log (terminal)
 *  4. Final report (markdown)
 *  5. Spend summary footer
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { AgentCard, type AgentStatus } from "@/components/AgentCard";

// ── Types ────────────────────────────────────────────────────────────────────

type AgentId = "scout" | "ledger" | "signal" | "scribe";

interface LogEntry {
  id: number;
  message: string;
  level: "info" | "success" | "error";
}

interface CompletePayload {
  report: string;
  wallets: Record<AgentId, string>;
  spent: Record<AgentId, number>;
  reputation: Record<AgentId, number>;
  timestamp: string;
}

// ── Agent metadata ────────────────────────────────────────────────────────────

const AGENTS: { id: AgentId; name: string; icon: string; capability: string }[] = [
  { id: "scout",  name: "Scout",  icon: "🔍", capability: "Web Research" },
  { id: "ledger", name: "Ledger", icon: "📊", capability: "On-Chain Data" },
  { id: "signal", name: "Signal", icon: "📈", capability: "Market Intelligence" },
  { id: "scribe", name: "Scribe", icon: "✍️", capability: "Report Synthesis" },
];

const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/account";

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/_(.*?)_/g, "<em>$1</em>");
}

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("# ")) {
      nodes.push(<h1 key={key++}>{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      nodes.push(<h2 key={key++}>{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      nodes.push(<h3 key={key++}>{line.slice(4)}</h3>);
    } else if (line === "---") {
      nodes.push(<hr key={key++} />);
    } else if (line.startsWith("| ")) {
      // Collect table block
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines
        .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
        .filter((r) => !r.every((c) => /^[-:]+$/.test(c)));
      if (rows.length > 0) {
        const [header, ...body] = rows;
        nodes.push(
          <table key={key++}>
            <thead>
              <tr>{header?.map((c, j) => <th key={j}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci} dangerouslySetInnerHTML={{ __html: renderInline(c) }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
      continue;
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={key++}>
          {items.map((item, j) => (
            <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
          ))}
        </ul>
      );
      continue;
    } else if (line.startsWith("1. ") || /^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      nodes.push(
        <ol key={key++} style={{ marginLeft: "1.5rem", marginBottom: "1rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {items.map((item, j) => (
            <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
          ))}
        </ol>
      );
      continue;
    } else if (line.trim() !== "") {
      nodes.push(
        <p key={key++} dangerouslySetInnerHTML={{ __html: renderInline(line) }} />
      );
    }

    i++;
  }

  return <div className="report-body">{nodes}</div>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: number): string {
  return (stroops / 1e7).toFixed(4);
}

function bpsToScore(bps: number): string {
  return (bps / 100).toFixed(2);
}

function truncateKey(key: string): string {
  if (!key || key.length < 12) return key || "—";
  return key.slice(0, 8) + "…" + key.slice(-6);
}

function formatTs(message: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agentStatus, setAgentStatus] = useState<Record<AgentId, AgentStatus>>({
    scout: "idle", ledger: "idle", signal: "idle", scribe: "idle",
  });
  const [agentSpent, setAgentSpent] = useState<Record<AgentId, number>>({
    scout: 0, ledger: 0, signal: 0, scribe: 0,
  });
  const [wallets, setWallets] = useState<Record<AgentId, string>>({
    scout: "", ledger: "", signal: "", scribe: "",
  });
  const [reputation, setReputation] = useState<Record<AgentId, number>>({
    scout: 5000, ledger: 5000, signal: 5000, scribe: 5000,
  });
  const [report, setReport] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);
  const logCounterRef = useRef(0);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = useCallback((message: string, level: LogEntry["level"] = "info") => {
    setLogs((prev) => [
      ...prev,
      { id: logCounterRef.current++, message, level },
    ]);
  }, []);

  async function runAegis() {
    if (!task.trim() || running) return;

    setRunning(true);
    setHasRun(true);
    setLogs([]);
    setReport(null);
    logCounterRef.current = 0;
    setAgentStatus({ scout: "idle", ledger: "idle", signal: "idle", scribe: "idle" });
    setAgentSpent({ scout: 0, ledger: 0, signal: 0, scribe: 0 });
    setWallets({ scout: "", ledger: "", signal: "", scribe: "" });
    setReputation({ scout: 5000, ledger: 5000, signal: 5000, scribe: 5000 });

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`API error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          try {
            const { type, payload } = JSON.parse(chunk.slice(6)) as {
              type: string;
              payload: unknown;
            };

            if (type === "log") {
              const p = payload as { message: string; level?: LogEntry["level"] };
              addLog(p.message, p.level ?? "info");
            } else if (type === "agent_status") {
              const p = payload as { agent: AgentId; status: AgentStatus; spent?: number };
              setAgentStatus((prev) => ({ ...prev, [p.agent]: p.status }));
              if (p.spent !== undefined) {
                setAgentSpent((prev) => ({ ...prev, [p.agent]: p.spent! }));
              }
            } else if (type === "wallets") {
              setWallets(payload as Record<AgentId, string>);
            } else if (type === "complete") {
              const p = payload as CompletePayload;
              setReport(p.report);
              setAgentSpent(p.spent);
              setReputation(p.reputation);
              setWallets(p.wallets);
            } else if (type === "error") {
              const p = payload as { message: string };
              addLog(`Error: ${p.message}`, "error");
            }
          } catch {
            // skip malformed SSE frames
          }
        }
      }
    } catch (err) {
      addLog(`Fatal: ${String(err)}`, "error");
    } finally {
      setRunning(false);
    }
  }

  const totalSpent = Object.values(agentSpent).reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>

      {/* ── Task Input ──────────────────────────────────────────────────── */}
      <section>
        <h2 style={{ marginBottom: "0.75rem" }}>Research Task</h2>
        <div
          style={{
            background: "#0d1628",
            border: "1px solid #1a2a45",
            borderRadius: "0.75rem",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.875rem",
          }}
        >
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAegis();
            }}
            placeholder="Enter a research task for Aegis…  (e.g. "Analyze DeFi adoption in emerging markets and key Stellar opportunities")"
            disabled={running}
            rows={3}
            style={{
              width: "100%",
              background: "#060c18",
              border: "1px solid #1a2a45",
              borderRadius: "0.5rem",
              padding: "0.75rem 1rem",
              color: "#f0f4f8",
              fontSize: "0.9375rem",
              fontFamily: "inherit",
              lineHeight: 1.5,
              resize: "vertical",
              outline: "none",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#1b6ca8")}
            onBlur={(e) => (e.target.style.borderColor = "#1a2a45")}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
            <span style={{ fontSize: "0.75rem", color: "#7a93b0" }}>
              ⌘↵ to run · Scout → Ledger → Signal run in parallel · Scribe synthesizes
            </span>
            <button
              onClick={runAegis}
              disabled={running || !task.trim()}
              style={{
                background: running || !task.trim() ? "#0d2d4a" : "#1b6ca8",
                color: running || !task.trim() ? "#7a93b0" : "#fff",
                border: "none",
                borderRadius: "0.5rem",
                padding: "0.625rem 1.5rem",
                fontWeight: 600,
                fontSize: "0.9375rem",
                cursor: running || !task.trim() ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                transition: "background 0.2s",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {running ? (
                <>
                  <span className="spinner" style={{ borderTopColor: "#7a93b0" }} />
                  Running…
                </>
              ) : (
                "▶ Run Aegis"
              )}
            </button>
          </div>
        </div>
      </section>

      {/* ── Agent Cards (2 × 2) ─────────────────────────────────────────── */}
      <section>
        <h2>Agent Status</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "1rem",
          }}
        >
          {AGENTS.map((agent) => (
            <AgentCard
              key={agent.id}
              name={agent.name}
              icon={agent.icon}
              capability={agent.capability}
              status={agentStatus[agent.id]}
              wallet={wallets[agent.id]}
              spent={agentSpent[agent.id]}
              reputation={reputation[agent.id]}
            />
          ))}
        </div>
      </section>

      {/* ── Live Execution Log ───────────────────────────────────────────── */}
      {hasRun && (
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.75rem",
            }}
          >
            <h2 style={{ margin: 0 }}>Execution Log</h2>
            {running && (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  fontSize: "0.75rem",
                  color: "#60a5fa",
                }}
              >
                <span className="status-dot running" />
                Live
              </span>
            )}
          </div>
          <div className="terminal">
            {logs.length === 0 && (
              <span style={{ color: "#2d4a6a" }}>Waiting for output…</span>
            )}
            {logs.map((entry) => (
              <div key={entry.id} className={`log-line ${entry.level}`}>
                <span className="ts">{formatTs(entry.message)}</span>
                <span className="msg">{entry.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      )}

      {/* ── Final Report ─────────────────────────────────────────────────── */}
      {report && (
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              marginBottom: "0.875rem",
            }}
          >
            <h2 style={{ margin: 0 }}>Intelligence Report</h2>
            <span
              style={{
                background: "#14532d",
                color: "#4ade80",
                fontSize: "0.6875rem",
                fontWeight: 600,
                padding: "0.2rem 0.6rem",
                borderRadius: "9999px",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Complete
            </span>
          </div>
          <div
            style={{
              background: "#0d1628",
              border: "1px solid #1a3a5c",
              borderRadius: "0.75rem",
              padding: "1.75rem 2rem",
            }}
          >
            <SimpleMarkdown content={report} />
          </div>
        </section>
      )}

      {/* ── Spend Summary Footer ─────────────────────────────────────────── */}
      {hasRun && (
        <section>
          <h2>Spend Summary</h2>
          <div
            style={{
              background: "#0d1628",
              border: "1px solid #1a2a45",
              borderRadius: "0.75rem",
              overflow: "hidden",
            }}
          >
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 2fr 1fr 1fr 1fr",
                padding: "0.625rem 1.25rem",
                background: "#060c18",
                borderBottom: "1px solid #1a2a45",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "#7a93b0",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              <span>Agent</span>
              <span>Wallet Address</span>
              <span style={{ textAlign: "right" }}>XLM Spent</span>
              <span style={{ textAlign: "right" }}>Reputation</span>
              <span style={{ textAlign: "right" }}>Explorer</span>
            </div>

            {/* Rows */}
            {AGENTS.map((agent, idx) => (
              <div
                key={agent.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr 1fr 1fr 1fr",
                  padding: "0.875rem 1.25rem",
                  borderBottom: idx < AGENTS.length - 1 ? "1px solid #0d1e35" : "none",
                  alignItems: "center",
                  fontSize: "0.875rem",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                  <span>{agent.icon}</span>
                  {agent.name}
                </span>
                <span style={{ fontFamily: "monospace", color: "#93c5fd", fontSize: "0.8125rem" }}>
                  {wallets[agent.id] ? truncateKey(wallets[agent.id]) : "—"}
                </span>
                <span style={{ textAlign: "right", fontWeight: 600, color: agentSpent[agent.id] > 0 ? "#f0f4f8" : "#374151" }}>
                  {stroopsToXlm(agentSpent[agent.id])} XLM
                </span>
                <span
                  style={{
                    textAlign: "right",
                    fontWeight: 600,
                    color: reputation[agent.id] >= 7500 ? "#4ade80" : reputation[agent.id] >= 4000 ? "#eab308" : "#f87171",
                  }}
                >
                  {bpsToScore(reputation[agent.id])}/100
                </span>
                <span style={{ textAlign: "right" }}>
                  {wallets[agent.id] ? (
                    <a
                      href={`${EXPLORER_BASE}/${wallets[agent.id]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#1b6ca8",
                        fontSize: "0.8125rem",
                        textDecoration: "none",
                        padding: "0.2rem 0.5rem",
                        border: "1px solid #1a3d5c",
                        borderRadius: "0.25rem",
                        transition: "color 0.2s",
                      }}
                      onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#2a85cc")}
                      onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#1b6ca8")}
                    >
                      View ↗
                    </a>
                  ) : (
                    <span style={{ color: "#374151" }}>—</span>
                  )}
                </span>
              </div>
            ))}

            {/* Total row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 2fr 1fr 1fr 1fr",
                padding: "0.875rem 1.25rem",
                background: "#060c18",
                borderTop: "1px solid #1a2a45",
                fontSize: "0.875rem",
              }}
            >
              <span style={{ fontWeight: 700, color: "#f0f4f8", gridColumn: "1/3" }}>Total</span>
              <span style={{ textAlign: "right", fontWeight: 700, color: totalSpent > 0 ? "#2a85cc" : "#374151" }}>
                {stroopsToXlm(totalSpent)} XLM
              </span>
              <span />
              <span />
            </div>
          </div>
        </section>
      )}

      {/* Spacer */}
      <div style={{ height: "2rem" }} />
    </div>
  );
}
