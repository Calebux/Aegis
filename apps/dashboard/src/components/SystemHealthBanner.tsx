"use client";

import { useEffect, useState } from "react";

interface HealthData {
  ok: boolean;
  agents: number;
  receipts: number;
  celo: {
    network: string;
    enforce: boolean;
  };
}

export function SystemHealthBanner() {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch("/api/health");
        if (res.ok) setHealth(await res.json() as HealthData);
      } catch { /* non-fatal */ }
    }
    fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!health) return null;

  const pills: { label: string; green?: boolean }[] = [
    { label: "SYS OK", green: health.ok },
    { label: health.celo.enforce ? "x402 ENFORCED" : "DEV MODE", green: health.celo.enforce },
    { label: `CELO ${health.celo.network.toUpperCase()}`, green: true },
    { label: `${health.agents} AGENTS` },
    { label: `${health.receipts} RECEIPTS` },
    { label: "ON-CHAIN WRITES ACTIVE", green: true },
  ];

  return (
    <div className="health-banner">
      {pills.map((p) => (
        <span key={p.label} className={`health-pill${p.green ? " health-pill--green" : ""}`}>
          {p.green && <span className="health-dot" />}
          {p.label}
        </span>
      ))}
    </div>
  );
}
