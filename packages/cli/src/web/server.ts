import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { Backstory } from "../api.ts";

/** Walk up from this file to the monorepo root (where pnpm-workspace.yaml lives). */
function findWorkspaceRoot(): string | null {
  let dir = import.meta.dir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function distDir(): string | null {
  const root = findWorkspaceRoot();
  if (!root) return null;
  const dist = join(root, "apps", "web", "dist");
  return existsSync(join(dist, "index.html")) ? dist : null;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Route /api/* to the typed Backstory facade. */
async function handleApi(bs: Backstory, url: URL): Promise<Response> {
  const p = url.pathname.replace(/^\/api\//, "");
  const seg = p.split("/").map(decodeURIComponent);
  const q = url.searchParams;

  try {
    if (p === "stats") return json(bs.stats());
    if (p === "timeline") return json(bs.activityTimeline(q.get("days") ? Number(q.get("days")) : undefined));
    if (p === "sessions")
      return json(bs.sessions({ limit: q.get("limit") ? Number(q.get("limit")) : 200, repo: q.get("repo") ?? undefined }));
    if (seg[0] === "session" && seg[1]) {
      if (seg[2] === "commits") return json(bs.sessionCommits(seg[1]));
      const s = bs.session(seg[1]);
      return s ? json(s) : json({ error: "not found" }, 404);
    }
    if (seg[0] === "commit" && seg[1]) return json(bs.commitReport(seg[1]));
    if (seg[0] === "branch" && seg[1]) return json(bs.branchReport(seg[1], q.get("repo") ?? undefined));
    if (p === "search") {
      const term = q.get("q") ?? "";
      return json(term ? bs.search(term, q.get("limit") ? Number(q.get("limit")) : undefined) : []);
    }
    if (seg[0] === "pr" && seg[1]) {
      const report = await bs.prReport(Number(seg[1]), { repo: q.get("repo") ?? undefined });
      return report ? json(report) : json({ error: "not found" }, 404);
    }
    return json({ error: "unknown endpoint" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

async function serveStatic(dist: string, pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(dist, rel));
  if (!filePath.startsWith(dist)) return new Response("forbidden", { status: 403 }); // path traversal guard
  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);
  return new Response(Bun.file(join(dist, "index.html"))); // SPA fallback
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* ignore */
  }
}

export function startWebServer(opts: { port?: number; open?: boolean } = {}): { url: string } {
  const port = opts.port ?? 4319;
  const dist = distDir();
  const bs = Backstory.open();

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/")) return handleApi(bs, url);
      if (!dist) {
        return new Response(
          "<h1>backstory web</h1><p>UI not built yet. Run:</p><pre>pnpm --filter @backstory/web build</pre><p>The API is live at <code>/api/stats</code>.</p>",
          { headers: { "content-type": "text/html" }, status: 200 },
        );
      }
      return serveStatic(dist, url.pathname);
    },
  });

  const url = `http://localhost:${port}`;
  if (opts.open !== false) openBrowser(url);
  return { url };
}
