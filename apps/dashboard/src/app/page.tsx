/**
 * Aegis Dashboard — main page
 *
 * Shows:
 *  - Live task feed with sub-task status
 *  - Wallet balances for all agents
 *  - Spend per agent vs. cap (bar chart placeholder)
 *  - Reputation scores
 */

import { TaskFeed } from "@/components/TaskFeed";
import { WalletCard } from "@/components/WalletCard";
import { SpendChart } from "@/components/SpendChart";
import { ReputationBadge } from "@/components/ReputationBadge";

const AGENTS = ["scout", "ledger", "signal", "scribe"] as const;

export default function DashboardPage() {
  return (
    <>
      <h1>Aegis Control Room</h1>

      {/* Wallet balances */}
      <section aria-label="Agent wallets">
        <h2>Agent Wallets</h2>
        <div className="grid-4">
          {AGENTS.map((agent) => (
            <WalletCard key={agent} agentId={agent} />
          ))}
        </div>
      </section>

      <br />

      {/* Spend chart + reputation side by side */}
      <section className="grid-2" aria-label="Spend and reputation">
        <div className="card">
          <h2>Spend vs Cap</h2>
          <SpendChart />
        </div>
        <div className="card">
          <h2>Reputation Scores</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {AGENTS.map((agent) => (
              <ReputationBadge key={agent} agentId={agent} />
            ))}
          </div>
        </div>
      </section>

      <br />

      {/* Live task feed */}
      <section aria-label="Task feed">
        <h2>Live Task Feed</h2>
        <TaskFeed />
      </section>
    </>
  );
}
