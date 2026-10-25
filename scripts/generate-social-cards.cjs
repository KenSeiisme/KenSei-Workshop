/** Development-only social image generation. The production Python build copies the PNGs. */
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const dimensions = { width: 1200, height: 630 };
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

function options(argv) {
  const result = {
    output: "src/assets/og",
    check: false,
    channel:
      process.env.BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
  };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--check") result.check = true;
    else if (["--manifest", "--output", "--channel"].includes(argument)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw Error(`Missing value for ${argument}`);
      result[argument.slice(2)] = argv[++i];
    } else if (argument === "--help" || argument === "-h") result.help = true;
    else if (!argument.startsWith("--") && !result.manifest)
      result.manifest = argument;
    else throw Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function outputFile(entry) {
  const locale =
    entry.locale === "en"
      ? "en"
      : entry.locale === "zh-Hant"
        ? "zh-hant"
        : null;
  if (!locale) throw Error(`Unsupported locale: ${entry.locale}`);
  const supplied = String(entry.route ?? "");
  if (/[?#\\:]|(?:^|\/)\.\.(?:\/|$)/.test(supplied))
    throw Error(`Invalid logical route: ${supplied}`);
  const route = supplied
    .replace(/^\/+|\/+$/g, "")
    .replace(/^zh-hant(?:\/|$)/, "");
  const slug = route.replaceAll("/", "-") || "home";
  if (!/^[a-z0-9-]+$/.test(slug))
    throw Error(`Invalid route filename: ${supplied}`);
  return `${locale}/${slug}.png`;
}

function pngSize(bytes) {
  if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a")
    throw Error("Not a PNG image");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const gameAccents = {
  2048: "#d6b5ed",
  minesweeper: "#a6c4ef",
  snake: "#9cdbbc",
  "memory-match": "#e9afd9",
  sudoku: "#b7c3f7",
  nonogram: "#dcb5ef",
  "block-puzzle": "#96d7eb",
  "brick-breaker": "#f2b878",
  "connect-four": "#efbd8e",
  reversi: "#91d2b6",
  "block-drop": "#91d9f0",
  pong: "#f2c68c",
};

function iconMap(source) {
  return Object.fromEntries(
    [
      ...source.matchAll(/(?:"([^"]+)"|(\w+)):\s*(?:uiHtml\(\s*)?'([^']+)'/g),
    ].map((match) => [match[1] || match[2], match[3]]),
  );
}

function art(entry, assets) {
  const slug =
    entry.slug ||
    String(entry.route || "")
      .replace(/\/+$/, "")
      .split("/")
      .pop();
  const type = String(entry.type || "page")
    .toLowerCase()
    .replace(/s$/, "");
  const game =
    type === "game" ||
    entry.route.includes("/games/") ||
    String(entry.route).startsWith("games/");
  const accent = game
    ? gameAccents[slug] || "#d6b5ed"
    : type === "project"
      ? "#a7c8ef"
      : "#d6b5ed";
  const glyph = game
    ? assets.gameIcons[slug]
    : assets.toolIcons[assets.toolGlyphs[slug]];
  const fallback =
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7m-3.5-3.5v7"/>';
  return `<div class="art" style="--card-accent:${accent}"><div class="orbit orbit-a"></div><div class="orbit orbit-b"></div><div class="art-shadow"></div><div class="art-back"></div><div class="art-front"><span class="art-marker">✳</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph || fallback}</svg><div class="art-lines"><i></i><i></i><i></i></div></div><span class="spark spark-one">✳</span><span class="spark spark-two">+</span><span class="spark spark-three">·</span></div>`;
}

function card(entry, assets) {
  const zh = entry.locale === "zh-Hant";
  const type = String(entry.type || "page")
    .toLowerCase()
    .replace(/s$/, "");
  const labels = zh
    ? {
        tool: "瀏覽器工具",
        game: "迷你遊戲",
        project: "作品",
        page: "WORKSHOP",
      }
    : {
        tool: "BROWSER TOOL",
        game: "ARCADE",
        project: "PROJECT",
        page: "WORKSHOP",
      };
  const description = String(entry.description || "");
  return `<!doctype html><html lang="${escape(entry.locale)}"><head><meta charset="utf-8"><style>${assets.fontCss}
  *{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#111015;color:#f2edf3}
  body{font-family:"DM Sans","Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif}
  .canvas{position:relative;width:1200px;height:630px;isolation:isolate;background:radial-gradient(ellipse at 103% 7%,#74548132,transparent 47%),radial-gradient(ellipse at -10% 120%,#593f6530,transparent 52%),#111015}
  .canvas:before{content:"";position:absolute;inset:0;background-image:linear-gradient(#dfc5ec05 1px,transparent 1px),linear-gradient(90deg,#dfc5ec05 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(90deg,transparent 10%,#000 100%);z-index:-1}
  .top{position:absolute;left:64px;right:64px;top:48px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;gap:16px;align-items:center;font:600 34px/1 "Space Grotesk",system-ui,sans-serif;letter-spacing:-1.5px}.brand img{width:54px;height:54px;border-radius:14px}.brand .dot{color:#d6b5ed}
  .type{border:1px solid #d6b5ed36;border-radius:99px;padding:12px 19px;color:#d6b5ed;font-size:14px;letter-spacing:${zh ? ".1em" : ".16em"};font-weight:600;background:#241c2d77}
  .copy{position:absolute;left:64px;top:186px;width:716px}
  .title{font-family:"Space Grotesk","Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif;font-size:70px;font-weight:600;line-height:1.1;letter-spacing:${zh ? "-.025em" : "-.045em"};margin:0;max-height:234px;overflow:hidden;overflow-wrap:anywhere}
  .description{text-wrap:balance;font-size:23px;line-height:1.55;color:#b3a8bf;margin:25px 0 0;width:672px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;max-height:108px}
  .bottom{position:absolute;left:64px;right:64px;bottom:40px;border-top:1px solid #e7c7f01a;padding-top:21px;display:flex;justify-content:space-between;align-items:center;color:#a99fb3;font-size:15px;letter-spacing:.01em}
  .bottom strong{font-size:15px;font-weight:500;color:#ddc7eb}.bottom strong:before{content:"";display:inline-block;width:6px;height:6px;background:#d6b5ed;border-radius:50%;margin:0 10px 2px 0;box-shadow:0 0 14px #d6b5ed66}
  .art{position:absolute;width:340px;height:342px;right:35px;top:165px;color:var(--card-accent)}
  .orbit{position:absolute;left:25px;top:15px;width:285px;height:285px;border:1px solid color-mix(in srgb,var(--card-accent) 11%,transparent);border-radius:50%}.orbit-b{inset:-12px 0 auto auto;width:340px;height:340px;border-style:dashed;opacity:.5}
  .art-shadow{position:absolute;left:48px;top:104px;width:250px;height:200px;background:var(--card-accent);filter:blur(60px);opacity:.09;transform:rotate(-10deg)}
  .art-back{position:absolute;left:55px;top:54px;width:238px;height:240px;background:#211a2b;border:1px solid color-mix(in srgb,var(--card-accent) 14%,transparent);border-radius:31px;transform:rotate(8deg)}
  .art-front{position:absolute;left:33px;top:28px;width:248px;height:256px;border:1px solid color-mix(in srgb,var(--card-accent) 50%,transparent);border-radius:28px;background:linear-gradient(145deg,color-mix(in srgb,var(--card-accent) 13%,#211929),#1b1721 80%);transform:rotate(-9deg);box-shadow:18px 23px 45px #0005,inset 0 1px #ffffff0d}
  .art-front svg{position:absolute;left:57px;top:52px;width:133px;height:133px;filter:drop-shadow(0 0 18px color-mix(in srgb,var(--card-accent) 15%,transparent))}
  .art-marker{position:absolute;top:17px;left:20px;font-size:20px;color:#e9c3f3b0}.art-lines{position:absolute;bottom:24px;left:25px;right:25px;display:flex;gap:7px}.art-lines i{height:4px;border-radius:5px;background:var(--card-accent);opacity:.2;flex:1}.art-lines i:first-child{opacity:.7;flex:2.2}
  .spark{position:absolute;color:var(--card-accent);font-family:system-ui,sans-serif}.spark-one{top:4px;right:12px;font-size:38px;opacity:.8}.spark-two{bottom:15px;left:12px;font-size:24px;opacity:.7}.spark-three{bottom:5px;right:28px;font-size:36px;opacity:.6}
  </style></head><body><main class="canvas"><header class="top"><div class="brand"><img src="${assets.logo}" alt=""><span>KenSei<span class="dot">.</span></span></div><div class="type">${escape(labels[type] || labels.page)}</div></header><section class="copy"><h1 class="title">${escape(entry.title)}</h1>${description ? `<p class="description">${escape(description)}</p>` : ""}</section>${art(entry, assets)}<footer class="bottom"><strong>${zh ? "實用工具，輕鬆遊戲。" : "Useful tools. A little room to play."}</strong><span>${escape(assets.hostname)}</span></footer></main></body></html>`;
}

async function assets() {
  const fontDirectory = path.join(root, "src/assets/fonts");
  const fonts = JSON.parse(
    await fs.readFile(path.join(fontDirectory, "manifest.json"), "utf8"),
  );
  let fontCss = await fs.readFile(
    path.join(fontDirectory, "fonts.css"),
    "utf8",
  );
  for (const font of fonts.files) {
    const bytes = await fs.readFile(path.join(fontDirectory, font.file));
    if (digest(bytes) !== font.sha256)
      throw Error(`Font hash changed: ${font.file}`);
    fontCss = fontCss.replace(
      `/assets/fonts/${font.file}`,
      `data:font/woff2;base64,${bytes.toString("base64")}`,
    );
  }
  const logo = await fs.readFile(path.join(root, "src/assets/favicon.svg"));
  const gameSource = await fs.readFile(
    path.join(root, "src/games/presentation.js"),
    "utf8",
  );
  const buildSource = await fs.readFile(
    path.join(root, "scripts/build.py"),
    "utf8",
  );
  const tools = JSON.parse(
    await fs.readFile(path.join(root, "data/tools.json"), "utf8"),
  );
  const config = JSON.parse(
    await fs.readFile(path.join(root, "data/site.json"), "utf8"),
  );
  return {
    fontCss,
    logo: `data:image/svg+xml;base64,${logo.toString("base64")}`,
    hostname: new URL(config.site_url).hostname,
    gameIcons: iconMap(gameSource),
    toolIcons: iconMap(buildSource),
    toolGlyphs: Object.fromEntries(tools.map((tool) => [tool[0], tool[1]])),
    sourceHash: digest(
      JSON.stringify({
        fonts,
        logo: digest(logo),
        gameIcons: iconMap(gameSource),
        toolIcons: iconMap(buildSource),
        toolGlyphs: Object.fromEntries(tools.map((tool) => [tool[0], tool[1]])),
        hostname: new URL(config.site_url).hostname,
        generator: digest(await fs.readFile(__filename)),
      }),
    ),
  };
}

async function main(argv) {
  const settings = options(argv);
  if (settings.help || !settings.manifest) {
    console.log(
      "Usage: node scripts/generate-social-cards.cjs --manifest <pages.json> [--output src/assets/og] [--channel msedge] [--check]",
    );
    if (!settings.help) process.exitCode = 2;
    return;
  }
  const output = path.resolve(root, settings.output);
  const relative = path.relative(root, output);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("Output must stay inside this project.");
  const input = JSON.parse(
    await fs.readFile(path.resolve(root, settings.manifest), "utf8"),
  );
  const entries = Array.isArray(input) ? input : input.pages;
  if (!Array.isArray(entries) || !entries.length)
    throw Error("Manifest must contain a nonempty page array.");
  const files = new Set();
  for (const entry of entries) {
    if (typeof entry.title !== "string" || !entry.title.trim())
      throw Error("Each page needs a title.");
    const file = outputFile(entry);
    if (files.has(file)) throw Error(`Duplicate card filename: ${file}`);
    files.add(file);
  }
  const shared = await assets();
  const records = [];
  if (settings.check) {
    const saved = JSON.parse(
      await fs.readFile(path.join(output, "manifest.json"), "utf8"),
    );
    if (saved.cards.length !== entries.length)
      throw Error(
        "Social-card manifest does not match the requested page count.",
      );
    for (const entry of entries) {
      const file = outputFile(entry),
        record = saved.cards.find((item) => item.file === file);
      if (
        !record ||
        record.sourceHash !== digest(JSON.stringify(entry) + shared.sourceHash)
      )
        throw Error(`Outdated card: ${file}`);
      const bytes = await fs.readFile(path.join(output, file)),
        size = pngSize(bytes);
      if (
        size.width !== dimensions.width ||
        size.height !== dimensions.height ||
        digest(bytes) !== record.sha256
      )
        throw Error(`Invalid social card: ${file}`);
    }
    console.log(
      `PASS ${entries.length} social images: 1200x630, input hashes and PNG hashes.`,
    );
    return;
  }
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    ({ chromium } = require("../tests/support/browser.cjs"));
  }
  const browser = await chromium.launch({
    channel: settings.channel,
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: dimensions,
      deviceScaleFactor: 1,
    });
    await context.route("http://**/*", (route) => route.abort());
    await context.route("https://**/*", (route) => route.abort());
    const page = await context.newPage();
    await fs.mkdir(output, { recursive: true });
    for (const entry of entries) {
      await page.setContent(card(entry, shared), { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const title = document.querySelector(".title");
        let size = 70;
        while (title.scrollHeight > 233 && size > 40)
          title.style.fontSize = `${--size}px`;
        const copy = document.querySelector(".copy");
        while (copy.scrollHeight > 340 && size > 40)
          title.style.fontSize = `${--size}px`;
        if (title.scrollHeight > 235 || copy.scrollHeight > 340)
          throw Error("Social-card copy is too long.");
        const titleBounds = title.getBoundingClientRect();
        if (titleBounds.bottom > 453)
          throw Error("Social-card title overlaps its footer.");
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      const file = outputFile(entry),
        destination = path.join(output, file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const bytes = await page.screenshot({
        path: destination,
        type: "png",
        animations: "disabled",
      });
      records.push({
        route: entry.route,
        locale: entry.locale,
        file,
        width: dimensions.width,
        height: dimensions.height,
        bytes: bytes.length,
        sha256: digest(bytes),
        sourceHash: digest(JSON.stringify(entry) + shared.sourceHash),
      });
    }
  } finally {
    await browser.close();
  }
  await fs.writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify(
      {
        generator: "scripts/generate-social-cards.cjs",
        dimensions,
        cards: records,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Generated ${records.length} social images (${records.reduce((sum, item) => sum + item.bytes, 0).toLocaleString()} bytes).`,
  );
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { outputFile, pngSize };
