import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeRepo } from "../git.ts";
import { JsonlSessionProvider } from "./base.ts";
import type { ParsedSession, PromptRecord, SessionRecord } from "./types.ts";

type CodexIndex = Map<string, { title: string | null; updatedAt: string | null }>;

// Read lazily so tests (and CODEX_HOME overrides) take effect at call time.
const codexHome = () => process.env.CODEX_HOME || join(homedir(), ".codex");
const sessionsDir = () => join(codexHome(), "sessions");
const indexFile = () => join(codexHome(), "session_index.jsonl");

/**
 * Injected, non-user text that Codex prepends to the conversation as
 * `role: "user"` messages. These are AGENTS.md contents, app context, and
 * environment blocks — not prompts the human typed. We drop them.
 */
export function isInjectedContext(text: string): boolean {
  const t = text.trimStart();
  if (t.startsWith("<")) return true; // <app-context>, <user_instructions>, <environment_context>, ...
  if (t.startsWith("# AGENTS.md")) return true;
  if (t.startsWith("# Codex")) return true;
  return false;
}

/** Load session_index.jsonl into id -> {title, updatedAt}. Best-effort. */
async function loadIndex(): Promise<CodexIndex> {
  const map: CodexIndex = new Map();
  const file = indexFile();
  if (!existsSync(file)) return map;
  try {
    const text = await readFile(file, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.id) map.set(o.id, { title: o.thread_name ?? null, updatedAt: o.updated_at ?? null });
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}

/** Parse one rollout JSONL file into a session + its prompts. */
async function parseCodexRollout(path: string, index: CodexIndex): Promise<ParsedSession | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }

  let meta: SessionRecord | null = null;
  const prompts: PromptRecord[] = [];
  let seq = 0;
  let lastTs: string | null = null;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const ts: string | null = o.timestamp ?? null;
    if (ts) lastTs = ts;
    const p = o.payload;
    if (!p) continue;

    if (o.type === "session_meta" || p.type === "session_meta") {
      const git = p.git ?? {};
      const id: string = p.session_id || p.id || path;
      meta = {
        id,
        provider: "codex",
        cwd: p.cwd ?? "",
        repositoryUrl: git.repository_url ?? null,
        repo: normalizeRepo(git.repository_url),
        branch: git.branch ?? null,
        startCommit: git.commit_hash ?? null,
        startedAt: p.timestamp ?? ts ?? new Date().toISOString(),
        endedAt: p.timestamp ?? ts ?? new Date().toISOString(),
        title: null,
        sourcePath: path,
      };
    } else if (p.type === "message" && p.role === "user") {
      const content = Array.isArray(p.content) ? p.content : [];
      const parts: string[] = [];
      for (const c of content) {
        if (typeof c?.text === "string") parts.push(c.text);
      }
      const joined = parts.join("\n").trim();
      if (joined && !isInjectedContext(joined)) {
        prompts.push({ sessionId: meta?.id ?? path, seq: seq++, text: joined, ts });
      }
    }
  }

  if (!meta) return null;
  if (lastTs) meta.endedAt = lastTs;
  const idx = index.get(meta.id);
  if (idx) {
    meta.title = idx.title;
    if (idx.updatedAt) meta.endedAt = idx.updatedAt;
  }
  return { session: meta, prompts };
}

/** Parse a single rollout file with a fresh (empty) index — for tests/tools. */
export async function parseCodexFile(path: string): Promise<ParsedSession | null> {
  return parseCodexRollout(path, new Map());
}

/** Codex CLI — reads rollout-*.jsonl session files under ~/.codex/sessions. */
export class CodexProvider extends JsonlSessionProvider {
  readonly name = "codex";
  private index: CodexIndex = new Map();

  protected rootDir(): string | null {
    return sessionsDir();
  }

  protected accept(path: string): boolean {
    // Codex names every session file rollout-*.jsonl.
    return path.endsWith(".jsonl") && path.includes("rollout-");
  }

  protected async prepare(): Promise<void> {
    this.index = await loadIndex();
  }

  protected parseFile(path: string): Promise<ParsedSession | null> {
    return parseCodexRollout(path, this.index);
  }
}

export const codexProvider = new CodexProvider();
