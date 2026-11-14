import featured from "../data/home-featured.json" with { type: "json" };
import tools from "../data/tools.json" with { type: "json" };
import games from "../data/games.json" with { type: "json" };

const catalog = {
  tools: tools.map(([slug]) => slug),
  games: games.map(({ slug }) => slug),
};
const snapshotFallback = () =>
  Object.fromEntries(
    Object.entries(featured).map(([kind, slugs]) => [
      kind,
      { source: "featured", slugs },
    ]),
  );

function rank(kind, rows) {
  const counts = new Map(catalog[kind].map((slug) => [slug, 0]));
  for (const row of rows) {
    const path = row?.requestPath?.match?.(
      /^\/(?:zh-hant\/)?(tools|games)\/([a-z0-9-]+)\/?$/,
    );
    if (!path || path[1] !== kind || !counts.has(path[2])) continue;
    if (!Number.isSafeInteger(row.pageviews) || row.pageviews < 0)
      throw new Error("Unexpected Analytics pageview count");
    counts.set(path[2], counts.get(path[2]) + row.pageviews);
  }
  const slugs = [...counts]
    .filter(([, count]) => count > 0)
    .sort((first, second) => second[1] - first[1])
    .slice(0, 4)
    .map(([slug]) => slug);
  return slugs.length === 4
    ? { source: "analytics", slugs }
    : { source: "featured", slugs: featured[kind] };
}

async function readPageviews(token, now, paths) {
  const url = new URL(
    "https://api.vercel.com/v1/query/web-analytics/visits/aggregate",
  );
  url.search = new URLSearchParams({
    projectId:
      process.env.WORKSHOP_ANALYTICS_PROJECT_ID ||
      "prj_4nYjDaso33gJZHDN1pP6YtY9RwRK",
    teamId:
      process.env.WORKSHOP_ANALYTICS_TEAM_ID || "team_u87Cl4TxP9ZF8oIt2YcXLU1H",
    by: "requestPath",
    since: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
    until: new Date(now).toISOString(),
    limit: String(paths.length + 1),
    filter: paths.map((path) => "requestPath eq '" + path + "'").join(" or "),
  }).toString();
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(3200),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Analytics HTTP " + response.status);
  const payload = await response.json();
  if (!Array.isArray(payload?.data))
    throw new Error("Unexpected Analytics aggregate");
  return payload.data;
}

async function loadSnapshot(token, now) {
  let checked = false;
  let incomplete = false;
  const entries = await Promise.all(
    Object.entries(catalog).map(async ([kind, slugs]) => {
      try {
        // Keep each encoded URL short and each response below the API row cap.
        const paths = ["", "/zh-hant"].flatMap((locale) =>
          slugs.flatMap((slug) => {
            const path = locale + "/" + kind + "/" + slug;
            return [path, path + "/"];
          }),
        );
        const requests = [];
        for (let i = 0; i < paths.length; i += 24)
          requests.push(readPageviews(token, now, paths.slice(i, i + 24)));
        const rows = (await Promise.all(requests)).flat();
        const result = rank(kind, rows);
        checked = true;
        return [kind, result];
      } catch (error) {
        incomplete = true;
        console.warn("Home popularity feed unavailable:", kind, error.message);
        return [kind, { source: "featured", slugs: featured[kind] }];
      }
    }),
  );
  return {
    snapshot: {
      updatedAt: checked ? new Date(now).toISOString() : null,
      ...Object.fromEntries(entries),
    },
    lifetime: incomplete ? 300 : 86400,
  };
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    if (new URL(request.url).search)
      return new Response(null, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    const now = Date.now();
    const token = process.env.WORKSHOP_ANALYTICS_TOKEN?.trim();
    let snapshot = { updatedAt: null, ...snapshotFallback() };
    let lifetime = 300;
    if (token) ({ snapshot, lifetime } = await loadSnapshot(token, now));
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Vercel-CDN-Cache-Control":
        "public, s-maxage=" +
        lifetime +
        ", stale-while-revalidate=" +
        (lifetime === 86400 ? 3600 : 60),
    };
    return new Response(
      request.method === "HEAD" ? null : JSON.stringify(snapshot),
      { headers },
    );
  },
};
