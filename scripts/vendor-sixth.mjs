import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "src", "vendor"),
  board = path.join(out, "whiteboard");
await fs.mkdir(board, { recursive: true });
const result = await build({
  stdin: {
    contents:
      'export {createElement} from "react"; export {createRoot} from "react-dom/client"; export {Excalidraw,MainMenu,exportToCanvas,exportToSvg,convertToExcalidrawElements,reconcileElements,CaptureUpdateAction,restoreElements,getCommonBounds,newElementWith,sceneCoordsToViewportCoords,viewportCoordsToSceneCoords} from "@excalidraw/excalidraw";',
    resolveDir: root,
    sourcefile: "engine.js",
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  splitting: true,
  outdir: board,
  entryNames: "engine",
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: {
    ".woff2": "file",
    ".woff": "file",
    ".ttf": "file",
    ".wasm": "file",
  },
});
const excalidraw = path.dirname(require.resolve("@excalidraw/excalidraw"));
await fs.copyFile(
  path.join(excalidraw, "index.css"),
  path.join(board, "index.css"),
);
await fs.cp(path.join(excalidraw, "fonts"), path.join(board, "fonts"), {
  recursive: true,
});
// 导出字体子集 worker 使用相对 URL，保留发行包中的 worker 与依赖块。
for (const file of await fs.readdir(excalidraw))
  if (/^(?:subset-.*|chunk-.*)\.js$/.test(file))
    await fs.copyFile(path.join(excalidraw, file), path.join(board, file));
const packageDirs = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes("node_modules")) continue;
  let dir = path.dirname(path.resolve(root, input));
  while (dir !== path.dirname(dir)) {
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(dir, "package.json"), "utf8"),
      );
      if (pkg.name && pkg.version) {
        packageDirs.set(pkg.name, { dir, pkg });
        break;
      }
    } catch {}
    dir = path.dirname(dir);
  }
}
for (const name of ["@excalidraw/excalidraw", "react", "react-dom", "jsqr"]) {
  let dir = path.dirname(require.resolve(name));
  while (dir !== path.dirname(dir)) {
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(dir, "package.json"), "utf8"),
      );
      if (pkg.name === name) {
        packageDirs.set(name, { dir, pkg });
        break;
      }
    } catch {}
    dir = path.dirname(dir);
  }
}
const credits = JSON.parse(
    await fs.readFile(path.join(out, "credits.json"), "utf8"),
  ),
  notices = [];
for (const { dir, pkg } of [...packageDirs.values()].sort((a, b) =>
  a.pkg.name.localeCompare(b.pkg.name),
)) {
  const licenses = (await fs.readdir(dir)).filter((f) =>
    /^(?:licen[cs]e|copying|notice|ofl)(?:[.\-_].*)?$/i.test(f),
  );
  notices.push(
    "\n===== " +
      pkg.name +
      " " +
      pkg.version +
      " · " +
      JSON.stringify(pkg.license || pkg.licenses || "See package license") +
      " =====\n",
  );
  for (const file of licenses) {
    try {
      notices.push(
        file + "\n" + (await fs.readFile(path.join(dir, file), "utf8")),
      );
    } catch {}
  }
  if (
    ["@excalidraw/excalidraw", "react", "react-dom", "jsqr"].includes(pkg.name)
  ) {
    const license = licenses.find((f) => /^licen[cs]e/i.test(f));
    const target = path.join(out, "licenses", pkg.name + ".txt");
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (license) await fs.copyFile(path.join(dir, license), target);
    else if (pkg.name === "@excalidraw/excalidraw") {
      try {
        await fs.access(target);
      } catch {
        const response = await fetch(
          "https://raw.githubusercontent.com/excalidraw/excalidraw/v" +
            pkg.version +
            "/LICENSE",
        );
        if (!response.ok)
          throw Error("Could not retrieve the pinned Excalidraw license.");
        await fs.writeFile(target, await response.text());
      }
      notices.push(await fs.readFile(target, "utf8"));
    } else throw Error("Missing license for " + pkg.name);
    const row = { name: pkg.name, version: pkg.version, license: pkg.license },
      index = credits.findIndex((v) => v.name === pkg.name);
    if (index < 0) credits.push(row);
    else credits[index] = row;
  }
}
await fs.writeFile(
  path.join(out, "licenses/sixth-notices.txt"),
  notices.join("\n"),
);
await fs.writeFile(
  path.join(out, "credits.json"),
  JSON.stringify(credits, null, 2) + "\n",
);
const fontNoticePath = path.join(out, "licenses/excalidraw-fonts.txt");
try {
  await fs.access(fontNoticePath);
} catch {
  let fontNotices =
    "Excalidraw 0.18.1 font copyright metadata and licenses.\nSource: https://github.com/excalidraw/excalidraw/tree/v0.18.1/packages/excalidraw/fonts\n";
  for (const font of [
    "Assistant",
    "Cascadia",
    "ComicShanns",
    "Excalifont",
    "Liberation",
    "Lilita",
    "Nunito",
    "Virgil",
    "Xiaolai",
  ]) {
    const response = await fetch(
      "https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/packages/excalidraw/fonts/" +
        font +
        "/index.ts",
    );
    const source = response.ok ? await response.text() : "",
      metadata = source
        .match(/\/\*[\s\S]*?\*\//g)
        ?.find((s) => /copyright|license/i.test(s));
    fontNotices +=
      "\n===== " +
      font +
      " =====\n" +
      (metadata ||
        "Font as distributed with Excalidraw 0.18.1; see the full license notices below.") +
      "\n";
  }
  for (const [font, url] of [
    [
      "Nunito · full SIL Open Font License 1.1",
      "https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/OFL.txt",
    ],
    [
      "Lilita One",
      "https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/OFL.txt",
    ],
    [
      "Comic Shanns · MIT",
      "https://raw.githubusercontent.com/shannpersand/comic-shanns/master/LICENSE",
    ],
    [
      "Assistant",
      "https://raw.githubusercontent.com/google/fonts/main/ofl/assistant/OFL.txt",
    ],
    [
      "Cascadia Code",
      "https://raw.githubusercontent.com/microsoft/cascadia-code/main/LICENSE",
    ],
    [
      "Virgil",
      "https://raw.githubusercontent.com/excalidraw/virgil/main/LICENSE.md",
    ],
    [
      "Xiaolai",
      "https://raw.githubusercontent.com/lxgw/kose-font/master/OFL.txt",
    ],
    [
      "Liberation Sans",
      "https://raw.githubusercontent.com/liberationfonts/liberation-fonts/main/LICENSE",
    ],
  ]) {
    const response = await fetch(url);
    if (!response.ok)
      throw Error("Missing font license for " + font + ": " + response.status);
    fontNotices +=
      "\n===== " + font + " =====\n" + url + "\n" + (await response.text());
  }
  await fs.writeFile(fontNoticePath, fontNotices);
}
await fs.copyFile(
  path.join(packageDirs.get("jsqr").dir, "dist/jsQR.js"),
  path.join(out, "jsqr.js"),
);
await fs.writeFile(
  path.join(board, "package-manifest.json"),
  JSON.stringify(
    [...packageDirs.values()].map(({ pkg }) => ({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
    })),
    null,
    2,
  ) + "\n",
);
console.log(
  "Prepared local Excalidraw, React, QR scanning, fonts and " +
    packageDirs.size +
    " package notices.",
);
