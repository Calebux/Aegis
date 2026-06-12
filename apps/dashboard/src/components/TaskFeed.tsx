"use client";

/**
 * TaskFeed — live list of tasks and their sub-task statuses.
 * Polls /api/tasks every 3 seconds via SWR.
 */

import useSWR from "swr";
import type { Task } from "@aegis/shared";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--text-muted)",
  running: "var(--accent)",
  completed: "var(--green)",
  failed: "var(--red)",
  cancelled: "var(--yellow)",
};

export function TaskFeed() {
  const { data, error, isLoading } = useSWR<{ tasks: Task[] }>(
    "/api/tasks",
    fetcher,
    { refreshInterval: 3000 }
  );

  if (isLoading) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;
  if (error) return <p style={{ color: "var(--red)" }}>Failed to load tasks.</p>;

  const tasks = data?.tasks ?? [];

  if (tasks.length === 0) {
    return (
      <div className="card" style={{ color: "var(--text-muted)" }}>
        No tasks yet. Submit a prompt on the main dashboard to get started.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {tasks.map((task) => (
        <div key={task.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
              {task.chain && (
                <span style={{
                  fontSize: "0.625rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  padding: "0.1rem 0.4rem",
                  borderRadius: "3px",
                  background: task.chain === "celo" ? "rgba(252,204,7,0.15)" : "rgba(0,180,120,0.12)",
                  color: task.chain === "celo" ? "#d4a800" : "var(--green)",
                  border: `1px solid ${task.chain === "celo" ? "rgba(252,204,7,0.3)" : "rgba(0,180,120,0.25)"}`,
                  flexShrink: 0,
                }}>
                  {task.chain.toUpperCase()}
                </span>
              )}
              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.prompt}
              </strong>
            </div>
            <span style={{ color: STATUS_COLORS[task.status] ?? "inherit", flexShrink: 0, marginLeft: "0.5rem" }}>
              {task.status}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {task.subTasks.map((st) => (
              <div
                key={st.id}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  fontSize: "0.8125rem",
                  color: "var(--text-muted)",
                }}
              >
                <span
                  style={{
                    width: "0.5rem",
                    height: "0.5rem",
                    borderRadius: "50%",
                    background: STATUS_COLORS[st.status] ?? "grey",
                    marginTop: "0.35rem",
                    flexShrink: 0,
                  }}
                />
                <span>
                  [{st.assignedAgent}] {st.instruction}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
