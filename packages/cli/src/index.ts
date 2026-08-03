#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { openDb, lastIngestedAt, upsertSessions, replacePrompts } from "./db.ts";
import { codexProvider } from "./providers/codex.ts";
import type { Provider } from "./providers/types.ts";
import { correlate } from "./correlate.ts";
import { resolveSha } from "./git.ts";
import { fetchPr, ghReady } from "./github.ts";
import { installHook, recordHook } from "./hook.ts";
import {
  activeSession,
  commitInfo,
  listSessions,
  searchPrompts,
  sessionsForBranch,
  sessionsForCommit,
  sessionsForShas,
  type SessionWithPrompts,
} from "./query.ts";

const PROVIDERS: Provider[] = [codexProvider];

// ---- tiny ANSI helpers -------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c("1", s);
const dim = (s: string) => c("2", s);
const cyan = (s: string) => c("36", s);
const green = (s: string) => c("32", s);
const yellow = (s: string) => c("33", s);

function fmtDate(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Render everything in the machine's local time so commit and session
  // timestamps (stored in different source timezones) line up visually.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---- rendering ---------------------------------------------------------------
function renderSessions(sessions: SessionWithPrompts[], opts: { full?: boolean } = {}): void {
  if (sessions.length === 0) {
    console.log(dim("  (no prompts found)"));
    return;
  }
  for (const s of sessions) {
    const badge = s.source === "hook" ? green("● exact") : s.source === "correlated" ? yellow("~ correlated") : "";
    const head = [bold(s.title || s.id), badge].filter(Boolean).join("  ");
    console.log(`\n${head}`);
    console.log(
      dim(
        `  ${s.provider} · ${s.repo ?? "no-repo"}${s.branch ? ` · ${s.branch}` : ""} · ${fmtDate(s.startedAt)} · ${s.prompts.length} prompt(s)`,
      ),
    );
    const shown = opts.full ? s.prompts : s.prompts.slice(0, 3);
    for (const p of shown) {
      const oneLine = p.text.replace(/\s+/g, " ").trim();
      const text = opts.full ? p.text.trim() : oneLine.length > 160 ? oneLine.slice(0, 157) + "…" : oneLine;
      console.log(`  ${cyan("›")} ${text.replace(/\n/g, "\n    ")}`);
    }
    if (!opts.full && s.prompts.length > shown.length) {
      console.log(dim(`  … +${s.prompts.length - shown.length} more (use --full)`));
    }
  }
}

// ---- commands ----------------------------------------------------------------
async function cmdIngest(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { full: { type: "boolean" }, since: { type: "string" } }, allowPositionals: true });
  const db = openDb();
  const since = values.since ?? (values.full ? undefined : lastIngestedAt(db) ?? undefined);
  let totalS = 0;
  let totalP = 0;
  for (const provider of PROVIDERS) {
    if (!provider.isAvailable()) {
      console.log(dim(`- ${provider.name}: no data on this machine, skipping`));
      continue;
    }
    process.stdout.write(`- ${provider.name}: scanning… `);
    const { sessions, prompts } = await provider.ingest({ since });
    upsertSessions(db, sessions);
    replacePrompts(db, prompts);
    totalS += sessions.length;
    totalP += prompts.length;
    console.log(green(`${sessions.length} sessions, ${prompts.length} prompts`));
  }
  process.stdout.write(`- correlating with git… `);
  const { linked, commitsSeen } = await correlate(db);
  console.log(green(`${linked} commit↔session links (${commitsSeen} commits scanned)`));
  console.log(bold(`\nIngested ${totalS} sessions / ${totalP} prompts.`));
}

async function cmdCommit(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, options: { full: { type: "boolean" } }, allowPositionals: true });
  const rev = positionals[0] ?? "HEAD";
  const db = openDb();
  const sha = (await resolveSha(process.cwd(), rev)) ?? rev;
  const info = commitInfo(db, sha);
  console.log(bold(`commit ${sha.slice(0, 12)}`) + (info?.subject ? dim(`  ${info.subject}`) : ""));
  if (info?.authoredAt) console.log(dim(`  ${info.author ?? ""} · ${fmtDate(info.authoredAt)}`));
  renderSessions(sessionsForCommit(db, sha), { full: values.full });
}

async function cmdBranch(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { full: { type: "boolean" }, repo: { type: "string" } },
    allowPositionals: true,
  });
  const branch = positionals[0];
  if (!branch) return fail("usage: bs branch <name> [--repo owner/name] [--full]");
  const db = openDb();
  console.log(bold(`branch ${branch}`));
  renderSessions(sessionsForBranch(db, branch, values.repo), { full: values.full });
}

async function cmdPr(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { full: { type: "boolean" }, repo: { type: "string" } },
    allowPositionals: true,
  });
  const num = Number(positionals[0]);
  if (!num) return fail("usage: bs pr <number> [--repo owner/name] [--full]");
  if (!(await ghReady())) return fail("gh CLI not available/authenticated. Run `gh auth login`.");
  const pr = await fetchPr(num, { dir: process.cwd(), repo: values.repo });
  if (!pr) return fail(`could not fetch PR #${num}`);
  const db = openDb();
  console.log(bold(`PR #${pr.number} ${pr.title}`));
  console.log(dim(`  ${pr.repo} · ${pr.headRefName} → ${pr.baseRefName} · ${pr.url}`));

  // Union of two signals: commit-level links + branch-level session match.
  const byCommit = sessionsForShas(db, pr.commits);
  const byBranch = sessionsForBranch(db, pr.headRefName, pr.repo);
  const merged = new Map<string, SessionWithPrompts>();
  for (const s of [...byCommit, ...byBranch]) merged.set(s.id, merged.get(s.id) ?? s);
  renderSessions([...merged.values()], { full: values.full });
}

function cmdSessions(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: { limit: { type: "string" }, repo: { type: "string" } },
    allowPositionals: true,
  });
  const db = openDb();
  const rows = listSessions(db, { limit: values.limit ? Number(values.limit) : undefined, repo: values.repo });
  for (const r of rows) {
    console.log(
      `${bold((r.title || r.id).padEnd(0))}\n  ${dim(`${r.provider} · ${r.repo ?? "no-repo"}${r.branch ? ` · ${r.branch}` : ""} · ${fmtDate(r.startedAt)} · ${r.promptCount} prompt(s)`)}`,
    );
  }
  console.log(dim(`\n${rows.length} session(s)`));
}

function cmdSearch(args: string[]): void {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const term = positionals.join(" ");
  if (!term) return fail("usage: bs search <text>");
  const db = openDb();
  const hits = searchPrompts(db, term);
  for (const h of hits) {
    console.log(`${cyan("›")} ${h.text.replace(/\s+/g, " ").trim()}`);
    console.log(dim(`   ${h.title ?? h.sessionId} · ${h.repo ?? "no-repo"}`));
  }
  console.log(dim(`\n${hits.length} hit(s)`));
}

async function cmdHook(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "install") {
    const { path, created } = await installHook(process.cwd());
    console.log(`${green("✓")} post-commit hook ${created ? "installed" : "updated"} at ${dim(path)}`);
    console.log(dim("  New commits in this repo will be stamped with the active session (exact links)."));
    return;
  }
  if (sub === "record") {
    // Invoked by the git hook. Refresh the current session into the DB first so
    // an exact link can be made even before the next full ingest.
    const db = openDb();
    for (const provider of PROVIDERS) {
      if (!provider.isAvailable()) continue;
      const { sessions, prompts } = await provider.ingest({ since: lastIngestedAt(db) ?? undefined });
      upsertSessions(db, sessions);
      replacePrompts(db, prompts);
    }
    const res = await recordHook(db, process.cwd(), (root, withinMs) => activeSession(db, root, withinMs));
    if (res) console.log(dim(`backstory: linked ${res.sha.slice(0, 8)} → ${res.sessionId}`));
    return;
  }
  fail("usage: bs hook <install|record>");
}

function fail(msg: string): void {
  console.error(msg);
  process.exitCode = 1;
}

function usage(): void {
  console.log(`${bold("backstory")} — link your AI-agent prompts to the commits & PRs they produced

${bold("usage:")} bs <command> [args]

  ${cyan("ingest")} [--full] [--since ISO]   Parse agent sessions → DB, correlate with git
  ${cyan("commit")} [rev] [--full]           Prompts behind a commit (default HEAD)
  ${cyan("branch")} <name> [--repo] [--full] Prompts on a branch
  ${cyan("pr")} <number> [--repo] [--full]   Prompts behind a GitHub PR (needs gh)
  ${cyan("sessions")} [--limit N] [--repo]   List recent sessions
  ${cyan("search")} <text>                   Full-text search across prompts
  ${cyan("hook install")}                     Install a git post-commit hook for exact links

  Run ${bold("bs ingest")} first (and after new agent work) to refresh the index.
  ${dim("Links marked")} ${green("● exact")} ${dim("come from the hook;")} ${yellow("~ correlated")} ${dim("are inferred by repo+branch+time.")}`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "ingest": return cmdIngest(rest);
    case "commit": return cmdCommit(rest);
    case "branch": return cmdBranch(rest);
    case "pr": return cmdPr(rest);
    case "sessions": return cmdSessions(rest);
    case "search": return cmdSearch(rest);
    case "hook": return cmdHook(rest);
    case undefined:
    case "help":
    case "-h":
    case "--help": return usage();
    default:
      fail(`unknown command: ${cmd}`);
      usage();
  }
}

main();
