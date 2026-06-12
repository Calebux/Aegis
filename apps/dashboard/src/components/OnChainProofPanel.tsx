"use client";

/**
 * OnChainProofPanel
 *
 * Surfaces the full verifiability story for the Aegis infrastructure pitch:
 *   - Live Celo contract links (AegisCeloRegistry + AegisCeloPolicy)
 *   - Per-agent output signatures stored on-chain
 *   - Final consensus notarisation tx (from Notary/Executor agent)
 *
 * Every item is a direct link to Celoscan so judges can verify
 * without trusting Aegis.
 */

const EXPLORER    = "https://celoscan.io";
const TX_EXPLORER = `${EXPLORER}/tx`;
const CT_EXPLORER = `${EXPLORER}/address`;

type AgentId = "celo-scout" | "celo-ledger" | "celo-signal" | "celo-scribe" | "celo-executor";

interface Props {
  agentSigTxHashes:   Record<AgentId, string>;
  registryAddress:    string;
  policyAddress:      string;
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
  "celo-scout":    "Scout   sig",
  "celo-ledger":   "Ledger  sig",
  "celo-signal":   "Signal  sig",
  "celo-scribe":   "Scribe  sig",
  "celo-executor": "Notary  sig",
};

export function OnChainProofPanel({ agentSigTxHashes, registryAddress, policyAddress }: Props) {
  const sigs = Object.entries(agentSigTxHashes) as [AgentId, string][];
  const hasSig = sigs.some(([, h]) => !!h);
  const notaryHash = agentSigTxHashes["celo-executor"];

  return (
    <div style={{ padding: "0.75rem 1.25rem" }}>

      {/* ── Contracts ── */}
      <div style={{ marginBottom: "0.5rem" }}>
        <div style={{ fontSize: "0.42rem", letterSpacing: "0.12em", color: "#303034", textTransform: "uppercase", marginBottom: "0.4rem", fontFamily: "var(--font)" }}>
          Celo Contracts
        </div>
        <Row
          label="AegisCeloRegistry"
          value={truncate(registryAddress, 12)}
          href={registryAddress ? `${CT_EXPLORER}/${registryAddress}` : undefined}
        />
        <Row
          label="AegisCeloPolicy"
          value={truncate(policyAddress, 12)}
          href={policyAddress ? `${CT_EXPLORER}/${policyAddress}` : undefined}
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
              highlight={id === "celo-executor"}
            />
          ) : null
        )}
      </div>

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
            View on Celoscan ↗
          </a>
        </div>
      )}
    </div>
  );
}
