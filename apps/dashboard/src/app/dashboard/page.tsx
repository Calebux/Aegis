"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import { AgentCard, type AgentStatus } from "@/components/AgentCard";
import { TaskFeed } from "@/components/TaskFeed";
import { TaskGraphView, type TaskGraph, type AgentType as GraphAgentType, type NodeStatus } from "../TaskGraph";
import { OnChainProofPanel } from "@/components/OnChainProofPanel";
import { RunReceiptPanel } from "@/components/RunReceiptPanel";
import { CostBreakdown } from "@/components/CostBreakdown";
import { PipelineTimeline } from "@/components/PipelineTimeline";
import { VerifyPanel } from "@/components/VerifyPanel";
import type { RunReceipt, RunReceiptVerification } from "@calebux/agent-kit";

// ── Types ──────────────────────────────────────────────────────────────────

type AgentId = "celo-scout" | "celo-ledger" | "celo-signal" | "celo-scribe" | "celo-executor";

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
  txHashes?: Record<AgentId, string[]>;
}

// ── Agent definitions ─────────────────────────────────────────────────────

const AGENTS: { id: AgentId; name: string; capability: string; color: string }[] = [
  { id: "celo-scout",    name: "Scout",    capability: "Web Research",        color: "#c8c040" },
  { id: "celo-ledger",   name: "Ledger",   capability: "On-Chain Data",       color: "#48b858" },
  { id: "celo-signal",   name: "Signal",   capability: "Market Intelligence", color: "#b050c0" },
  { id: "celo-scribe",   name: "Scribe",   capability: "Report Synthesis",    color: "#d04828" },
  { id: "celo-executor", name: "Notary",   capability: "Consensus Proof",     color: "#e07840" },
];

// ── Markdown renderer ──────────────────────────────────────────────────────

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
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) { tableLines.push(lines[i]); i++; }
      const rows = tableLines
        .map(l => l.split("|").slice(1, -1).map(c => c.trim()))
        .filter(r => !r.every(c => /^[-:]+$/.test(c)));
      if (rows.length > 0) {
        const [header, ...body] = rows;
        nodes.push(
          <table key={key++}>
            <thead><tr>{header?.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>{row.map((c, ci) => <td key={ci} dangerouslySetInnerHTML={{ __html: renderInline(c) }} />)}</tr>
              ))}
            </tbody>
          </table>
        );
      }
      continue;
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) { items.push(lines[i].slice(2)); i++; }
      nodes.push(<ul key={key++}>{items.map((item, j) => <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />)}</ul>);
      continue;
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(lines[i].replace(/^\d+\. /, "")); i++; }
      nodes.push(<ol key={key++}>{items.map((item, j) => <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />)}</ol>);
      continue;
    } else if (line.trim() !== "") {
      nodes.push(<p key={key++} dangerouslySetInnerHTML={{ __html: renderInline(line) }} />);
    }
    i++;
  }

  return <div className="report-body">{nodes}</div>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCusd(s: number): string { return (s / 1e18).toFixed(4); }
function ts(): string {
  const n = new Date();
  return [n.getHours(), n.getMinutes(), n.getSeconds()].map(v => String(v).padStart(2, "0")).join(":");
}
function clock(): string { return ts(); }

// ── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [task, setTask]     = useState("");
  const [running, setRunning] = useState(false);
  const [logs, setLogs]     = useState<LogEntry[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [time, setTime]     = useState(clock);

  const [agentStatus, setAgentStatus] = useState<Record<AgentId, AgentStatus>>({
    "celo-scout": "idle", "celo-ledger": "idle", "celo-signal": "idle", "celo-scribe": "idle", "celo-executor": "idle",
  });
  const [agentSpent, setAgentSpent] = useState<Record<AgentId, number>>({
    "celo-scout": 0, "celo-ledger": 0, "celo-signal": 0, "celo-scribe": 0, "celo-executor": 0,
  });
  const [wallets, setWallets] = useState<Record<AgentId, string>>({
    "celo-scout": "", "celo-ledger": "", "celo-signal": "", "celo-scribe": "", "celo-executor": "",
  });
  const [reputation, setReputation] = useState<Record<AgentId, number>>({
    "celo-scout": 5000, "celo-ledger": 5000, "celo-signal": 5000, "celo-scribe": 5000, "celo-executor": 5000,
  });
  const [agentTxHashes, setAgentTxHashes] = useState<Record<AgentId, string[]>>({
    "celo-scout": [], "celo-ledger": [], "celo-signal": [], "celo-scribe": [], "celo-executor": [],
  });
  const [agentPaymentModes, setAgentPaymentModes] = useState<Record<AgentId, string>>({
    "celo-scout": "", "celo-ledger": "", "celo-signal": "", "celo-scribe": "", "celo-executor": "",
  });
  const [agentSigTxHashes, setAgentSigTxHashes] = useState<Record<AgentId, string>>({
    "celo-scout": "", "celo-ledger": "", "celo-signal": "", "celo-scribe": "", "celo-executor": "",
  });
  const [reputationOnChain, setReputationOnChain] = useState<Record<AgentId, number | null>>({
    "celo-scout": null, "celo-ledger": null, "celo-signal": null, "celo-scribe": null, "celo-executor": null,
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [taskGraph, setTaskGraph] = useState<TaskGraph | null>(null);
  const [graphStatusMap, setGraphStatusMap] = useState<Partial<Record<GraphAgentType, NodeStatus>>>({});
  const [graphConfidenceMap, setGraphConfidenceMap] = useState<Partial<Record<GraphAgentType, number>>>({});
  const [runReceipt, setRunReceipt] = useState<RunReceipt | null>(null);
  const [receiptVerification, setReceiptVerification] = useState<RunReceiptVerification | undefined>();
  const [agentStartedAt, setAgentStartedAt] = useState<Record<string, number>>({});
  const [agentCompletedAt, setAgentCompletedAt] = useState<Record<string, number>>({});

  const logEndRef   = useRef<HTMLDivElement>(null);
  const counterRef  = useRef(0);
  const sessionId   = `SES_${useId().replace(/[^a-z0-9]/gi, "").toUpperCase()}`;

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setTime(clock()), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll on-chain reputation from Identity Registry every 15s
  useEffect(() => {
    async function fetchOnChain() {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data = await res.json() as Array<{ agentId: AgentId; reputationOnChain: number | null }>;
        const map: Record<AgentId, number | null> = { "celo-scout": null, "celo-ledger": null, "celo-signal": null, "celo-scribe": null, "celo-executor": null };
        for (const d of data) map[d.agentId] = d.reputationOnChain;
        setReputationOnChain(map);
      } catch { /* non-fatal */ }
    }
    fetchOnChain();
    const id = setInterval(fetchOnChain, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const addLog = useCallback((message: string, level: LogEntry["level"] = "info") => {
    setLogs(prev => [...prev, { id: counterRef.current++, message, level }]);
  }, []);

  async function runCalagent() {
    if (!task.trim() || running) return;

    setRunning(true);
    setHasRun(true);
    setLogs([]);
    setReport(null);
    counterRef.current = 0;
    setAgentStatus({ "celo-scout": "idle", "celo-ledger": "idle", "celo-signal": "idle", "celo-scribe": "idle", "celo-executor": "idle" });
    setAgentSpent({ "celo-scout": 0, "celo-ledger": 0, "celo-signal": 0, "celo-scribe": 0, "celo-executor": 0 });
    setWallets({ "celo-scout": "", "celo-ledger": "", "celo-signal": "", "celo-scribe": "", "celo-executor": "" });
    setReputation({ "celo-scout": 5000, "celo-ledger": 5000, "celo-signal": 5000, "celo-scribe": 5000, "celo-executor": 5000 });
    setAgentTxHashes({ "celo-scout": [], "celo-ledger": [], "celo-signal": [], "celo-scribe": [], "celo-executor": [] });
    setAgentPaymentModes({ "celo-scout": "", "celo-ledger": "", "celo-signal": "", "celo-scribe": "", "celo-executor": "" });
    setAgentSigTxHashes({ "celo-scout": "", "celo-ledger": "", "celo-signal": "", "celo-scribe": "", "celo-executor": "" });
    setTaskGraph(null);
    setGraphStatusMap({});
    setGraphConfidenceMap({});
    setRunReceipt(null);
    setReceiptVerification(undefined);
    setAgentStartedAt({});
    setAgentCompletedAt({});

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, chain: "celo" }),
      });

      if (!res.ok || !res.body) throw new Error(`API ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";

        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          try {
            const { type, payload } = JSON.parse(chunk.slice(6)) as { type: string; payload: unknown };
            if (type === "log") {
              const p = payload as { message: string; level?: LogEntry["level"] };
              addLog(p.message, p.level ?? "info");
            } else if (type === "task:graph") {
              setTaskGraph(payload as TaskGraph);
              // Mark all graph nodes as pending
              const g = payload as TaskGraph;
              const initStatus: Partial<Record<GraphAgentType, NodeStatus>> = {};
              for (const n of g.nodes) initStatus[n.agentType as GraphAgentType] = "pending";
              setGraphStatusMap(initStatus);
            } else if (type === "agent_status") {
              const p = payload as { agent: AgentId | "validator"; status?: AgentStatus; spent?: number; txHashes?: string[]; paymentMode?: string; confidence?: number; sigTxHash?: string; timestamp?: number };
              if (p.agent !== "validator" && p.status) {
                setAgentStatus(prev => ({ ...prev, [p.agent]: p.status! }));
                const ts = p.timestamp ?? Date.now();
                if (p.status === "running") {
                  setAgentStartedAt(prev => prev[p.agent as string] ? prev : { ...prev, [p.agent as string]: ts });
                } else if (p.status === "complete") {
                  setAgentCompletedAt(prev => ({ ...prev, [p.agent as string]: ts }));
                }
              }
              if (p.spent !== undefined && p.agent !== "validator") setAgentSpent(prev => ({ ...prev, [p.agent]: p.spent! }));
              if (p.txHashes && p.agent !== "validator") setAgentTxHashes(prev => ({ ...prev, [p.agent]: p.txHashes! }));
              if (p.paymentMode && p.agent !== "validator") setAgentPaymentModes(prev => ({ ...prev, [p.agent]: p.paymentMode! }));
              if (p.sigTxHash && p.agent !== "validator") setAgentSigTxHashes(prev => ({ ...prev, [p.agent]: p.sigTxHash! }));
              // Update graph status
              const graphStatus: NodeStatus =
                p.status === "complete" ? "complete" :
                p.status === "failed"   ? "error" :
                p.status === "running"  ? "running" : "pending";
              setGraphStatusMap(prev => ({ ...prev, [p.agent as GraphAgentType]: graphStatus }));
              if (p.confidence !== undefined) {
                setGraphConfidenceMap(prev => ({ ...prev, [p.agent as GraphAgentType]: p.confidence! }));
              }
            } else if (type === "wallets") {
              setWallets(payload as Record<AgentId, string>);
            } else if (type === "complete") {
              const p = payload as CompletePayload;
              setReport(p.report);
              setAgentSpent(p.spent);
              setReputation(p.reputation);
              setWallets(p.wallets);
              if (p.txHashes) setAgentTxHashes(p.txHashes as Record<AgentId, string[]>);
            } else if (type === "receipt") {
              const receipt = payload as RunReceipt;
              setRunReceipt(receipt);
              fetch(`/api/receipts/${receipt.runId}/verify`)
                .then((r) => r.ok ? r.json() : undefined)
                .then((v) => setReceiptVerification(v as RunReceiptVerification | undefined))
                .catch(() => {});
            } else if (type === "error") {
              addLog(`Error: ${(payload as { message: string }).message}`, "error");
            }
          } catch { /* skip malformed frame */ }
        }
      }
    } catch (err) {
      addLog(`Fatal: ${String(err)}`, "error");
    } finally {
      setRunning(false);
    }
  }

  const totalSpent = Object.values(agentSpent).reduce((a, b) => a + b, 0);
  const totalTxCount = Object.values(agentTxHashes).reduce((a, hashes) => a + hashes.length, 0);
  const mode = running ? "RUNNING" : report ? "COMPLETE" : "IDLE";
  const taskSnippet = task ? task.slice(0, 44) + (task.length > 44 ? "…" : "") : "—";

  return (
    <>
      <div className="dashboard-layout">
        {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
        <div className="d-left">
          {/* CMD module */}
          <div className="module cmd-module">
            <span className="cmd-prefix">
              CMD <span className="cmd-arrow">▸</span>
            </span>
            <input
              className="cmd-input"
              value={task}
              onChange={e => setTask(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runCalagent(); }}
              placeholder="Enter research task…  (⌘↵ to execute)"
              disabled={running}
            />
            <button
              className={`cmd-exec${running ? " is-running" : ""}`}
              onClick={runCalagent}
              disabled={running || !task.trim()}
            >
              {running ? <><span className="spinner" /> WAIT</> : "EXEC"}
            </button>
          </div>

          {/* Prompt chips */}
          {!running && (
            <div className="prompt-chips">
              {["Analyze Celo DeFi yields", "Research CELO staking rewards", "Compare Celo stablecoins", "Evaluate Celo validator ecosystem"].map((chip) => (
                <button key={chip} className="prompt-chip" onClick={() => setTask(chip)}>
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Agents module */}
          <div className="module agents-module">
            {AGENTS.map((agent, i) => (
              <AgentCard
                key={agent.id}
                index={i + 1}
                name={agent.name}
                capability={agent.capability}
                color={agent.color}
                status={agentStatus[agent.id]}
                wallet={wallets[agent.id]}
                spent={agentSpent[agent.id]}
                reputation={reputation[agent.id]}
                reputationOnChain={reputationOnChain[agent.id]}
                isLast={i === AGENTS.length - 1}
                txHashes={agentTxHashes[agent.id]}
                paymentMode={agentPaymentModes[agent.id]}
                sigTxHash={agentSigTxHashes[agent.id]}
              />
            ))}
          </div>

        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────────────── */}
        <div className="d-right">
          {/* Task graph — shown once received */}
          {taskGraph && (
            <div className="module">
              <div className="mod-header">
                TASK GRAPH
                <span className="infra-badge" data-tooltip="Task graph generated per prompt by the AI planner" style={{ marginLeft: 6 }}>Dynamic Planner</span>
                <span style={{ color: "#656d76", fontSize: "0.65rem", fontFamily: "monospace", marginLeft: "auto" }}>
                  {taskGraph.nodes.length} NODES
                </span>
              </div>
              <div style={{ padding: "0.5rem 1rem" }}>
                <TaskGraphView
                  graph={taskGraph}
                  statusMap={graphStatusMap}
                  confidenceMap={graphConfidenceMap}
                />
              </div>
            </div>
          )}

          {/* On-Chain Proof panel — always visible */}
          <div className="module">
            <div className="mod-header">
              ON-CHAIN PROOF
              <span style={{ color: "#2a8a3a", fontSize: "0.6rem", marginLeft: "auto" }}>
                CELO · MAINNET
              </span>
            </div>
            <OnChainProofPanel
              agentSigTxHashes={agentSigTxHashes}
              registryAddress={process.env.NEXT_PUBLIC_CELO_REGISTRY_ADDRESS ?? "0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C"}
              policyAddress={process.env.NEXT_PUBLIC_CELO_POLICY_ADDRESS ?? "0xF1aCE070B7265094c24e276671a72Af4B3Fa1A0c"}
            />
          </div>

          {/* Pipeline Timeline */}
          {Object.keys(agentStartedAt).length > 0 && (
            <div className="module">
              <PipelineTimeline
                agents={AGENTS}
                startedAt={agentStartedAt}
                completedAt={agentCompletedAt}
                running={running}
              />
            </div>
          )}

          {/* Cost Breakdown */}
          {report && (
            <div className="module">
              <CostBreakdown spent={agentSpent} agents={AGENTS} />
            </div>
          )}

          {runReceipt && (
            <div className="module">
              <div className="mod-header">
                RUN RECEIPT
                <span style={{ color: receiptVerification?.valid ? "#48a858" : "#a08010", fontSize: "0.6rem", marginLeft: "auto" }}>
                  {receiptVerification?.valid ? "VERIFIED" : "PENDING"}
                </span>
              </div>
              <RunReceiptPanel receipt={runReceipt} verification={receiptVerification} />
            </div>
          )}

          {/* Output log — always visible */}
          <div className="module">
            <div className="mod-header">
              {running && <span className="live-dot" />}
              OUTPUT
              {running && <span style={{ color: "#5890d8" }}>· LIVE</span>}
              <span className="infra-badge" data-tooltip="Real-time server-sent events from the orchestrator" style={{ marginLeft: 6 }}>SSE Stream</span>
            </div>
            <div className="terminal">
              {!hasRun ? (
                <span style={{ color: "#8b949e" }}>STANDBY — submit a task to begin</span>
              ) : logs.length === 0 ? (
                <span style={{ color: "#8b949e" }}>Waiting for output…</span>
              ) : (
                logs.map(entry => (
                  <div key={entry.id} className={`log-line ${entry.level}`}>
                    <span className="ts">{ts()}</span>
                    <span className="msg">{entry.message}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* Intelligence report */}
          {report && (
            <div className="module">
              <div className="mod-header">
                REPORT
                <span className="done-badge">COMPLETE</span>
              </div>
              <SimpleMarkdown content={report} />
            </div>
          )}

          {/* Verify On-Chain */}
          {report && (
            <div className="module">
              <VerifyPanel
                agentSigTxHashes={agentSigTxHashes}
                registryAddress={process.env.NEXT_PUBLIC_CELO_REGISTRY_ADDRESS ?? "0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C"}
                policyAddress={process.env.NEXT_PUBLIC_CELO_POLICY_ADDRESS ?? "0xF1aCE070B7265094c24e276671a72Af4B3Fa1A0c"}
                receiptId={runReceipt?.runId}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── History drawer ──────────────────────────────────────────────── */}
      <div className={`history-drawer${historyOpen ? " open" : ""}`}>
        <div className="history-drawer-header">
          HISTORY
          <button className="drawer-close" onClick={() => setHistoryOpen(false)}>✕</button>
        </div>
        <div className="history-drawer-body">
          <TaskFeed />
        </div>
      </div>
      {historyOpen && <div className="drawer-overlay" onClick={() => setHistoryOpen(false)} />}

      {/* ── Fixed footer ────────────────────────────────────────────────── */}
      <div className="site-footer">
        <span className="ftr-item">
          MODE <span className={`ftr-val${running ? " active" : ""}`}>{mode}</span>
        </span>
        <span className="ftr-item">
          TASK <span className="ftr-val">{taskSnippet}</span>
        </span>
        <span className="ftr-item">
          CHAIN <span className="ftr-val">CELO</span>
        </span>
        <span className="ftr-item">
          TOTAL SPEND <span className="ftr-val">{formatCusd(totalSpent)} cUSD{totalTxCount > 0 ? ` · ${totalTxCount} TXS` : ""}</span>
        </span>
        <span className="ftr-item" style={{ marginLeft: "auto" }}>
          SESSION <span className="ftr-val">{sessionId}</span>
        </span>
        <button className="ftr-btn" onClick={() => setHistoryOpen(v => !v)}>
          HISTORY
        </button>
        <span className="ftr-item">
          <span className="ftr-val">{time}</span>
        </span>
      </div>
    </>
  );
}
