import {
  settings,
  standard,
  createGo,
  applyGo,
  GO_VERSION,
} from "../../../src/games/go-engine.js";
import {
  chessSettings,
  createChess,
  applyChess,
  CHESS_VERSION,
} from "../../../src/games/chess-engine.js";
import {
  xiangqiSettings,
  createXiangqi,
  applyXiangqi,
  XIANGQI_VERSION,
} from "../../../src/games/xiangqi-engine.js";
import { timeoutVerdicts } from "../../../src/games/chess-adjudication.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "create",
  "join",
  "queue",
  "cancel",
  "ready",
  "command",
  "get",
  "heartbeat",
  "takeover",
  "leave",
]);
export function makeHandler(
  env: (name: string) => string | undefined,
  request = fetch,
) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("Origin") || "",
      allowed =
        !origin ||
        origin === "https://kensei-workshop.vercel.app" ||
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
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
    if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(authorization))
      return send({ error: "Sign in to play online board games." }, 401);
    const base = env("SUPABASE_URL"),
      key = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!base || !key)
      return send(
        { error: "Online board games are temporarily unavailable." },
        503,
      );
    try {
      const auth = await request(`${base}/auth/v1/user`, {
        headers: { Authorization: authorization, apikey: key },
      });
      if (!auth.ok)
        return send({ error: "Your session expired. Sign in again." }, 401);
      const user = await auth.json();
      if (!UUID.test(user.id || "") || user.is_anonymous)
        return send({ error: "A signed-in account is required." }, 401);
      const reader = req.body?.getReader();
      if (!reader) return send({ error: "Missing request body." }, 400);
      let length = 0,
        text = "";
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 16384) {
          await reader.cancel();
          return send({ error: "Board request exceeds 16 KB." }, 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      const body = JSON.parse(text + decoder.decode());
      const game = body.game ?? "go";
      if (game !== "go" && game !== "chess" && game !== "xiangqi")
        return send({ error: "Unknown board game." }, 400);
      const action = new URL(req.url).pathname
        .split("/")
        .filter(Boolean)
        .at(-1);
      if (
        !ACTIONS.has(action || "") ||
        !body ||
        !UUID.test(body.client_id || "")
      )
        return send({ error: "Invalid board request." }, 400);
      if (body.match_id && !UUID.test(body.match_id))
        return send({ error: "Invalid match identity." }, 400);
      async function admin(operation: string, payload: unknown) {
        const response = await request(`${base}/rest/v1/rpc/board_admin`, {
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
            result.message || "The online board could not be updated.",
          );
        return result;
      }
      // 永远从服务器快照推演；不接收客户端的棋盘、胜者、分数或时钟。
      if (action === "command") {
        if (
          !UUID.test(body.request_id || "") ||
          !Number.isSafeInteger(body.expected_version) ||
          body.expected_version < 1 ||
          !body.action ||
          typeof body.action.type !== "string"
        )
          return send({ error: "Invalid move request." }, 400);
        const payload = {
          game,
          client_id: body.client_id,
          match_id: body.match_id,
          request_id: body.request_id,
          expected_version: body.expected_version,
          action: body.action,
        };
        const snapshot = await admin("prepare", payload);
        if (snapshot.error) return send(snapshot, 409);
        if (snapshot.duplicate) return send(snapshot.snapshot);
        if (
          (snapshot.game || "go") !== game ||
          snapshot.rules_version !==
            (game === "xiangqi"
              ? XIANGQI_VERSION
              : game === "chess"
                ? CHESS_VERSION
                : GO_VERSION)
        )
          return send(
            {
              error: "Board rules changed. Refresh this page.",
              code: "RULES_UPDATE_REQUIRED",
            },
            409,
          );
        const next =
          game === "xiangqi"
            ? applyXiangqi(snapshot.state, body.action, snapshot.color)
            : game === "chess"
              ? applyChess(snapshot.state, body.action, snapshot.color)
              : applyGo(snapshot.state, body.action, snapshot.color);
        if (game === "chess")
          next.timeout =
            body.action.type === "move"
              ? timeoutVerdicts(next)
              : snapshot.state.timeout;
        const result = await admin("commit", { ...payload, state: next });
        return send(result, result.error ? 409 : 200);
      }
      const payload: Record<string, unknown> = {
        game,
        client_id: body.client_id,
        match_id: body.match_id,
      };
      if (action === "create" || action === "queue") {
        if (
          body.rules_version !==
          (game === "xiangqi"
            ? XIANGQI_VERSION
            : game === "chess"
              ? CHESS_VERSION
              : GO_VERSION)
        )
          return send(
            {
              error: "Board rules changed. Refresh this page.",
              code: "RULES_UPDATE_REQUIRED",
            },
            409,
          );
        const config =
          game === "xiangqi"
            ? xiangqiSettings(body.config)
            : game === "chess"
              ? chessSettings(body.config)
              : settings(body.config);
        if ((game === "chess" || game === "xiangqi") && config.clock === "none")
          return send({ error: "Choose a supported chess time control." }, 400);
        if (
          game === "go" &&
          action === "queue" &&
          (!standard(config) || config.clock !== config.size)
        )
          return send(
            {
              error:
                "Matchmaking requires standard settings and normal colors.",
            },
            400,
          );
        const initial =
          game === "xiangqi"
            ? createXiangqi(config)
            : game === "chess"
              ? createChess(config)
              : createGo(config);
        if (game === "chess") initial.timeout = timeoutVerdicts(initial);
        Object.assign(payload, {
          config,
          state: initial,
          ranked: game === "chess" || game === "xiangqi" || standard(config),
          preferred_color: [1, -1].includes(body.preferred_color)
            ? body.preferred_color
            : 0,
        });
      }
      if (action === "join") {
        if (
          !/^[A-Z0-9]{8}$/.test(
            String(body.code || "")
              .trim()
              .toUpperCase(),
          )
        )
          return send({ error: "Enter an eight-character room code." }, 400);
        payload.code = String(body.code).trim().toUpperCase();
      }
      if (action === "ready")
        payload.accept_training = body.accept_training === true;
      const result = await admin(action!, payload);
      return send(result, result.error ? 409 : 200);
    } catch (error) {
      return send(
        {
          error:
            error instanceof Error
              ? error.message
              : "Online Go could not complete this request.",
        },
        400,
      );
    }
  };
}
if (import.meta.main) Deno.serve(makeHandler((name) => Deno.env.get(name)));
