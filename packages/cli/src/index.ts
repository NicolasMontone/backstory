#!/usr/bin/env bun
import { parseArgs, type ParseArgsConfig } from "node:util";
import { Backstory } from "./api.ts";
import { resolveSha } from "./git.ts";
import type { SessionWithPrompts } from "./query.ts";

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
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function emit(json: boolean, data: unknown, render: () => void): void {
  if (json) console.log(JSON.stringify(data, null, 2));
  else render();
}

// ---- rendering ---------------------------------------------------------------
function renderSessions(sessions: SessionWithPrompts[], opts: { full?: boolean } = {}): void {
  if (sessions.length === 0) {
    console.log(dim("  (no prompts found)"));
    return;
  }
  for (const s of sessions) {
    const badge = s.source === "hook" ? green("● exact") : s.source === "correlated" ? yellow("~ correlated") : "";
    console.log(`\n${[bold(s.title || s.id), badge].filter(Boolean).join("  ")}`);
    console.log(
      dim(
        `  ${s.provider} · ${s.repo ?? "no-repo"}${s.branch ? ` · ${s.branch}` : ""} · ${fmtDate(s.startedAt)} · ${s.prompts.length} prompt(s)`,
      ),
    );
    const shown = opts.full ? s.prompts : s.prompts.slice(0, 3);
    for (const p of shown) {
      const oneLine = p.text.replace(/\s+/g, " ").trim();
      const t = opts.full ? p.text.trim() : oneLine.length > 160 ? oneLine.slice(0, 157) + "…" : oneLine;
      console.log(`  ${cyan("›")} ${t.replace(/\n/g, "\n    ")}`);
    }
    if (!opts.full && s.prompts.length > shown.length) {
      console.log(dim(`  … +${s.prompts.length - shown.length} more (use --full)`));
    }
  }
}

// ---- arg parsing -------------------------------------------------------------
const COMMON = {
  json: { type: "boolean" },
  full: { type: "boolean" },
  repo: { type: "string" },
  limit: { type: "string" },
  since: { type: "string" },
  author: { type: "string", multiple: true },
} satisfies ParseArgsConfig["options"];

function parse(args: string[]) {
  return parseArgs({ args, options: COMMON, allowPositionals: true, strict: false });
}

// ---- commands ----------------------------------------------------------------
async function cmdIngest(args: string[]): Promise<void> {
  const { values } = parse(args);
  using bs = Backstory.open();
  const summary = await bs.ingest({
    full: Boolean(values.full),
    since: values.since as string | undefined,
    authorEmails: values.author as string[] | undefined,
  });
  emit(Boolean(values.json), summary, () => {
    for (const p of summary.providers) {
      if (!p.available) console.log(dim(`- ${p.provider}: no data on this machine, skipping`));
      else console.log(`- ${p.provider}: ${green(`${p.sessions} sessions, ${p.prompts} prompts`)}`);
    }
    console.log(
      `- correlate: ${green(`${summary.correlate.linked} links`)} ${dim(`(${summary.correlate.commitsSeen} commits scanned)`)}`,
    );
    console.log(bold(`\nIndexed ${summary.totals.sessions} sessions / ${summary.totals.prompts} prompts.`));
  });
}

async function cmdCommit(args: string[]): Promise<void> {
  const { values, positionals } = parse(args);
  const rev = (positionals[0] as string) ?? "HEAD";
  const sha = (await resolveSha(process.cwd(), rev)) ?? rev;
  using bs = Backstory.open();
  const report = bs.commitReport(sha);
  emit(Boolean(values.json), report, () => {
    console.log(bold(`commit ${sha.slice(0, 12)}`) + (report.commit?.subject ? dim(`  ${report.commit.subject}`) : ""));
    if (report.commit?.authoredAt) console.log(dim(`  ${report.commit.author ?? ""} · ${fmtDate(report.commit.authoredAt)}`));
    renderSessions(report.sessions, { full: Boolean(values.full) });
  });
}

async function cmdBranch(args: string[]): Promise<void> {
  const { values, positionals } = parse(args);
  const branch = positionals[0] as string | undefined;
  if (!branch) return fail("usage: bs branch <name> [--repo owner/name] [--full] [--json]");
  using bs = Backstory.open();
  const report = bs.branchReport(branch, values.repo as string | undefined);
  emit(Boolean(values.json), report, () => {
    console.log(bold(`branch ${branch}`));
    renderSessions(report.sessions, { full: Boolean(values.full) });
  });
}

async function cmdPr(args: string[]): Promise<void> {
  const { values, positionals } = parse(args);
  const num = Number(positionals[0]);
  if (!num) return fail("usage: bs pr <number> [--repo owner/name] [--full] [--json]");
  using bs = Backstory.open();
  let report;
  try {
    report = await bs.prReport(num, { dir: process.cwd(), repo: values.repo as string | undefined });
  } catch (e) {
    return fail((e as Error).message);
  }
  if (!report) return fail(`could not fetch PR #${num}`);
  emit(Boolean(values.json), report, () => {
    console.log(bold(`PR #${report.pr.number} ${report.pr.title}`));
    console.log(dim(`  ${report.pr.repo} · ${report.pr.headRefName} → ${report.pr.baseRefName} · ${report.pr.url}`));
    renderSessions(report.sessions, { full: Boolean(values.full) });
  });
}

function cmdSessions(args: string[]): void {
  const { values } = parse(args);
  using bs = Backstory.open();
  const rows = bs.sessions({ limit: values.limit ? Number(values.limit) : undefined, repo: values.repo as string | undefined });
  emit(Boolean(values.json), rows, () => {
    for (const r of rows) {
      console.log(bold(r.title || r.id));
      console.log(
        dim(
          `  ${r.id}\n  ${r.provider} · ${r.repo ?? "no-repo"}${r.branch ? ` · ${r.branch}` : ""} · ${fmtDate(r.startedAt)} · ${r.promptCount} prompt(s)`,
        ),
      );
    }
    console.log(dim(`\n${rows.length} session(s)`));
  });
}

function cmdSession(args: string[]): void {
  const { values, positionals } = parse(args);
  const id = positionals[0] as string | undefined;
  if (!id) return fail("usage: bs session <id> [--json]");
  using bs = Backstory.open();
  const s = bs.session(id);
  if (!s) return fail(`no session ${id}`);
  emit(Boolean(values.json), s, () => renderSessions([s], { full: true }));
}

function cmdSearch(args: string[]): void {
  const { values, positionals } = parse(args);
  const term = (positionals as string[]).join(" ");
  if (!term) return fail("usage: bs search <text> [--limit N] [--json]");
  using bs = Backstory.open();
  const hits = bs.search(term, values.limit ? Number(values.limit) : undefined);
  emit(Boolean(values.json), hits, () => {
    for (const h of hits) {
      console.log(`${cyan("›")} ${h.text.replace(/\s+/g, " ").trim()}`);
      console.log(dim(`   ${h.title ?? h.sessionId} · ${h.repo ?? "no-repo"}`));
    }
    console.log(dim(`\n${hits.length} hit(s)`));
  });
}

function cmdStats(args: string[]): void {
  const { values } = parse(args);
  using bs = Backstory.open();
  const s = bs.stats();
  emit(Boolean(values.json), s, () => {
    console.log(bold("backstory index"));
    console.log(`  ${s.sessions} sessions · ${s.prompts} prompts · ${s.commits} commits`);
    console.log(`  links: ${green(`${s.linksExact} exact`)} + ${yellow(`${s.linksCorrelated} correlated`)} = ${s.links}`);
    console.log(bold("\n  by provider"));
    for (const p of s.byProvider) console.log(`    ${p.provider.padEnd(8)} ${p.sessions} sessions · ${p.prompts} prompts`);
    console.log(bold("\n  top repos"));
    for (const r of s.byRepo) console.log(`    ${String(r.sessions).padStart(4)}  ${r.repo}`);
  });
}

async function cmdHook(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "install") {
    using bs = Backstory.open();
    const { path, created } = await bs.installHook(process.cwd());
    console.log(`${green("✓")} post-commit hook ${created ? "installed" : "updated"} at ${dim(path)}`);
    console.log(dim("  New commits in this repo will be stamped with the active session (exact links)."));
    return;
  }
  if (sub === "record") {
    using bs = Backstory.open();
    await bs.ingest({ skipCorrelate: true }); // fast: index the active session, no git scan
    const res = await bs.recordHook(process.cwd());
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

${bold("usage:")} bs <command> [args]   ${dim("(add --json to any read command for machine output)")}

  ${cyan("ingest")} [--full] [--since ISO] [--author EMAIL]   Parse agent sessions → DB, correlate with git
  ${cyan("commit")} [rev] [--full]                            Prompts behind a commit (default HEAD)
  ${cyan("branch")} <name> [--repo] [--full]                  Prompts on a branch
  ${cyan("pr")} <number> [--repo] [--full]                    Prompts behind a GitHub PR (needs gh)
  ${cyan("sessions")} [--limit N] [--repo]                    List recent sessions
  ${cyan("session")} <id>                                     Full prompt list for one session
  ${cyan("search")} <text> [--limit N]                        Full-text search across prompts
  ${cyan("stats")}                                            Index totals, by provider & repo
  ${cyan("hook install")}                                     Install a git post-commit hook for exact links

  Run ${bold("bs ingest")} first (and after new agent work) to refresh the index.
  Links marked ${green("● exact")} come from the hook; ${yellow("~ correlated")} are inferred by repo+branch+time.`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "ingest": return cmdIngest(rest);
    case "commit": return cmdCommit(rest);
    case "branch": return cmdBranch(rest);
    case "pr": return cmdPr(rest);
    case "sessions": return cmdSessions(rest);
    case "session": return cmdSession(rest);
    case "search": return cmdSearch(rest);
    case "stats": return cmdStats(rest);
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
