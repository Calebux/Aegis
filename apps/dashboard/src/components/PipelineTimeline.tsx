"use client";

import { useState, useEffect } from "react";

interface PipelineTimelineProps {
  agents: { id: string; name: string; color: string }[];
  startedAt: Record<string, number>;
  completedAt: Record<string, number>;
  running: boolean;
}

export function PipelineTimeline({ agents, startedAt, completedAt, running }: PipelineTimelineProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const starts = Object.values(startedAt);
  if (starts.length === 0) return null;

  const pipelineStart = Math.min(...starts);
  const allEnds = Object.values(completedAt);
  const pipelineEnd = allEnds.length > 0 ? Math.max(...allEnds) : now;
  const totalDuration = Math.max(pipelineEnd - pipelineStart, 1);

  return (
    <div className="pipeline-timeline">
      <div className="mod-header">
        PIPELINE TIMELINE
        {running && <span className="live-dot" />}
        <span style={{ marginLeft: "auto", color: "var(--text-mid)", fontFamily: "var(--font-mono)" }}>
          {(totalDuration / 1000).toFixed(1)}s
        </span>
      </div>
      <div style={{ padding: "0.75rem 1rem" }}>
        {agents.map((a) => {
          const start = startedAt[a.id];
          if (start === undefined) return null;
          const end = completedAt[a.id];
          const left = ((start - pipelineStart) / totalDuration) * 100;
          const width = end
            ? ((end - start) / totalDuration) * 100
            : ((now - start) / totalDuration) * 100;
          const duration = end ? ((end - start) / 1000).toFixed(1) : "...";

          return (
            <div key={a.id} className="timeline-row">
              <span className="timeline-label">{a.name}</span>
              <div className="timeline-track">
                <div
                  className={`timeline-bar${!end ? " timeline-bar--active" : ""}`}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 1)}%`,
                    background: a.color,
                  }}
                />
              </div>
              <span className="timeline-duration">{duration}s</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
