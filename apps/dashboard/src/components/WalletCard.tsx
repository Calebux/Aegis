"use client";

/**
 * WalletCard — displays cUSD balance and spend info for a single agent.
 */

import useSWR from "swr";
import type { AgentId } from "@calagent/shared";

interface SerializedWalletBalance {
  agentId: AgentId;
  publicKey: string;
  balance: string;
  spentWei: string;
  capWei: string;
  reputationBps: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Props {
  agentId: AgentId;
}

function truncate(key: string) {
  if (key.length <= 12) return key;
  return key.slice(0, 6) + "…" + key.slice(-4);
}

function weiToCusd(wei: string): string {
  return (Number(wei) / 1e18).toFixed(4);
}

export function WalletCard({ agentId }: Props) {
  const { data: balances } = useSWR<SerializedWalletBalance[]>(
    "/api/status",
    fetcher,
    { refreshInterval: 5000 }
  );

  const balance = balances?.find((b) => b.agentId === agentId);

  const pct = balance
    ? Math.min(100, (Number(balance.spentWei) / Number(balance.capWei)) * 100)
    : 0;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.75rem" }}>
        <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{agentId}</span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {balance ? truncate(balance.publicKey) : "—"}
        </span>
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        {balance ? `${parseFloat(balance.balance).toFixed(2)} cUSD` : "—"}
      </div>
      {/* Spend bar */}
      <div style={{ marginBottom: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
        <span>Spent</span>
        <span>
          {balance ? `${weiToCusd(balance.spentWei)} / ${weiToCusd(balance.capWei)} cUSD` : "—"}
        </span>
      </div>
      <div style={{ height: "4px", borderRadius: "2px", background: "var(--border)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: pct > 80 ? "var(--red)" : pct > 50 ? "var(--yellow)" : "var(--accent)",
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}
