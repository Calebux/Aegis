/**
 * Memory adapter for persistent agent memory via gBrain MCP or in-memory fallback.
 *
 * Provides a simple read/write/search interface that agents use during runs
 * to recall past context and store learned patterns.
 */

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface MemoryResult {
  key: string;
  content: string;
  score: number;
  metadata?: Record<string, string>;
}

export interface MemoryProvider {
  /** Search memory by semantic query */
  search(query: string, limit?: number): Promise<MemoryResult[]>;
  /** Store a memory entry by key */
  store(key: string, content: string, metadata?: Record<string, string>): Promise<void>;
  /** Get a specific page/entry by key */
  getPage(key: string): Promise<string | null>;
  /** Search + format results as context string for prompt injection */
  recall(agentId: string, taskContext: string): Promise<string>;
}

export interface GBrainMemoryConfig {
  /** gBrain MCP server URL (HTTP SSE endpoint) */
  url: string;
  /** Optional auth token for gBrain server */
  token?: string;
  /** Namespace prefix for agent memory keys */
  namespace?: string;
}

export interface MemoryProviderConfig {
  type: "gbrain" | "memory" | "file" | "markdown";
  gbrain?: GBrainMemoryConfig;
  /** Path to the JSON file for the "file" provider */
  filePath?: string;
  /** Path to the markdown vault folder for the "markdown" provider */
  vaultPath?: string;
}

// ── GBrainMemory ─────────────────────────────────────────────────────────────

/**
 * Memory provider backed by gBrain's MCP knowledge graph server.
 * Calls gBrain tools via HTTP: search, put_page, get_page.
 */
export class GBrainMemory implements MemoryProvider {
  private url: string;
  private token?: string;
  private namespace: string;

  constructor(config: GBrainMemoryConfig) {
    this.url = config.url.replace(/\/$/, "");
    this.token = config.token;
    this.namespace = config.namespace ?? "calagent";
  }

  private async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const resp = await fetch(`${this.url}/mcp/tools/${tool}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(args),
    });
    if (!resp.ok) {
      throw new Error(`gBrain ${tool} failed: ${resp.status} ${resp.statusText}`);
    }
    return resp.json();
  }

  private prefixKey(key: string): string {
    return `${this.namespace}/${key}`;
  }

  async search(query: string, limit = 10): Promise<MemoryResult[]> {
    const result = await this.callTool("search", { query, limit }) as {
      results?: Array<{ key: string; content: string; score: number; metadata?: Record<string, string> }>;
    };
    return (result.results ?? []).map((r) => ({
      key: r.key,
      content: r.content,
      score: r.score,
      metadata: r.metadata,
    }));
  }

  async store(key: string, content: string, metadata?: Record<string, string>): Promise<void> {
    await this.callTool("put_page", {
      key: this.prefixKey(key),
      content,
      metadata: metadata ?? {},
    });
  }

  async getPage(key: string): Promise<string | null> {
    try {
      const result = await this.callTool("get_page", { key: this.prefixKey(key) }) as {
        content?: string;
      };
      return result.content ?? null;
    } catch {
      return null;
    }
  }

  async recall(agentId: string, taskContext: string): Promise<string> {
    const query = `agent:${agentId} ${taskContext}`;
    const results = await this.search(query, 5);
    if (results.length === 0) return "";
    const lines = results.map(
      (r) => `[${r.key}] (score: ${r.score.toFixed(2)})\n${r.content}`
    );
    return `## Recalled Memory\n\n${lines.join("\n\n---\n\n")}`;
  }
}

// ── InMemoryProvider ─────────────────────────────────────────────────────────

/**
 * Map-based in-memory fallback for dev/testing.
 * No persistence — memory resets when the process restarts.
 */
export class InMemoryProvider implements MemoryProvider {
  private store_map = new Map<string, { content: string; metadata?: Record<string, string> }>();

  async search(query: string, limit = 10): Promise<MemoryResult[]> {
    const queryLower = query.toLowerCase();
    const results: MemoryResult[] = [];
    for (const [key, entry] of this.store_map) {
      const combined = `${key} ${entry.content}`.toLowerCase();
      if (combined.includes(queryLower)) {
        results.push({
          key,
          content: entry.content,
          score: 1.0,
          metadata: entry.metadata,
        });
      }
    }
    return results.slice(0, limit);
  }

  async store(key: string, content: string, metadata?: Record<string, string>): Promise<void> {
    this.store_map.set(key, { content, metadata });
  }

  async getPage(key: string): Promise<string | null> {
    return this.store_map.get(key)?.content ?? null;
  }

  async recall(agentId: string, taskContext: string): Promise<string> {
    const results = await this.search(`${agentId} ${taskContext}`, 5);
    if (results.length === 0) return "";
    const lines = results.map((r) => `[${r.key}]\n${r.content}`);
    return `## Recalled Memory\n\n${lines.join("\n\n---\n\n")}`;
  }
}

// ── FileMemoryProvider ───────────────────────────────────────────────────────

/**
 * JSON-file-backed memory provider that survives process restarts.
 * Falls back to keyword matching (same as InMemoryProvider) for search.
 * Data is persisted to `filePath` after every write.
 */
export class FileMemoryProvider implements MemoryProvider {
  private data = new Map<string, { content: string; metadata?: Record<string, string> }>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const { readFile } = await import("fs/promises");
      const raw = await readFile(this.filePath, "utf-8");
      const entries = JSON.parse(raw) as Array<[string, { content: string; metadata?: Record<string, string> }]>;
      this.data = new Map(entries);
    } catch {
      // File doesn't exist yet or is invalid — start empty
    }
  }

  private async flush(): Promise<void> {
    const { writeFile, mkdir } = await import("fs/promises");
    const { dirname } = await import("path");
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify([...this.data]), "utf-8");
  }

  async search(query: string, limit = 10): Promise<MemoryResult[]> {
    await this.load();
    const queryLower = query.toLowerCase();
    const results: MemoryResult[] = [];
    for (const [key, entry] of this.data) {
      const combined = `${key} ${entry.content}`.toLowerCase();
      if (combined.includes(queryLower)) {
        results.push({
          key,
          content: entry.content,
          score: 1.0,
          metadata: entry.metadata,
        });
      }
    }
    return results.slice(0, limit);
  }

  async store(key: string, content: string, metadata?: Record<string, string>): Promise<void> {
    await this.load();
    this.data.set(key, { content, metadata });
    await this.flush();
  }

  async getPage(key: string): Promise<string | null> {
    await this.load();
    return this.data.get(key)?.content ?? null;
  }

  async recall(agentId: string, taskContext: string): Promise<string> {
    const results = await this.search(`${agentId} ${taskContext}`, 5);
    if (results.length === 0) return "";
    const lines = results.map((r) => `[${r.key}]\n${r.content}`);
    return `## Recalled Memory\n\n${lines.join("\n\n---\n\n")}`;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a memory provider from config.
 *
 * @example
 * ```ts
 * const memory = createMemoryProvider({ type: 'gbrain', gbrain: { url: 'http://localhost:3100' } })
 * const memory = createMemoryProvider({ type: 'memory' }) // dev fallback
 * ```
 */
export function createMemoryProvider(config: MemoryProviderConfig): MemoryProvider {
  if (config.type === "gbrain") {
    if (!config.gbrain) {
      throw new Error("GBrain config required when type is 'gbrain'");
    }
    return new GBrainMemory(config.gbrain);
  }
  if (config.type === "file") {
    const filePath = config.filePath ?? ".calagent/memory.json";
    return new FileMemoryProvider(filePath);
  }
  if (config.type === "markdown") {
    // Lazy import to avoid circular deps
    const { MarkdownMemoryProvider } = require("./memory-markdown.js") as typeof import("./memory-markdown.js");
    const vaultPath = config.vaultPath ?? ".calagent/vault";
    return new MarkdownMemoryProvider(vaultPath);
  }
  return new InMemoryProvider();
}
