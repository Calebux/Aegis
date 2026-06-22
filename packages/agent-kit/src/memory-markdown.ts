/**
 * MarkdownMemoryProvider — Obsidian-compatible vault memory for agents.
 *
 * Stores each memory as a `.md` file with YAML frontmatter.
 * Supports [[wikilinks]], tag-based filtering, and full-text search.
 * Point it at any Obsidian vault or plain markdown folder.
 *
 * @example
 * ```ts
 * const memory = new MarkdownMemoryProvider('./my-vault')
 * await memory.store('research/celo-defi', 'Celo TVL is $500M', { tags: 'defi,celo' })
 * const results = await memory.search('celo defi')
 * ```
 */

import type { MemoryProvider, MemoryResult } from "./memory.js";

// ── Frontmatter helpers ──────────────────────────────────────────────────────

function buildFrontmatter(metadata: Record<string, string>): string {
  const lines = Object.entries(metadata).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function parseFrontmatter(
  raw: string
): { metadata: Record<string, string>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, content: raw };
  const metadata: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(": ");
    if (idx > 0) {
      metadata[line.slice(0, idx).trim()] = line.slice(idx + 2).trim();
    }
  }
  return { metadata, content: match[2] };
}

// ── Key → path helpers ───────────────────────────────────────────────────────

function keyToPath(vaultPath: string, key: string): string {
  // Sanitize key: replace special chars, ensure .md extension
  const clean = key.replace(/[<>:"|?*]/g, "-");
  const withExt = clean.endsWith(".md") ? clean : `${clean}.md`;
  return `${vaultPath}/${withExt}`;
}

function pathToKey(vaultPath: string, filePath: string): string {
  const rel = filePath.slice(vaultPath.length + 1);
  return rel.endsWith(".md") ? rel.slice(0, -3) : rel;
}

// ── MarkdownMemoryProvider ───────────────────────────────────────────────────

export class MarkdownMemoryProvider implements MemoryProvider {
  constructor(private readonly vaultPath: string) {}

  /**
   * Search all markdown files in the vault by keyword.
   * Matches against filename, content, and frontmatter tags.
   */
  async search(query: string, limit = 10): Promise<MemoryResult[]> {
    const { readdir, readFile } = await import("fs/promises");
    const files = await this.walkMdFiles(this.vaultPath);
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);
    const results: MemoryResult[] = [];

    for (const filePath of files) {
      try {
        const raw = await readFile(filePath, "utf-8");
        const key = pathToKey(this.vaultPath, filePath);
        const { metadata, content } = parseFrontmatter(raw);
        const searchable = `${key} ${content} ${metadata.tags ?? ""}`.toLowerCase();

        // Score: count how many query terms match
        let matchCount = 0;
        for (const term of queryTerms) {
          if (searchable.includes(term)) matchCount++;
        }

        if (matchCount > 0) {
          results.push({
            key,
            content,
            score: matchCount / queryTerms.length,
            metadata,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Store a memory as a markdown file with YAML frontmatter.
   * Creates subdirectories as needed.
   * Metadata keys become frontmatter fields; add `tags` for discoverability.
   */
  async store(
    key: string,
    content: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    const { writeFile, mkdir } = await import("fs/promises");
    const { dirname } = await import("path");
    const filePath = keyToPath(this.vaultPath, key);
    await mkdir(dirname(filePath), { recursive: true });

    const meta: Record<string, string> = {
      created: new Date().toISOString(),
      ...metadata,
    };

    const fileContent = `${buildFrontmatter(meta)}\n${content}\n`;
    await writeFile(filePath, fileContent, "utf-8");
  }

  /**
   * Read a specific markdown file by key.
   * Returns the content without frontmatter, or null if not found.
   */
  async getPage(key: string): Promise<string | null> {
    const { readFile } = await import("fs/promises");
    try {
      const raw = await readFile(keyToPath(this.vaultPath, key), "utf-8");
      const { content } = parseFrontmatter(raw);
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Recall relevant memories for an agent and task context.
   * Searches, formats as markdown context block.
   */
  async recall(agentId: string, taskContext: string): Promise<string> {
    const results = await this.search(`${agentId} ${taskContext}`, 5);
    if (results.length === 0) return "";
    const lines = results.map(
      (r) =>
        `### [[${r.key}]] (relevance: ${(r.score * 100).toFixed(0)}%)\n${r.content.slice(0, 300)}`
    );
    return `## Recalled Memory\n\n${lines.join("\n\n---\n\n")}`;
  }

  /**
   * List all memory keys in the vault.
   */
  async listKeys(): Promise<string[]> {
    const files = await this.walkMdFiles(this.vaultPath);
    return files.map((f) => pathToKey(this.vaultPath, f));
  }

  /**
   * Delete a memory by key.
   */
  async delete(key: string): Promise<void> {
    const { unlink } = await import("fs/promises");
    try {
      await unlink(keyToPath(this.vaultPath, key));
    } catch {
      // Already gone
    }
  }

  /**
   * Add a [[wikilink]] reference from one note to another.
   * Appends the link to the source note's content.
   */
  async link(fromKey: string, toKey: string, context?: string): Promise<void> {
    const existing = await this.getPage(fromKey);
    if (existing === null) return;
    const linkLine = context
      ? `\n- [[${toKey}]] — ${context}`
      : `\n- [[${toKey}]]`;
    const { readFile, writeFile } = await import("fs/promises");
    const filePath = keyToPath(this.vaultPath, fromKey);
    const raw = await readFile(filePath, "utf-8");
    await writeFile(filePath, raw + linkLine + "\n", "utf-8");
  }

  // ── Internal: walk directory for .md files ─────────────────────────────

  private async walkMdFiles(dir: string): Promise<string[]> {
    const { readdir, stat } = await import("fs/promises");
    const { join } = await import("path");
    const results: string[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue; // skip hidden
        const fullPath = join(dir, entry);
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          results.push(...(await this.walkMdFiles(fullPath)));
        } else if (entry.endsWith(".md")) {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
    return results;
  }
}
