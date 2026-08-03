import { $ } from "bun";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Make a throwaway temp directory (caller removes it, or use withTmp). */
export function tmp(prefix = "bs-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function rm(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Write a file, creating parent dirs. */
export function write(path: string, content: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** Serialize objects as a JSONL string. */
export function jsonl(...lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

/** A git repo in a temp dir with commit signing disabled and a fixed identity. */
export async function makeRepo(opts: { email?: string; name?: string; remote?: string } = {}): Promise<string> {
  const dir = tmp("bs-repo-");
  const email = opts.email ?? "me@example.com";
  const name = opts.name ?? "Me";
  await $`git -C ${dir} init -q`.quiet();
  await $`git -C ${dir} config user.email ${email}`.quiet();
  await $`git -C ${dir} config user.name ${name}`.quiet();
  await $`git -C ${dir} config commit.gpgsign false`.quiet();
  await $`git -C ${dir} checkout -q -b main`.quiet().nothrow();
  if (opts.remote) await $`git -C ${dir} remote add origin ${opts.remote}`.quiet();
  return dir;
}

/** Commit a file with a specific author name/email and ISO date. */
export async function commit(
  dir: string,
  opts: { file?: string; msg?: string; date: string; email: string; name: string },
): Promise<string> {
  const file = opts.file ?? `f-${Math.random().toString(36).slice(2)}.txt`;
  write(join(dir, file), Math.random().toString());
  await $`git -C ${dir} add -A`.quiet();
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: opts.date,
    GIT_COMMITTER_DATE: opts.date,
    GIT_AUTHOR_NAME: opts.name,
    GIT_AUTHOR_EMAIL: opts.email,
    GIT_COMMITTER_NAME: opts.name,
    GIT_COMMITTER_EMAIL: opts.email,
  };
  await $`git -C ${dir} -c commit.gpgsign=false commit -q -m ${opts.msg ?? file}`.env(env).quiet();
  const sha = (await $`git -C ${dir} rev-parse HEAD`.quiet().text()).trim();
  return sha;
}
