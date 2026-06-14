"use client";

/**
 * TaskGraph — live visual of the agent execution graph (Upgrade 6)
 *
 * Renders nodes in dependency order. Node colours reflect live status:
 *   pending  → grey
 *   running  → blue (pulsing)
 *   complete → green
 *   error    → red
 *
 * Used in page.tsx when a task:graph SSE event is received.
 */

import React from "react";

// ── Types (must match planner.ts, duplicated here to avoid server imports) ────

export type AgentType = "scout" | "ledger" | "signal" | "scribe" | "validator" | "executor";
export type NodeStatus = "pending" | "running" | "complete" | "error";

export interface TaskNode {
  id: string;
  agentType: AgentType;
  dependsOn: string[];
  mode: string;
  params: Record<string, unknown>;
}

export interface TaskGraph {
  runId: string;
  prompt: string;
  nodes: TaskNode[];
}

// ── Config ─────────────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<AgentType, string> = {
  scout:     "#c8c040",
  ledger:    "#48b858",
  signal:    "#b050c0",
  scribe:    "#d04828",
  validator: "#5890d8",
  executor:  "#e07840",
};

const AGENT_ICONS: Record<AgentType, string> = {
  scout:     "🔍",
  ledger:    "📊",
  signal:    "📈",
  scribe:    "✍️",
  validator: "🔬",
  executor:  "⚡",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface TaskGraphProps {
  graph: TaskGraph;
  /** Map from agentType → current status */
  statusMap?: Partial<Record<AgentType, NodeStatus>>;
  /** Map from agentType → confidence (0–1) */
  confidenceMap?: Partial<Record<AgentType, number>>;
}

export function TaskGraphView({
  graph,
  statusMap = {},
  confidenceMap = {},
}: TaskGraphProps) {
  // Group nodes into layers by dependency depth
  const layers = buildLayers(graph.nodes);

  return (
    <div style={{ padding: "1rem 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0",
          overflowX: "auto",
          paddingBottom: "0.5rem",
        }}
      >
        {layers.map((layer, li) => (
          <React.Fragment key={li}>
            {li > 0 && (
              <div
                style={{
                  width: "2rem",
                  height: "2px",
                  background: "#d0d0d8",
                  flexShrink: 0,
                  alignSelf: "center",
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                flexShrink: 0,
              }}
            >
              {layer.map((node) => {
                const status: NodeStatus = statusMap[node.agentType] ?? "pending";
                const conf = confidenceMap[node.agentType];
                return (
                  <NodeCard
                    key={node.id}
                    node={node}
                    status={status}
                    confidence={conf}
                  />
                );
              })}
            </div>
          </React.Fragment>
        ))}
      </div>
      <div
        style={{
          fontSize: "0.65rem",
          color: "#656d76",
          marginTop: "0.5rem",
          fontFamily: "monospace",
        }}
      >
        RUN {graph.runId.slice(0, 8).toUpperCase()} ·{" "}
        {graph.nodes.length} NODES
      </div>
    </div>
  );
}

// ── Node card ─────────────────────────────────────────────────────────────────

interface NodeCardProps {
  node: TaskNode;
  status: NodeStatus;
  confidence?: number;
}

function NodeCard({ node, status, confidence }: NodeCardProps) {
  const color = AGENT_COLORS[node.agentType] ?? "#888";
  const icon  = AGENT_ICONS[node.agentType] ?? "●";

  const borderColor =
    status === "complete" ? color :
    status === "running"  ? "#5890d8" :
    status === "error"    ? "#d04040" :
    "#e8e8ec";

  const bgColor =
    status === "complete" ? `${color}10` :
    status === "running"  ? "#5890d810" :
    "#ffffff";

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: "4px",
        padding: "0.4rem 0.75rem",
        background: bgColor,
        minWidth: "90px",
        position: "relative",
        transition: "all 0.3s ease",
      }}
    >
      {status === "running" && (
        <span
          style={{
            position: "absolute",
            top: "4px",
            right: "4px",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "#5890d8",
            animation: "pulse 1s infinite",
          }}
        />
      )}
      <div style={{ fontSize: "0.7rem", color: "#1a1a2e", fontFamily: "monospace" }}>
        {icon} {node.agentType.toUpperCase()}
      </div>
      <div
        style={{
          fontSize: "0.55rem",
          color: "#656d76",
          fontFamily: "monospace",
          marginTop: "2px",
        }}
      >
        {node.mode}
        {confidence !== undefined && (
          <span style={{ color: color, marginLeft: "4px" }}>
            {(confidence * 100).toFixed(0)}%
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: "0.55rem",
          color:
            status === "complete" ? color :
            status === "running"  ? "#5890d8" :
            status === "error"    ? "#d04040" :
            "#b0b0b8",
          fontFamily: "monospace",
          marginTop: "2px",
          textTransform: "uppercase",
        }}
      >
        {status}
      </div>
    </div>
  );
}

// ── Layer builder ─────────────────────────────────────────────────────────────

/** Topological sort into layers for left-to-right display */
function buildLayers(nodes: TaskNode[]): TaskNode[][] {
  const idToDepth = new Map<string, number>();

  function getDepth(nodeId: string): number {
    if (idToDepth.has(nodeId)) return idToDepth.get(nodeId)!;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return 0;
    const depth =
      node.dependsOn.length === 0
        ? 0
        : Math.max(...node.dependsOn.map(getDepth)) + 1;
    idToDepth.set(nodeId, depth);
    return depth;
  }

  for (const node of nodes) getDepth(node.id);

  const maxDepth = Math.max(...Array.from(idToDepth.values()), 0);
  const layers: TaskNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const node of nodes) {
    const d = idToDepth.get(node.id) ?? 0;
    layers[d]!.push(node);
  }
  return layers.filter((l) => l.length > 0);
}
