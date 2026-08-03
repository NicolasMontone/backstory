import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { normalizeRepo, remoteUrl } from "../git.ts";
import { JsonlSessionProvider } from "./base.ts";
import type { ParsedSession, PromptRecord, SessionRecord } from "./types.ts";

// Read lazily so tests (and CLAUDE_CONFIG_DIR overrides) take effect at call time.
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const projectsDir = () => join(claudeHome(), "projects");

/** Prompt sources that represent something the human actually entered. */
const HUMAN_SOURCES = new Set(["typed", "queued"]);

/** Extract prompt text from a Claude `user` message's content (string or list). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (c && typeof c === "object" && (c as any).type === "text" && typeof (c as any).text === "string") {
      parts.push((c as any).text);
    }
  }
  return parts.join("\n");
}

/** Non-prompt text that can still carry promptSource=typed (interrupts, commands). */
function isNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith("[Request interrupted")) return true;
  if (t.startsWith("<")) return true; // <command-message>, <local-command-stdout>, ...
  return false;
}

/** Strip leading "[Image #N]" markers that Claude prepends to pasted-image prompts. */
function cleanText(text: string): string {
  return text.replace(/^(\s*\[Image #\d+\]\s*)+/i, "").trim();
}

export interface ParsedClaudeSession {
  session: Omit<SessionRecord, "repo" | "repositoryUrl">;
  prompts: PromptRecord[];
}

/** Parse one Claude Code session JSONL into a session + human prompts. */
export async function parseClaudeFile(path: string): Promise<ParsedClaudeSession | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }

  let sessionId = basename(path).replace(/\.jsonl$/, "");
  let cwd = "";
  let branch: string | null = null;
  let title: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  const prompts: PromptRecord[] = [];
  let seq = 0;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }

    if (o.sessionId) sessionId = o.sessionId;
    if (o.cwd) cwd = o.cwd;
    if (o.gitBranch) branch = o.gitBranch;
    if (o.aiTitle) title = o.aiTitle;
    const ts: string | null = o.timestamp ?? null;
    if (ts) {
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (!endedAt || ts > endedAt) endedAt = ts;
    }

    if (o.type !== "user" || o.isSidechain || o.isMeta) continue;
    if (!HUMAN_SOURCES.has(o.promptSource)) continue;
    const raw = extractText(o.message?.content);
    if (isNoise(raw)) continue;
    const clean = cleanText(raw);
    if (!clean) continue;
    prompts.push({ sessionId, seq: seq++, text: clean, ts });
  }

  if (!cwd && prompts.length === 0) return null;
  const now = new Date().toISOString();
  return {
    session: {
      id: sessionId,
      provider: "claude",
      cwd,
      branch,
      startCommit: null, // Claude Code doesn't record HEAD in the log
      startedAt: startedAt ?? now,
      endedAt: endedAt ?? now,
      title,
      sourcePath: path,
    },
    prompts: prompts.map((p) => ({ ...p, sessionId })),
  };
}

/** Claude Code — sessions at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`. */
export class ClaudeProvider extends JsonlSessionProvider {
  readonly name = "claude";
  // Claude Code doesn't store the repo URL, so we resolve it from the cwd's
  // git remote. Cache per cwd across files within one ingest.
  private remoteCache = new Map<string, string | null>();

  protected rootDir(): string | null {
    return projectsDir();
  }

  protected async prepare(): Promise<void> {
    this.remoteCache.clear();
  }

  protected async parseFile(path: string): Promise<ParsedSession | null> {
    const parsed = await parseClaudeFile(path);
    if (!parsed) return null;
    const cwd = parsed.session.cwd;
    let repositoryUrl: string | null = null;
    if (cwd) {
      if (!this.remoteCache.has(cwd)) this.remoteCache.set(cwd, await remoteUrl(cwd));
      repositoryUrl = this.remoteCache.get(cwd)!;
    }
    return {
      session: { ...parsed.session, repositoryUrl, repo: normalizeRepo(repositoryUrl) },
      prompts: parsed.prompts,
    };
  }
}

export const claudeProvider = new ClaudeProvider();
