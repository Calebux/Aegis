"use client";

/**
 * OnChainProofPanel
 *
 * Surfaces the full verifiability story for the Aegis infrastructure pitch:
 *   - Live Soroban contract links (Shield + Identity Registry)
 *   - Per-agent output signatures stored on-chain
 *   - Final consensus notarisation tx (from Notary/Executor agent)
 *
 * Every item is a direct link to stellar.expert so judges can verify
 * without trusting Aegis.
 */

const EXPLORER    = "https://stellar.expert/explorer/testnet";
const TX_EXPLORER = `${EXPLORER}/tx`;
const CT_EXPLORER = `${EXPLORER}/contract`;

type AgentId = "scout" | "ledger" | "signal" | "scribe" | "executor";

interface Props {
  agentSigTxHashes:   Record<AgentId, string>;
  dexSettleTxHash:    string;
  shieldContractId:   string;
  registryContractId: string;
}

function truncate(s: string, n = 10): string {
  return s.length > n ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function Row({
  label,
  value,
  href,
  highlight,
}: {
  label: string;
  value: string;
  href?: string;
  highlight?: boolean;
}) {
  const style: React.CSSProperties = {
    display:        "flex",
    justifyContent: "space-between",
    alignItems:     "center",
    padding:        "0.35rem 0",
    borderBottom:   "1px solid #1a1a1c",
    fontSize:       "0.5rem",
    letterSpacing:  "0.06em",
    fontFamily:     "var(--font)",
  };

  const labelStyle: React.CSSProperties = {
    color:         "#484848",
    textTransform: "uppercase",
    flexShrink:    0,
  };

  const valueStyle: React.CSSProperties = {
    color:      highlight ? "#48a858" : "#545458",
    fontWeight: highlight ? 700 : 400,
    textAlign:  "right",
  };

  return (
    <div style={style}>
      <span style={labelStyle}>{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...valueStyle, textDecoration: "none" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = highlight ? "#6fd87f" : "#888"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = highlight ? "#48a858" : "#545458"; }}
        >
          {value} ↗
        </a>
      ) : (
        <span style={valueStyle}>{value}</span>
      )}
    </div>
  );
}

const AGENT_LABELS: Record<AgentId, string> = {
  scout:    "Scout   sig",
  ledger:   "Ledger  sig",
  signal:   "Signal  sig",
  scribe:   "Scribe  sig",
  executor: "Notary  sig",
};

export function OnChainProofPanel({ agentSigTxHashes, dexSettleTxHash, shieldContractId, registryContractId }: Props) {
  const sigs = Object.entries(agentSigTxHashes) as [AgentId, string][];
  const hasSig = sigs.some(([, h]) => !!h);
  const notaryHash = agentSigTxHashes["executor"];

  return (
    <div style={{ padding: "0.75rem 1.25rem" }}>

      {/* ── Contracts ── */}
      <div style={{ marginBottom: "0.5rem" }}>
        <div style={{ fontSize: "0.42rem", letterSpacing: "0.12em", color: "#303034", textTransform: "uppercase", marginBottom: "0.4rem", fontFamily: "var(--font)" }}>
          Soroban Contracts
        </div>
        <Row
          label="Shield Contract"
          value={truncate(shieldContractId, 12)}
          href={shieldContractId ? `${CT_EXPLORER}/${shieldContractId}` : undefined}
        />
        <Row
          label="Identity Registry"
          value={truncate(registryContractId, 12)}
          href={registryContractId ? `${CT_EXPLORER}/${registryContractId}` : undefined}
        />
      </div>

      {/* ── Agent signatures ── */}
      <div style={{ marginBottom: "0.5rem" }}>
        <div style={{ fontSize: "0.42rem", letterSpacing: "0.12em", color: "#303034", textTransform: "uppercase", marginBottom: "0.4rem", fontFamily: "var(--font)" }}>
          Agent Output Signatures
        </div>
        {!hasSig && (
          <div style={{ fontSize: "0.48rem", color: "#2c2c2e", fontFamily: "var(--font)", padding: "0.25rem 0" }}>
            — awaiting pipeline run —
          </div>
        )}
        {sigs.map(([id, hash]) =>
          hash ? (
            <Row
              key={id}
              label={AGENT_LABELS[id]}
              value={truncate(hash, 14)}
              href={`${TX_EXPLORER}/${hash}`}
              highlight={id === "executor"}
            />
          ) : null
        )}
      </div>

      {/* ── DEX settlement ── */}
      {dexSettleTxHash && (
        <div style={{ marginBottom: "0.5rem" }}>
          <div style={{ fontSize: "0.42rem", letterSpacing: "0.12em", color: "#303034", textTransform: "uppercase", marginBottom: "0.4rem", fontFamily: "var(--font)" }}>
            DEX Settlement
          </div>
          <Row
            label="XLM → USDC swap"
            value={truncate(dexSettleTxHash, 14)}
            href={`${TX_EXPLORER}/${dexSettleTxHash}`}
          />
        </div>
      )}

      {/* ── Final consensus proof ── */}
      {notaryHash && (
        <div style={{
          marginTop:    "0.75rem",
          padding:      "0.5rem 0.75rem",
          border:       "1px solid #1e3a1e",
          borderRadius: "2px",
          background:   "rgba(40,80,40,0.06)",
        }}>
          <div style={{ fontSize: "0.42rem", letterSpacing: "0.12em", color: "#2a5a2a", textTransform: "uppercase", marginBottom: "0.3rem", fontFamily: "var(--font)" }}>
            ✓ Consensus Notarised
          </div>
          <a
            href={`${TX_EXPLORER}/${notaryHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.5rem", color: "#48a858", fontFamily: "var(--font)", textDecoration: "none", letterSpacing: "0.04em" }}
          >
            View on Stellar Explorer ↗
          </a>
        </div>
      )}
    </div>
  );
}
