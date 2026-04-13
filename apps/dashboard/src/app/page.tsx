"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { AgentCard, type AgentStatus } from "@/components/AgentCard";
import { WalletCard } from "@/components/WalletCard";
import { TaskFeed } from "@/components/TaskFeed";

// ── Types ──────────────────────────────────────────────────────────────────

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
  txHashes?: Record<AgentId, string[]>;
}

// ── Agent definitions ─────────────────────────────────────────────────────

const AGENTS: { id: AgentId; name: string; capability: string; color: string }[] = [
  { id: "scout",  name: "Scout",  capability: "Web Research",        color: "#c8c040" },
  { id: "ledger", name: "Ledger", capability: "On-Chain Data",       color: "#48b858" },
  { id: "signal", name: "Signal", capability: "Market Intelligence", color: "#b050c0" },
  { id: "scribe", name: "Scribe", capability: "Report Synthesis",    color: "#d04828" },
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

function stroopsToXlm(s: number): string { return (s / 1e7).toFixed(4); }
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
  const [agentTxHashes, setAgentTxHashes] = useState<Record<AgentId, string[]>>({
    scout: [], ledger: [], signal: [], scribe: [],
  });
  const [agentPaymentModes, setAgentPaymentModes] = useState<Record<AgentId, string>>({
    scout: "", ledger: "", signal: "", scribe: "",
  });
  const [reputationOnChain, setReputationOnChain] = useState<Record<AgentId, number | null>>({
    scout: null, ledger: null, signal: null, scribe: null,
  });

  const logEndRef   = useRef<HTMLDivElement>(null);
  const counterRef  = useRef(0);
  const sessionRef  = useRef(`SES_${Math.random().toString(36).slice(2, 9).toUpperCase()}`);

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
        const map: Record<AgentId, number | null> = { scout: null, ledger: null, signal: null, scribe: null };
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

  async function runAegis() {
    if (!task.trim() || running) return;

    setRunning(true);
    setHasRun(true);
    setLogs([]);
    setReport(null);
    counterRef.current = 0;
    setAgentStatus({ scout: "idle", ledger: "idle", signal: "idle", scribe: "idle" });
    setAgentSpent({ scout: 0, ledger: 0, signal: 0, scribe: 0 });
    setWallets({ scout: "", ledger: "", signal: "", scribe: "" });
    setReputation({ scout: 5000, ledger: 5000, signal: 5000, scribe: 5000 });
    setAgentTxHashes({ scout: [], ledger: [], signal: [], scribe: [] });
    setAgentPaymentModes({ scout: "", ledger: "", signal: "", scribe: "" });

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
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
            } else if (type === "agent_status") {
              const p = payload as { agent: AgentId; status: AgentStatus; spent?: number; txHashes?: string[]; paymentMode?: string };
              setAgentStatus(prev => ({ ...prev, [p.agent]: p.status }));
              if (p.spent !== undefined) setAgentSpent(prev => ({ ...prev, [p.agent]: p.spent! }));
              if (p.txHashes) setAgentTxHashes(prev => ({ ...prev, [p.agent]: p.txHashes! }));
              if (p.paymentMode) setAgentPaymentModes(prev => ({ ...prev, [p.agent]: p.paymentMode! }));
            } else if (type === "wallets") {
              setWallets(payload as Record<AgentId, string>);
            } else if (type === "complete") {
              const p = payload as CompletePayload;
              setReport(p.report);
              setAgentSpent(p.spent);
              setReputation(p.reputation);
              setWallets(p.wallets);
              if (p.txHashes) setAgentTxHashes(p.txHashes as Record<AgentId, string[]>);
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
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAegis(); }}
              placeholder="Enter research task…  (⌘↵ to execute)"
              disabled={running}
            />
            <button
              className={`cmd-exec${running ? " is-running" : ""}`}
              onClick={runAegis}
              disabled={running || !task.trim()}
            >
              {running ? <><span className="spinner" /> WAIT</> : "EXEC"}
            </button>
          </div>

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
              />
            ))}
          </div>

          {/* Wallets module */}
          <div className="module">
            <div className="mod-header">WALLETS</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", padding: "1rem" }}>
              {AGENTS.map((agent) => (
                <WalletCard key={agent.id} agentId={agent.id} />
              ))}
            </div>
          </div>

          {/* Task history */}
          <div className="module">
            <div className="mod-header">HISTORY</div>
            <div style={{ padding: "1rem" }}>
              <TaskFeed />
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────────────── */}
        <div className="d-right">
          {/* Output log — always visible */}
          <div className="module">
            <div className="mod-header">
              {running && <span className="live-dot" />}
              OUTPUT
              {running && <span style={{ color: "#5890d8" }}>· LIVE</span>}
            </div>
            <div className="terminal">
              {!hasRun ? (
                <span style={{ color: "#303032" }}>STANDBY — submit a task to begin</span>
              ) : logs.length === 0 ? (
                <span style={{ color: "#303032" }}>Waiting for output…</span>
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
        </div>
      </div>

      {/* ── Fixed footer ────────────────────────────────────────────────── */}
      <div className="site-footer">
        <span className="ftr-item">
          MODE <span className={`ftr-val${running ? " active" : ""}`}>{mode}</span>
        </span>
        <span className="ftr-item">
          TASK <span className="ftr-val">{taskSnippet}</span>
        </span>
        <span className="ftr-item">
          TOTAL SPEND <span className="ftr-val">{stroopsToXlm(totalSpent)} XLM{totalTxCount > 0 ? ` · ${totalTxCount} TXS` : ""}</span>
        </span>
        <span className="ftr-item" style={{ marginLeft: "auto" }}>
          SESSION <span className="ftr-val">{sessionRef.current}</span>
        </span>
        <span className="ftr-item">
          <span className="ftr-val">{time}</span>
        </span>
      </div>
    </>
  );
}
