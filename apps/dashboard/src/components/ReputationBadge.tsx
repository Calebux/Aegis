"use client";

/**
 * ReputationBadge — shows an agent's on-chain reputation score.
 *
 * reputationBps is stored as an integer 0–10_000 representing 0.00–100.00.
 */

import useSWR from "swr";
import type { AgentId } from "@aegis/shared";

interface SerializedWalletBalance {
  agentId: AgentId;
  reputationBps: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Props {
  agentId: AgentId;
}

function bpsToScore(bps: number): string {
  return (bps / 100).toFixed(2);
}

function repColor(bps: number): string {
  if (bps >= 7_500) return "var(--green)";
  if (bps >= 4_000) return "var(--yellow)";
  return "var(--red)";
}

export function ReputationBadge({ agentId }: Props) {
  const { data: balances } = useSWR<SerializedWalletBalance[]>(
    "/api/status",
    fetcher,
    { refreshInterval: 10000 }
  );

  const balance = balances?.find((b) => b.agentId === agentId);
  const bps = balance?.reputationBps ?? 5_000;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.5rem 0.75rem",
        borderRadius: "0.5rem",
        background: "var(--bg)",
        border: "1px solid var(--border)",
      }}
    >
      <span style={{ textTransform: "capitalize", fontWeight: 500 }}>
        {agentId}
      </span>
      <span
        style={{
          fontWeight: 700,
          color: repColor(bps),
          fontSize: "0.9375rem",
        }}
      >
        {bpsToScore(bps)} / 100
      </span>
    </div>
  );
}
