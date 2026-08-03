import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IngestResult, ParsedSession, Provider } from "./types.ts";

/** Recursively collect files under `dir` matching `accept`. Fails soft. */
export async function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, accept, out);
    else if (e.isFile() && accept(p)) out.push(p);
  }
  return out;
}

/** True if the file's mtime is older than the ISO cutoff (best-effort). */
export async function olderThan(path: string, sinceIso: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.mtime.toISOString() < sinceIso;
  } catch {
    return false; // if we can't tell, don't skip it
  }
}

/**
 * Base for agents that store one session per JSONL file under a root directory.
 * A concrete provider only has to say **where** its files live and **how** to
 * turn one file into a {@link ParsedSession}. Everything else — availability,
 * directory walking, incremental `since` skipping — lives here.
 */
export abstract class JsonlSessionProvider implements Provider {
  abstract readonly name: string;

  /** Root directory to scan, or null if this agent isn't installed here. */
  protected abstract rootDir(): string | null;

  /** Which files under the root are session logs. Override to narrow. */
  protected accept(path: string): boolean {
    return path.endsWith(".jsonl");
  }

  /** Optional setup run once per ingest (e.g. load an index/cache). */
  protected async prepare(): Promise<void> {}

  /** Parse a single session file into normalized records. */
  protected abstract parseFile(path: string): Promise<ParsedSession | null>;

  isAvailable(): boolean {
    const root = this.rootDir();
    return !!root && existsSync(root);
  }

  async ingest({ since }: { since?: string }): Promise<IngestResult> {
    const root = this.rootDir();
    const result: IngestResult = { sessions: [], prompts: [] };
    if (!root || !existsSync(root)) return result;

    await this.prepare();
    const files = await walk(root, (p) => this.accept(p));
    for (const file of files) {
      // Cheap mtime skip before reading, then a precise endedAt check after.
      if (since && (await olderThan(file, since))) continue;
      const parsed = await this.parseFile(file);
      if (!parsed) continue;
      if (since && parsed.session.endedAt < since) continue;
      result.sessions.push(parsed.session);
      result.prompts.push(...parsed.prompts);
    }
    return result;
  }
}
