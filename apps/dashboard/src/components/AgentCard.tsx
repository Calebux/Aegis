"use client";

export type AgentStatus = "idle" | "running" | "complete" | "failed";

interface Props {
  name: string;
  icon: string;
  capability: string;
  status: AgentStatus;
  wallet: string;
  spent: number; // stroops
  reputation: number; // basis points 0–10000
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
};

const STATUS_BG: Record<AgentStatus, string> = {
  idle: "#1a2a45",
  running: "#0d2d4a",
  complete: "#14532d",
  failed: "#450a0a",
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "#7a93b0",
  running: "#60a5fa",
  complete: "#4ade80",
  failed: "#f87171",
};

function truncateKey(key: string): string {
  if (!key || key.length < 12) return key || "—";
  return key.slice(0, 6) + "…" + key.slice(-4);
}

function stroopsToXlm(stroops: number): string {
  return (stroops / 1e7).toFixed(4);
}

function bpsToScore(bps: number): string {
  return (bps / 100).toFixed(1);
}

function repColor(bps: number): string {
  if (bps >= 7500) return "#4ade80";
  if (bps >= 4000) return "#eab308";
  return "#f87171";
}

const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/account";

export function AgentCard({ name, icon, capability, status, wallet, spent, reputation }: Props) {
  return (
    <div
      style={{
        background: "#0d1628",
        border: `1px solid ${status === "running" ? "#1b6ca8" : status === "complete" ? "#14532d" : status === "failed" ? "#450a0a" : "#1a2a45"}`,
        borderRadius: "0.75rem",
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.875rem",
        transition: "border-color 0.3s ease",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <span style={{ fontSize: "1.375rem" }}>{icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.9375rem", color: "#f0f4f8" }}>{name}</div>
            <div style={{ fontSize: "0.75rem", color: "#7a93b0" }}>{capability}</div>
          </div>
        </div>

        {/* Status badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            background: STATUS_BG[status],
            color: STATUS_COLOR[status],
            padding: "0.25rem 0.625rem",
            borderRadius: "9999px",
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {status === "running" ? (
            <span className="spinner" />
          ) : (
            <span className={`status-dot ${status}`} />
          )}
          {STATUS_LABEL[status]}
        </div>
      </div>

      {/* Wallet address */}
      <div
        style={{
          background: "#060c18",
          border: "1px solid #0d1e35",
          borderRadius: "0.375rem",
          padding: "0.5rem 0.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <div>
          <div style={{ fontSize: "0.6875rem", color: "#7a93b0", marginBottom: "0.15rem" }}>Wallet</div>
          <div style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#93c5fd" }}>
            {wallet ? truncateKey(wallet) : "—"}
          </div>
        </div>
        {wallet && (
          <a
            href={`${EXPLORER_BASE}/${wallet}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.6875rem",
              color: "#1b6ca8",
              textDecoration: "none",
              padding: "0.2rem 0.5rem",
              border: "1px solid #1a3d5c",
              borderRadius: "0.25rem",
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "color 0.2s",
            }}
            onMouseEnter={e => ((e.target as HTMLElement).style.color = "#2a85cc")}
            onMouseLeave={e => ((e.target as HTMLElement).style.color = "#1b6ca8")}
          >
            View on Stellar ↗
          </a>
        )}
      </div>

      {/* Metrics row */}
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <div
          style={{
            flex: 1,
            background: "#060c18",
            border: "1px solid #0d1e35",
            borderRadius: "0.375rem",
            padding: "0.5rem 0.75rem",
          }}
        >
          <div style={{ fontSize: "0.6875rem", color: "#7a93b0", marginBottom: "0.15rem" }}>XLM Spent</div>
          <div style={{ fontWeight: 700, fontSize: "0.9375rem", color: spent > 0 ? "#f0f4f8" : "#374151" }}>
            {spent > 0 ? stroopsToXlm(spent) : "0.0000"}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            background: "#060c18",
            border: "1px solid #0d1e35",
            borderRadius: "0.375rem",
            padding: "0.5rem 0.75rem",
          }}
        >
          <div style={{ fontSize: "0.6875rem", color: "#7a93b0", marginBottom: "0.15rem" }}>Reputation</div>
          <div style={{ fontWeight: 700, fontSize: "0.9375rem", color: repColor(reputation) }}>
            {bpsToScore(reputation)}<span style={{ fontSize: "0.75rem", color: "#7a93b0", fontWeight: 400 }}>/100</span>
          </div>
        </div>
      </div>
    </div>
  );
}
