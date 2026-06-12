"use client";

import useSWR from "swr";

const DOTS: Record<string, string> = {
  "celo-scout": "#c8c040", "celo-ledger": "#48b858", "celo-signal": "#b050c0", "celo-scribe": "#d04828", "celo-executor": "#e07840",
};
const ABBR: Record<string, string> = {
  "celo-scout": "SCT", "celo-ledger": "LDG", "celo-signal": "SIG", "celo-scribe": "SCB", "celo-executor": "NTR",
};
const ORDER = ["celo-scout", "celo-ledger", "celo-signal", "celo-scribe", "celo-executor"] as const;

const fetcher = (u: string) => fetch(u).then(r => r.json());

export function WalletStrip() {
  const { data } = useSWR<Array<{ agentId: string; balance: string }>>(
    "/api/status",
    fetcher,
    { refreshInterval: 10_000 }
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
      {ORDER.map(id => {
        const b = data?.find(d => d.agentId === id);
        const bal = b ? parseFloat(b.balance).toFixed(2) : "—";
        return (
          <span key={id} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.58rem", letterSpacing: "0.08em" }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: DOTS[id], flexShrink: 0, display: "inline-block" }} />
            <span style={{ color: "#656d76" }}>{ABBR[id]}</span>
            <span style={{ color: "#1a1a2e" }}>{bal}</span>
          </span>
        );
      })}
    </div>
  );
}
