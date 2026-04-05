"use client";

/**
 * SpendChart — horizontal bar chart showing spend vs cap per agent.
 *
 * Implemented with plain CSS/SVG rather than a chart library to keep
 * the bundle lean. Swap out for Recharts / Victory when styling is ready.
 */

import useSWR from "swr";
import type { AgentId } from "@aegis/shared";

interface SerializedWalletBalance {
  agentId: AgentId;
  spentStroops: string;
  capStroops: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const COLORS: Record<AgentId, string> = {
  scout: "#6366f1",
  ledger: "#22c55e",
  signal: "#eab308",
  scribe: "#ec4899",
};

export function SpendChart() {
  const { data: balances } = useSWR<SerializedWalletBalance[]>(
    "/api/status",
    fetcher,
    { refreshInterval: 5000 }
  );

  if (!balances) {
    return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {balances.map((b) => {
        const pct = Math.min(
          100,
          (Number(b.spentStroops) / Number(b.capStroops)) * 100
        );
        const spentXlm = (Number(b.spentStroops) / 1e7).toFixed(4);
        const capXlm = (Number(b.capStroops) / 1e7).toFixed(4);

        return (
          <div key={b.agentId}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.8125rem",
                marginBottom: "0.3rem",
              }}
            >
              <span style={{ textTransform: "capitalize", fontWeight: 500 }}>
                {b.agentId}
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                {spentXlm} / {capXlm} XLM ({pct.toFixed(1)}%)
              </span>
            </div>
            <div
              style={{
                height: "8px",
                borderRadius: "4px",
                background: "var(--border)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: COLORS[b.agentId] ?? "var(--accent)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
