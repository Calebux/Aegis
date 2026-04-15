"use client";

import useSWR from "swr";

const DOTS: Record<string, string> = {
  scout: "#c8c040", ledger: "#48b858", signal: "#b050c0", scribe: "#d04828", executor: "#e07840",
};
const ABBR: Record<string, string> = {
  scout: "SCT", ledger: "LDG", signal: "SIG", scribe: "SCB", executor: "NTR",
};
const ORDER = ["scout", "ledger", "signal", "scribe", "executor"] as const;

const fetcher = (u: string) => fetch(u).then(r => r.json());

export function WalletStrip() {
  const { data } = useSWR<Array<{ agentId: string; xlmBalance: string }>>(
    "/api/status",
    fetcher,
    { refreshInterval: 10_000 }
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
      {ORDER.map(id => {
        const b = data?.find(d => d.agentId === id);
        const bal = b ? parseFloat(b.xlmBalance).toFixed(2) : "—";
        return (
          <span key={id} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.58rem", letterSpacing: "0.08em" }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: DOTS[id], flexShrink: 0, display: "inline-block" }} />
            <span style={{ color: "#484848" }}>{ABBR[id]}</span>
            <span style={{ color: "#606062" }}>{bal}</span>
          </span>
        );
      })}
    </div>
  );
}
