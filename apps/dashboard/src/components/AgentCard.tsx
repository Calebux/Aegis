"use client";

export type AgentStatus = "idle" | "running" | "complete" | "failed";

// ── Constants ─────────────────────────────────────────────────────────────

const EXPLORER    = "https://celoscan.io/address";
const TX_EXPLORER = "https://celoscan.io/tx";

const STATUS_DOT: Record<AgentStatus, string> = {
  idle:     "#d0d0d8",
  running:  "#5890d8",
  complete: "#48a858",
  failed:   "#c05050",
};
const STATUS_LABEL: Record<AgentStatus, string> = {
  idle:     "IDLE",
  running:  "RUNNING",
  complete: "DONE",
  failed:   "FAILED",
};
const STATUS_TEXT_COLOR: Record<AgentStatus, string> = {
  idle:     "#b0b0b8",
  running:  "#5890d8",
  complete: "#48a858",
  failed:   "#c05050",
};

function truncate(key: string): string {
  return key.length >= 10 ? `${key.slice(0, 6)}·${key.slice(-4)}` : key;
}

// ── Props ─────────────────────────────────────────────────────────────────

export interface AgentCardProps {
  index: number;
  name: string;
  capability: string;
  status: AgentStatus;
  wallet: string;
  spent: number;          // wei (cUSD)
  reputation: number;     // basis points 0–10 000
  reputationOnChain?: number | null;
  color: string;
  isLast?: boolean;
  txHashes?: string[];
  paymentMode?: string;   // "x402" | "session" | "dev" | "notary"
  sigTxHash?: string;
}

// ── Component ─────────────────────────────────────────────────────────────

export function AgentCard({
  index, name, capability, status, wallet, spent, reputation, reputationOnChain,
  color, isLast, txHashes, paymentMode, sigTxHash,
}: AgentCardProps) {
  const repScore  = String(Math.round(reputation / 100)).padStart(3, "0");
  const spentCusd = (spent / 1e18).toFixed(4);
  const dotColor  = status === "running" ? color : STATUS_DOT[status];
  const isActive  = status === "running";
  const hasTx     = txHashes && txHashes.length > 0;
  const modeLabel =
    paymentMode === "x402"    ? "x402"    :
    paymentMode === "session" ? "session" :
    paymentMode === "notary"  ? "notary"  : null;

  return (
    <div style={{
      padding: "0.75rem 1.25rem",
      borderBottom: isLast ? "none" : "1px solid #e8e8ec",
      background: isActive ? "rgba(64,112,184,0.04)" : "transparent",
      transition: "background 0.3s",
    }}>

      {/* ── Row 1: dot · name · capability · status ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 4,
      }}>
        {/* Pulse dot */}
        <div style={{
          width: 7, height: 7, borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
          boxShadow: isActive ? `0 0 6px ${color}99` : "none",
          transition: "background 0.3s, box-shadow 0.3s",
        }} />

        {/* Agent name */}
        <span style={{
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          color: isActive ? color : "#1a1a2e",
          fontFamily: "var(--font)",
          transition: "color 0.3s",
        }}>
          {name}
        </span>

        {/* Index tag */}
        <span style={{
          fontSize: "0.45rem",
          letterSpacing: "0.12em",
          color: "#b0b0b8",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase" as const,
          marginRight: "auto",
        }}>
          AGT.0{index}
        </span>

        {/* Capability */}
        <span style={{
          fontSize: "0.52rem",
          letterSpacing: "0.06em",
          color: "#656d76",
          fontFamily: "var(--font)",
          textTransform: "uppercase" as const,
        }}>
          {capability}
        </span>

        {/* Status text */}
        <span style={{
          fontSize: "0.52rem",
          letterSpacing: "0.1em",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase" as const,
          color: STATUS_TEXT_COLOR[status],
          minWidth: 52,
          textAlign: "right" as const,
          transition: "color 0.3s",
        }}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {/* ── Row 2: wallet · metrics ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        paddingLeft: 15,
      }}>
        {/* Wallet link */}
        {wallet ? (
          <a
            href={`${EXPLORER}/${wallet}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.5rem",
              letterSpacing: "0.06em",
              color: "#656d76",
              textDecoration: "none",
              fontFamily: "var(--font-mono)",
              flexShrink: 0,
              transition: "color 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1a1a2e"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#656d76"; }}
          >
            {truncate(wallet)}
          </a>
        ) : (
          <span style={{ fontSize: "0.5rem", color: "#b0b0b8", fontFamily: "var(--font-mono)" }}>
            no wallet
          </span>
        )}

        <span style={{ color: "#d0d0d8", fontSize: "0.5rem", userSelect: "none" }}>·</span>

        {/* REP */}
        <span style={{
          fontSize: "0.5rem",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-mono)",
          color: "#656d76",
          textTransform: "uppercase" as const,
        }}>
          REP{" "}
          <span style={{ color: reputation > 5000 ? color : "#656d76", fontWeight: 700 }}>
            {repScore}
          </span>
          {reputationOnChain != null && (
            <>
              <span style={{ color: "#2a8a3a", marginLeft: 4 }}>⛓{reputationOnChain}</span>
              {" "}
              <span className="infra-badge" data-tooltip="Live trust score from AegisCeloRegistry">On-Chain</span>
            </>
          )}
        </span>

        <span style={{ color: "#d0d0d8", fontSize: "0.5rem", userSelect: "none" }}>·</span>

        {/* SPEND */}
        <span style={{
          fontSize: "0.5rem",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-mono)",
          color: "#656d76",
          textTransform: "uppercase" as const,
        }}>
          {spentCusd}{" "}
          <span style={{ color: "#b0b0b8" }}>cUSD</span>
        </span>
      </div>

      {/* ── Row 3: tx links (only when present) ── */}
      {(hasTx || sigTxHash) && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingLeft: 15,
          marginTop: 4,
        }}>
          {hasTx && (
            <>
              <a
                href={`${TX_EXPLORER}/${txHashes![0]}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "0.48rem",
                  letterSpacing: "0.06em",
                  color: "#656d76",
                  textDecoration: "none",
                  fontFamily: "var(--font-mono)",
                  transition: "color 0.15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1a1a2e"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#656d76"; }}
              >
                {txHashes!.length} tx{txHashes!.length > 1 ? "s" : ""}
                {modeLabel && <span style={{ color: "#b0b0b8", marginLeft: 3 }}>[{modeLabel}]</span>}
              </a>
              {modeLabel === "x402" && (
                <span className="infra-badge" data-tooltip="Paid via x402 micropayment protocol on Celo">x402</span>
              )}
            </>
          )}

          {hasTx && sigTxHash && (
            <span style={{ color: "#d0d0d8", fontSize: "0.5rem", userSelect: "none" }}>·</span>
          )}

          {sigTxHash && (
            <>
              <a
                href={`${TX_EXPLORER}/${sigTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "0.48rem",
                  letterSpacing: "0.06em",
                  color: "#2a8a3a",
                  textDecoration: "none",
                  fontFamily: "var(--font-mono)",
                  transition: "color 0.15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#3aaa4a"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#2a8a3a"; }}
              >
                sig on-chain
              </a>
              <span className="infra-badge" data-tooltip="SHA-256 output hash stored on Celo for verification">Attested</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
