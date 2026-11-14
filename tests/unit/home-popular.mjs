import { strict as assert } from "node:assert";
import { test } from "node:test";
import handler from "../../api/home-popular.mjs";
import featured from "../../data/home-featured.json" with { type: "json" };

const url = "https://kensei-workshop.vercel.app/api/home-popular";

test("home popularity merges languages and keeps the catalog tie order", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-14T00:00:00Z"));
  t.mock.method(console, "warn", () => {});
  const rows = [
    { requestPath: "/tools/image-studio/", pageviews: 1 },
    { requestPath: "/zh-hant/tools/image-studio/", pageviews: 8 },
    { requestPath: "/tools/pdf-toolkit", pageviews: 6 },
    { requestPath: "/tools/qr-studio/", pageviews: 6 },
    { requestPath: "/tools/network-test/", pageviews: 3 },
    { requestPath: "/tools/whiteboard/", pageviews: 2 },
    { requestPath: "/games/go/", pageviews: 3 },
    { requestPath: "/games/snake/", pageviews: 3 },
    { requestPath: "/zh-hant/games/snake/", pageviews: 3 },
    { requestPath: "/games/leaderboards/", pageviews: 200 },
  ];
  const fetch = t.mock.method(globalThis, "fetch", async (query, options) => {
    const p = query.searchParams;
    assert.equal(query.hostname, "api.vercel.com");
    assert.equal(p.get("by"), "requestPath");
    assert.equal(p.get("since"), "2026-10-15T00:00:00.000Z");
    assert.equal(p.get("until"), "2026-11-14T00:00:00.000Z");
    assert(Number(p.get("limit")) <= 100);
    assert.equal(options.headers.Authorization, "Bearer fixture-only");
    const paths = p.get("filter");
    return Response.json({
      data: rows.filter(({ requestPath }) =>
        paths.includes("'" + requestPath + "'"),
      ),
    });
  });
  const previous = process.env.WORKSHOP_ANALYTICS_TOKEN;
  try {
    delete process.env.WORKSHOP_ANALYTICS_TOKEN;
    const fallback = await handler.fetch(new Request(url));
    assert.deepEqual((await fallback.json()).tools, {
      source: "featured",
      slugs: featured.tools,
    });
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(
      (await handler.fetch(new Request(url, { method: "POST" }))).status,
      405,
    );
    assert.equal(
      (await handler.fetch(new Request(url + "?date=other"))).status,
      400,
    );

    process.env.WORKSHOP_ANALYTICS_TOKEN = "fixture-only";
    const response = await handler.fetch(new Request(url));
    assert.match(
      response.headers.get("vercel-cdn-cache-control"),
      /s-maxage=86400/,
    );
    assert.deepEqual(await response.json(), {
      updatedAt: "2026-11-14T00:00:00.000Z",
      tools: {
        source: "analytics",
        slugs: ["image-studio", "qr-studio", "pdf-toolkit", "network-test"],
      },
      games: { source: "featured", slugs: featured.games },
    });
    assert.equal(fetch.mock.callCount(), 4);

    fetch.mock.mockImplementation(async () => {
      throw new DOMException("Timed out", "TimeoutError");
    });
    const unavailable = await handler.fetch(new Request(url));
    assert.match(
      unavailable.headers.get("vercel-cdn-cache-control"),
      /s-maxage=300/,
    );
    assert.equal((await unavailable.json()).updatedAt, null);
  } finally {
    if (previous === undefined) delete process.env.WORKSHOP_ANALYTICS_TOKEN;
    else process.env.WORKSHOP_ANALYTICS_TOKEN = previous;
  }
});
