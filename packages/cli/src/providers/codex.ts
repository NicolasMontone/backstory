import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeRepo } from "../git.ts";
import type { IngestResult, PromptRecord, Provider, SessionRecord } from "./types.ts";

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const SESSIONS_DIR = join(CODEX_HOME, "sessions");
const INDEX_FILE = join(CODEX_HOME, "session_index.jsonl");

/**
 * Injected, non-user text that Codex prepends to the conversation as
 * `role: "user"` messages. These are AGENTS.md contents, app context, and
 * environment blocks — not prompts the human typed. We drop them.
 */
function isInjectedContext(text: string): boolean {
  const t = text.trimStart();
  if (t.startsWith("<")) return true; // <app-context>, <user_instructions>, <environment_context>, ...
  if (t.startsWith("# AGENTS.md")) return true;
  if (t.startsWith("# Codex")) return true;
  return false;
}

/** Load session_index.jsonl into id -> {title, updatedAt}. Best-effort. */
async function loadIndex(): Promise<Map<string, { title: string | null; updatedAt: string | null }>> {
  const map = new Map<string, { title: string | null; updatedAt: string | null }>();
  if (!existsSync(INDEX_FILE)) return map;
  try {
    const text = await readFile(INDEX_FILE, "utf8");
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

/** Recursively collect all rollout-*.jsonl paths under the sessions dir. */
async function findSessionFiles(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await findSessionFiles(p, out);
    else if (e.isFile() && e.name.endsWith(".jsonl") && e.name.startsWith("rollout-")) out.push(p);
  }
  return out;
}

interface ParsedSession {
  session: SessionRecord;
  prompts: PromptRecord[];
}

/** Parse one rollout JSONL file into a session + its prompts. */
async function parseFile(
  path: string,
  index: Map<string, { title: string | null; updatedAt: string | null }>,
): Promise<ParsedSession | null> {
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

export const codexProvider: Provider = {
  name: "codex",

  isAvailable(): boolean {
    return existsSync(SESSIONS_DIR);
  },

  async ingest({ since }): Promise<IngestResult> {
    const index = await loadIndex();
    const files = await findSessionFiles(SESSIONS_DIR);
    const sessions: SessionRecord[] = [];
    const prompts: PromptRecord[] = [];

    for (const file of files) {
      if (since) {
        // Cheap skip using file mtime before reading contents.
        try {
          const st = await stat(file);
          if (st.mtime.toISOString() < since) continue;
        } catch {
          /* fall through and parse */
        }
      }
      const parsed = await parseFile(file, index);
      if (!parsed) continue;
      sessions.push(parsed.session);
      prompts.push(...parsed.prompts);
    }

    return { sessions, prompts };
  },
};
