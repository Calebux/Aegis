/**
 * Tool-use framework for agents.
 *
 * Agents can call arbitrary tools (functions) during their run without
 * needing wallets, blockchain, or payment infrastructure. Tools are
 * simple { name, description, execute } objects.
 *
 * @example
 * ```ts
 * import { defineTool, webFetchTool, createToolkit } from '@calebux/agent-kit'
 *
 * const myTool = defineTool({
 *   name: 'calculate',
 *   description: 'Evaluate a math expression',
 *   parameters: { expression: 'string' },
 *   execute: async ({ expression }) => String(eval(expression))
 * })
 *
 * const toolkit = createToolkit([webFetchTool, myTool])
 * const result = await toolkit.call('calculate', { expression: '2 + 2' })
 * ```
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface Tool<TInput = Record<string, unknown>, TOutput = unknown> {
  /** Unique tool name (used for invocation) */
  name: string;
  /** Human-readable description of what this tool does */
  description: string;
  /** Schema hint for parameters — keys are param names, values are type labels */
  parameters?: Record<string, string>;
  /** Execute the tool with the given input */
  execute: (input: TInput) => Promise<TOutput>;
}

export interface ToolResult {
  tool: string;
  output: unknown;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface Toolkit {
  /** List all available tools */
  tools: Tool[];
  /** Call a tool by name */
  call: (name: string, input?: Record<string, unknown>) => Promise<ToolResult>;
  /** Get a tool by name */
  get: (name: string) => Tool | undefined;
  /** Tool descriptions formatted for LLM system prompts */
  describe: () => string;
}

// ── defineTool ───────────────────────────────────────────────────────────────

export function defineTool<
  TInput = Record<string, unknown>,
  TOutput = unknown,
>(tool: Tool<TInput, TOutput>): Tool<TInput, TOutput> {
  return tool;
}

// ── createToolkit ────────────────────────────────────────────────────────────

export function createToolkit(tools: Tool[]): Toolkit {
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  return {
    tools,
    get: (name) => toolMap.get(name) as Tool | undefined,
    call: async (name, input = {}) => {
      const tool = toolMap.get(name);
      if (!tool) {
        return {
          tool: name,
          output: null,
          durationMs: 0,
          success: false,
          error: `Tool "${name}" not found. Available: ${[...toolMap.keys()].join(", ")}`,
        };
      }
      const start = Date.now();
      try {
        const output = await (tool as Tool<Record<string, unknown>>).execute(input);
        return { tool: name, output, durationMs: Date.now() - start, success: true };
      } catch (err) {
        return {
          tool: name,
          output: null,
          durationMs: Date.now() - start,
          success: false,
          error: String(err),
        };
      }
    },
    describe: () => {
      return tools
        .map((t) => {
          const params = t.parameters
            ? Object.entries(t.parameters)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ")
            : "none";
          return `- **${t.name}**(${params}): ${t.description}`;
        })
        .join("\n");
    },
  };
}

// ── Built-in tools ───────────────────────────────────────────────────────────

/** Fetch a URL and return the response body as text. */
export const webFetchTool = defineTool<{ url: string; method?: string }, string>({
  name: "web_fetch",
  description: "Fetch a URL and return the response as text",
  parameters: { url: "string", method: "string (optional, default GET)" },
  execute: async ({ url, method }) => {
    const resp = await fetch(url, { method: method ?? "GET" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    return resp.text();
  },
});

/** Read a file from disk. */
export const fileReadTool = defineTool<{ path: string }, string>({
  name: "file_read",
  description: "Read a file and return its contents as text",
  parameters: { path: "string" },
  execute: async ({ path }) => {
    const { readFile } = await import("fs/promises");
    return readFile(path, "utf-8");
  },
});

/** Write content to a file on disk. */
export const fileWriteTool = defineTool<{ path: string; content: string }, string>({
  name: "file_write",
  description: "Write content to a file (creates directories as needed)",
  parameters: { path: "string", content: "string" },
  execute: async ({ path, content }) => {
    const { writeFile, mkdir } = await import("fs/promises");
    const { dirname } = await import("path");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");
    return `Wrote ${content.length} bytes to ${path}`;
  },
});

/** Execute a shell command and return stdout. */
export const shellTool = defineTool<{ command: string; cwd?: string }, string>({
  name: "shell",
  description: "Execute a shell command and return stdout",
  parameters: { command: "string", cwd: "string (optional)" },
  execute: async ({ command, cwd }) => {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 30_000,
    });
    if (stderr) return `${stdout}\n[stderr] ${stderr}`;
    return stdout;
  },
});

/** Search for text in files using grep-like matching. */
export const grepTool = defineTool<
  { pattern: string; path?: string; glob?: string },
  string
>({
  name: "grep",
  description: "Search for a text pattern in files under a directory",
  parameters: {
    pattern: "string (regex)",
    path: "string (directory, default: .)",
    glob: "string (file pattern, e.g. '*.ts')",
  },
  execute: async ({ pattern, path, glob }) => {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    const dir = path ?? ".";
    const includeFlag = glob ? `--include='${glob}'` : "";
    const { stdout } = await execAsync(
      `grep -rn ${includeFlag} '${pattern}' '${dir}' 2>/dev/null | head -50`,
      { timeout: 10_000 }
    ).catch(() => ({ stdout: "(no matches)" }));
    return stdout;
  },
});

// ── LLM-compatible format converters ─────────────────────────────────────────

/** Map agent-kit type labels to JSON Schema types */
function toJsonSchemaType(typeLabel: string): string {
  const label = typeLabel.toLowerCase().replace(/\s*\(.*\)/, "").trim();
  if (label === "number" || label === "integer") return label;
  if (label === "boolean") return "boolean";
  if (label === "array") return "array";
  if (label === "object") return "object";
  return "string";
}

export interface OpenAIFunction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

/**
 * Convert agent-kit tools to OpenAI function-calling format.
 * Pass the result directly to `openai.chat.completions.create({ functions })`.
 *
 * @example
 * ```ts
 * const functions = toOpenAIFunctions([webFetchTool, fileWriteTool])
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [...],
 *   functions,
 * })
 * ```
 */
export function toOpenAIFunctions(tools: Tool[]): OpenAIFunction[] {
  return tools.map((tool) => {
    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];

    if (tool.parameters) {
      for (const [key, typeLabel] of Object.entries(tool.parameters)) {
        const isOptional = typeLabel.toLowerCase().includes("optional");
        properties[key] = {
          type: toJsonSchemaType(typeLabel),
          description: typeLabel,
        };
        if (!isOptional) required.push(key);
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: { type: "object" as const, properties, required },
    };
  });
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

/**
 * Convert agent-kit tools to Anthropic Claude tool-use format.
 * Pass the result directly to `anthropic.messages.create({ tools })`.
 *
 * @example
 * ```ts
 * const tools = toAnthropicTools([webFetchTool, fileWriteTool])
 * const response = await anthropic.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   messages: [...],
 *   tools,
 * })
 * ```
 */
export function toAnthropicTools(tools: Tool[]): AnthropicTool[] {
  return tools.map((tool) => {
    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];

    if (tool.parameters) {
      for (const [key, typeLabel] of Object.entries(tool.parameters)) {
        const isOptional = typeLabel.toLowerCase().includes("optional");
        properties[key] = {
          type: toJsonSchemaType(typeLabel),
          description: typeLabel,
        };
        if (!isOptional) required.push(key);
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      input_schema: { type: "object" as const, properties, required },
    };
  });
}
