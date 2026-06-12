"use client";

interface CostBreakdownProps {
  spent: Record<string, number>;
  agents: { id: string; name: string; color: string }[];
}

export function CostBreakdown({ spent, agents }: CostBreakdownProps) {
  const total = Object.values(spent).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const segments = agents
    .map((a) => ({ ...a, value: spent[a.id] ?? 0 }))
    .filter((s) => s.value > 0);

  return (
    <div className="cost-breakdown">
      <div className="mod-header">
        COST BREAKDOWN
        <span style={{ marginLeft: "auto", color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>
          {(total / 1e18).toFixed(4)} cUSD
        </span>
      </div>
      <div style={{ padding: "1rem" }}>
        <div className="cost-bar">
          {segments.map((s) => (
            <div
              key={s.id}
              className="cost-bar-segment"
              style={{
                width: `${(s.value / total) * 100}%`,
                background: s.color,
              }}
              title={`${s.name}: ${((s.value / total) * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <div className="cost-legend">
          {segments.map((s) => (
            <span key={s.id} className="cost-legend-item">
              <span className="cost-legend-dot" style={{ background: s.color }} />
              {s.name} {((s.value / total) * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
