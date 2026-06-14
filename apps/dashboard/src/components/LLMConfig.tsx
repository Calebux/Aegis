"use client";

import { useState, useEffect, useCallback } from "react";

export interface LLMConfigValue {
  provider: "anthropic" | "openrouter";
  apiKey?: string;
  model?: string;
}

interface LLMConfigProps {
  disabled?: boolean;
  onChange: (config: LLMConfigValue) => void;
}

const STORAGE_KEY = "calagent:llm-config";

const DEFAULT_OPENROUTER_MODEL = "nousresearch/hermes-3-llama-3.1-405b";

function loadSaved(): LLMConfigValue {
  if (typeof window === "undefined") return { provider: "anthropic" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LLMConfigValue;
  } catch { /* ignore */ }
  return { provider: "anthropic" };
}

export function LLMConfig({ disabled, onChange }: LLMConfigProps) {
  const [config, setConfig] = useState<LLMConfigValue>(loadSaved);
  const [expanded, setExpanded] = useState(false);

  // Notify parent on mount and changes
  useEffect(() => {
    onChange(config);
  }, [config, onChange]);

  const update = useCallback((partial: Partial<LLMConfigValue>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch { /* quota */ }
      return next;
    });
  }, []);

  const isOpenRouter = config.provider === "openrouter";

  return (
    <div className="llm-config">
      <button
        className="llm-config-toggle"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <span className="llm-config-label">LLM</span>
        <span className="llm-config-value">
          {isOpenRouter ? "OpenRouter" : "Claude"}
        </span>
        <span className={`llm-config-chevron${expanded ? " open" : ""}`}>
          {"\u25B8"}
        </span>
      </button>

      {expanded && (
        <div className="llm-config-panel">
          <div className="llm-config-row">
            <label className="llm-config-field-label">Provider</label>
            <select
              className="llm-config-select"
              value={config.provider}
              onChange={(e) => update({ provider: e.target.value as "anthropic" | "openrouter" })}
              disabled={disabled}
            >
              <option value="anthropic">Anthropic Claude (default)</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>

          {isOpenRouter && (
            <>
              <div className="llm-config-row">
                <label className="llm-config-field-label">API Key</label>
                <input
                  className="llm-config-input"
                  type="password"
                  placeholder="sk-or-..."
                  value={config.apiKey ?? ""}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="llm-config-row">
                <label className="llm-config-field-label">Model</label>
                <input
                  className="llm-config-input"
                  type="text"
                  placeholder={DEFAULT_OPENROUTER_MODEL}
                  value={config.model ?? ""}
                  onChange={(e) => update({ model: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="llm-config-hint">
                Key is sent per-request only, never stored on server.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
