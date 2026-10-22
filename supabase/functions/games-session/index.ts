import { VERSION, rules, replay } from "../../../src/games/engine.js";

const ORIGINS = new Set(["https://kensei-workshop.vercel.app"]);
const MAX_BYTES = 524288;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function makeHandler(
  env: (key: string) => string | undefined,
  request = fetch,
) {
  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin") || "";
    const allowed =
      !origin ||
      ORIGINS.has(origin) ||
      /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": allowed
        ? origin || "https://kensei-workshop.vercel.app"
        : "null",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    };
    const send = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });
    if (!allowed) return send({ error: "Origin not allowed." }, 403);
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return send({ error: "Use POST." }, 405);
    const authorization = req.headers.get("Authorization") || "";
    if (
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        authorization,
      )
    )
      return send({ error: "Sign in to use Public games." }, 401);
    try {
      const base = env("SUPABASE_URL"),
        key = env("SUPABASE_SERVICE_ROLE_KEY");
      if (!base || !key)
        return send(
          { error: "Public games are temporarily unavailable." },
          503,
        );
      const userResponse = await request(`${base}/auth/v1/user`, {
        headers: { Authorization: authorization, apikey: key },
      });
      if (!userResponse.ok)
        return send({ error: "Your session expired. Sign in again." }, 401);
      const user = await userResponse.json();
      if (!UUID.test(user.id || "") || user.is_anonymous)
        return send({ error: "A signed-in account is required." }, 401);
      if (Number(req.headers.get("Content-Length")) > MAX_BYTES)
        return send({ error: "Replay exceeds 512 KB." }, 413);
      const reader = req.body?.getReader();
      let count = 0,
        text = "";
      const decoder = new TextDecoder();
      if (!reader) return send({ error: "Missing request body." }, 400);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        count += value.byteLength;
        if (count > MAX_BYTES) {
          await reader.cancel();
          return send({ error: "Replay exceeds 512 KB." }, 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      const body = JSON.parse(text);
      const action = new URL(req.url).pathname
        .split("/")
        .filter(Boolean)
        .at(-1);
      async function admin(operation: string, payload: unknown) {
        const response = await request(`${base}/rest/v1/rpc/games_admin`, {
          method: "POST",
          headers: {
            apikey: key!,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: operation,
            owner: user.id,
            body: payload,
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw Error(
            result.message || "Public session could not be verified.",
          );
        return result;
      }
      if (action === "start") {
        rules(body.game, body.difficulty);
        const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
        return send(
          await admin("start", {
            game: body.game,
            difficulty: body.difficulty,
            seed,
          }),
        );
      }
      if (!UUID.test(body.session_id || ""))
        return send({ error: "Invalid game session." }, 400);
      if (action === "abandon")
        return send(await admin("abandon", { session_id: body.session_id }));
      if (action !== "finish")
        return send({ error: "Unknown game action." }, 404);
      const session = await admin("read", { session_id: body.session_id });
      if (session.status === "completed") return send(session.result);
      if (session.version !== VERSION)
        throw Error("This game uses unsupported rules. Continue privately.");
      const duration = Date.now() - Date.parse(session.started_at);
      const result = replay(
        session.game,
        session.difficulty,
        Number(session.seed),
        body.events,
        body.final_tick,
        duration,
      );
      const finished = await admin("finish", {
        session_id: session.id,
        metrics: result,
      });
      return send(finished.result);
    } catch (error) {
      return send(
        {
          error:
            error instanceof Error
              ? error.message.slice(0, 200)
              : "This Public result could not be verified.",
        },
        400,
      );
    }
  };
}
if (typeof Deno !== "undefined")
  Deno.serve(makeHandler((key) => Deno.env.get(key)));
