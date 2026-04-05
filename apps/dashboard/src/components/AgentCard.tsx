"use client";

export type AgentStatus = "idle" | "running" | "complete" | "failed";

// ── SVG Rotary Knob ───────────────────────────────────────────────────────

interface KnobProps {
  value: number; // 0–1 normalised
  label: string;
  color: string;
}

function Knob({ value, label, color }: KnobProps) {
  const SIZE = 44;
  const R = 15;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const pct = Math.min(1, Math.max(0, value));

  // Angles measured clockwise from 12-o'clock in screen coords.
  // Track: 225° (7 o'clock) → 135° (5 o'clock) = 270° sweep through top.
  const toXY = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
  };

  const s = toXY(225);
  const e = toXY(135);          // 225 + 270 = 495 ≡ 135
  const a = toXY(225 + pct * 270);

  // Full 270° arc (large=1, cw=1)
  const trackD = `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 1 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;

  const sweep = pct * 270;
  const activeD = pct > 0.01
    ? `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${a.x.toFixed(2)} ${a.y.toFixed(2)}`
    : "";

  // Needle line from 20 % to 72 % of radius, at current angle
  const nRad = ((225 + pct * 270 - 90) * Math.PI) / 180;
  const n1 = { x: CX + R * 0.20 * Math.cos(nRad), y: CY + R * 0.20 * Math.sin(nRad) };
  const n2 = { x: CX + R * 0.72 * Math.cos(nRad), y: CY + R * 0.72 * Math.sin(nRad) };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, userSelect: "none" }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={CX} cy={CY} r={R + 3} fill="#18181a" />
        <path d={trackD} fill="none" stroke="#2a2a2d" strokeWidth="2" strokeLinecap="round" />
        {activeD && (
          <path d={activeD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
        )}
        <circle cx={CX} cy={CY} r={R * 0.3} fill="#222224" />
        <line
          x1={n1.x.toFixed(2)} y1={n1.y.toFixed(2)}
          x2={n2.x.toFixed(2)} y2={n2.y.toFixed(2)}
          stroke="#c0c0c0" strokeWidth="1.5" strokeLinecap="round"
        />
      </svg>
      <span style={{
        fontSize: "0.5rem", letterSpacing: "0.12em", textTransform: "uppercase",
        color: "#484848", fontFamily: "var(--font)",
      }}>{label}</span>
    </div>
  );
}

// ── Agent Row ─────────────────────────────────────────────────────────────

export interface AgentCardProps {
  index: number;       // 1–4
  name: string;
  capability: string;
  status: AgentStatus;
  wallet: string;
  spent: number;       // stroops
  reputation: number;  // basis points 0–10 000
  color: string;       // accent color
  isLast?: boolean;
}

const STATUS_STATES: AgentStatus[] = ["idle", "running", "complete", "failed"];
const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "IDLE", running: "EXEC", complete: "DONE", failed: "FAIL",
};

const BTN_BORDER: Record<AgentStatus, string> = {
  idle: "#404042", running: "#2d5a90", complete: "#2f6840", failed: "#6a2828",
};
const BTN_BG: Record<AgentStatus, string> = {
  idle: "#252527", running: "#172438", complete: "#172c1c", failed: "#280e0e",
};
const BTN_COLOR: Record<AgentStatus, string> = {
  idle: "#707072", running: "#5890d8", complete: "#48a858", failed: "#b84848",
};

const EXPLORER = "https://stellar.expert/explorer/testnet/account";

function truncate(key: string): string {
  return key.length >= 10 ? `${key.slice(0, 6)}·${key.slice(-4)}` : key;
}

export function AgentCard({
  index, name, capability, status, wallet, spent, reputation, color, isLast,
}: AgentCardProps) {
  const repPct   = Math.min(1, Math.max(0, reputation / 10000));
  const spentPct = Math.min(1, spent / 1e7 / 0.1);   // 0.1 XLM = full scale
  const actPct   = { idle: 0, running: 0.5, complete: 1, failed: 0.15 }[status];
  const repScore = String(Math.round(reputation / 100)).padStart(3, "0");

  const sep = (
    <div style={{
      width: 1, height: 54, background: "#272729",
      flexShrink: 0, margin: "0 1.125rem",
    }} />
  );

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      height: 88,
      padding: "0 1.25rem",
      borderBottom: isLast ? "none" : "1px solid #202022",
      background: status === "running" ? "rgba(28,56,96,0.06)" : "transparent",
      transition: "background 0.35s",
    }}>

      {/* ── Agent ID ── */}
      <div style={{ width: 96, flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: "0.52rem", letterSpacing: "0.14em", color: "#484848", fontFamily: "var(--font)", textTransform: "uppercase" }}>
          AGT.0{index}
        </span>
        <span style={{ fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.06em", color: "#d8d8d8", fontFamily: "var(--font)", textTransform: "uppercase" }}>
          {name}
        </span>
        {wallet ? (
          <a
            href={`${EXPLORER}/${wallet}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.5rem", letterSpacing: "0.04em", color: "#484848", textDecoration: "none", fontFamily: "var(--font)", marginTop: 1, transition: "color 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#888889"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#484848"; }}
          >
            {truncate(wallet)}
          </a>
        ) : (
          <span style={{ fontSize: "0.5rem", color: "#303032", fontFamily: "var(--font)", marginTop: 1 }}>
            {capability}
          </span>
        )}
      </div>

      {/* ── Status buttons 2 × 2 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, flexShrink: 0, marginLeft: 8 }}>
        {STATUS_STATES.map(s => {
          const active = s === status;
          return (
            <div
              key={s}
              style={{
                width: 32, height: 15,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.47rem", letterSpacing: "0.09em",
                fontFamily: "var(--font)", textTransform: "uppercase",
                border: `1px solid ${active ? BTN_BORDER[status] : "#242426"}`,
                borderRadius: 2,
                background: active ? BTN_BG[status] : "#1c1c1e",
                color: active ? BTN_COLOR[status] : "#303032",
                userSelect: "none",
              }}
            >
              {STATUS_LABEL[s]}
            </div>
          );
        })}
      </div>

      {sep}

      {/* ── Knobs ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
        <Knob value={repPct}   label="REP" color={color} />
        <Knob value={actPct}   label="ACT" color={color} />
        <Knob value={spentPct} label="XLM" color={color} />
      </div>

      {sep}

      {/* ── VCA slider ── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span style={{
          fontSize: "0.52rem", letterSpacing: "0.12em", color: "#484848",
          fontFamily: "var(--font)", textTransform: "uppercase", flexShrink: 0,
        }}>VCA</span>

        <div style={{ flex: 1, height: 5, background: "#252527", borderRadius: 3, position: "relative", minWidth: 60 }}>
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${repPct * 100}%`,
            background: color,
            borderRadius: 3,
            transition: "width 0.5s ease",
          }} />
          {repPct > 0.02 && (
            <div style={{
              position: "absolute", top: "50%", left: `${repPct * 100}%`,
              transform: "translate(-50%, -50%)",
              width: 11, height: 11, borderRadius: "50%",
              background: color, border: "2px solid #1c1c1e",
              boxShadow: `0 0 7px ${color}99`,
            }} />
          )}
        </div>

        <span style={{
          fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.04em",
          color: repPct > 0.2 ? color : "#343436",
          width: 34, textAlign: "right", flexShrink: 0,
          fontFamily: "var(--font)",
        }}>
          {repScore}
        </span>
      </div>
    </div>
  );
}
