import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// 只生成无凭证的临时构建；部署、随机口令替换及恢复正常函数由操作者完成。
const root = fileURLToPath(new URL("../", import.meta.url));
const entry = String.raw`
import { makeHandler } from "./supabase/functions/games-session/index.ts";
import { replay } from "./src/games/engine.js";
import { create, apply, advanceBrick, BRICK, paddleWidth } from "./src/games/brick-v2-engine.js";

const normal = makeHandler((key) => Deno.env.get(key));
const token = "__BENCH_TOKEN__";
const round = (n) => Math.round(n * 1000) / 1000;

export function runBoundedReplayCheck() {
  const started = performance.now(), seed = 12345;
  const s = create("brick-breaker", "classic", seed), events = [];
  let iterations = 0;
  while (s.status === "playing") {
    if (++iterations > BRICK.maxTicks) throw Error("Replay generation exceeded its fixed tick bound.");
    if (s.ticks % 600 === 0 && performance.now() - started > 900)
      throw Error("Replay generation exceeded the temporary benchmark time budget.");
    if (s.ticks % 2 === 0) {
      const ball = s.balls.filter(b=>b.launched).sort((a,b)=>(b.vy>0?b.y:-1)-(a.vy>0?a.y:-1))[0] || s.balls[0];
      const width = paddleWidth(s);
      const x = Math.max(0, Math.min(1024, Math.round((ball.x / BRICK.scale - width/2) / (640-width) * 1024)));
      if (x !== s.paddle && apply(s, { type: "paddle", tick: s.ticks, x })) events.push([s.ticks, x]);
    }
    if (!s.balls.some(b=>b.launched) && apply(s, { type: "launch", tick: s.ticks })) events.push([s.ticks, -1]);
    advanceBrick(s, s.ticks + 1);
  }
  const generatedAt = performance.now();
  if (s.status !== "won" || s.stage !== 2 || s.score !== 980 || events.length > 9003)
    throw Error("Canonical three-stage replay fixture did not complete as expected.");
  const result = replay("brick-breaker", "classic", seed, events, s.ticks, s.ticks * 1000 / 60, "paddle-v2", 2);
  const replayedAt = performance.now();
  if (!result.won || result.score !== s.score || result.moves !== s.moves)
    throw Error("Canonical replay result differs from the generated game.");
  const bytes = new TextEncoder().encode(JSON.stringify({
    session_id: "00000000-0000-4000-8000-000000000000",
    events_format: "paddle-v2", events, final_tick: s.ticks,
  })).byteLength;
  if (bytes > 524288) throw Error("Canonical replay exceeded the request size limit.");
  // 最大候选砖块始终保留；此项测试固定步长上界，不将构造状态当作公开成绩。
  let worst_ms = null, worst_ticks = 0, worst_skipped = null;
  if (replayedAt - started < 1000) {
    const worst = create("brick-breaker", "classic", seed);
    worst.balls = [260,300,340].map(y => ({ id: worst.nextBallId++, x: 320 * BRICK.scale, y: y * BRICK.scale, vx: 5 * BRICK.scale, vy: 0, launched: true }));
    const worstStarted = performance.now();
    while (worst.ticks < BRICK.maxTicks) {
      if (performance.now() - started > 1500) {
        worst_skipped = "Remaining fixed steps skipped to respect the temporary request budget.";
        break;
      }
      advanceBrick(worst, Math.min(BRICK.maxTicks, worst.ticks + 600));
    }
    worst_ms = round(performance.now() - worstStarted);
    worst_ticks = worst.ticks;
  } else worst_skipped = "Optional fixed-step benchmark skipped to respect the temporary request budget.";
  return {
    version: 2, game: "brick-breaker", score: result.score, won: result.won,
    ticks: s.ticks, events: events.length, bytes,
    generate_ms: round(generatedAt - started), replay_ms: round(replayedAt - generatedAt),
    worst_ms, worst_ticks, worst_balls: 3, ...(worst_skipped ? { worst_skipped } : {}),
    total_ms: round(performance.now() - started),
  };
}

if (typeof Deno !== "undefined") Deno.serve(async (req) => {
  // 未替换的短占位符永远不能打开基准路径。生产 JWT 校验仍由网关负责。
  if (token.length >= 32 && req.method === "POST" &&
      new URL(req.url).pathname.endsWith("/__bounded_replay_check") &&
      req.headers.get("x-replay-check") === token) {
    try { return Response.json(runBoundedReplayCheck(), { headers: { "Cache-Control": "no-store" } }); }
    catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Bounded replay benchmark failed." },
        { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  }
  return normal(req);
});
`;

await build({
  absWorkingDir: root,
  stdin: {
    contents: entry,
    resolveDir: root,
    sourcefile: "temporary-games-benchmark.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: path.join(root, "_qa/games-session/benchmark.ts"),
  plugins: [
    {
      name: "disable-only-original-games-listener",
      setup(bundler) {
        bundler.onLoad(
          { filter: /supabase[\\/]functions[\\/]games-session[\\/]index\.ts$/ },
          async ({ path: filename }) => {
            const contents = await readFile(filename, "utf8");
            const bootstrap =
              /\nif \(typeof Deno !== "undefined"\)\s*\n\s*Deno\.serve\(makeHandler\(\(key\) => Deno\.env\.get\(key\)\)\);\s*$/;
            if (!bootstrap.test(contents))
              throw Error(
                "The canonical games listener changed; review the benchmark adapter before building.",
              );
            return {
              contents: contents.replace(bootstrap, "\n"),
              loader: "ts",
            };
          },
        );
      },
    },
  ],
});
console.log(
  "Built ignored _qa/games-session/benchmark.ts. No credentials read and no deployment performed.",
);
console.log(
  "For a temporary authenticated check only: replace the token placeholder in memory, retain verify_jwt:true, then immediately restore the normal build.",
);
