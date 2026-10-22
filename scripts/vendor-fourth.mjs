// 本机生成可独立部署的浏览器模块，正式构建仍只需要 Python。
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "src", "vendor");
const bundles = {
  "temporal.js": 'export {Temporal} from "@js-temporal/polyfill";',
  "uplot.js": 'export {default} from "uplot";',
  "wave.js":
    'export {default as WaveSurfer} from "wavesurfer.js"; export {default as Regions} from "wavesurfer.js/dist/plugins/regions.js";',
  "audio-codecs.js":
    'export {Output,BufferTarget,Mp3OutputFormat,AudioSampleSource,AudioSample} from "mediabunny"; export {registerMp3Encoder} from "@mediabunny/mp3-encoder";',
};
for (const [file, contents] of Object.entries(bundles))
  await build({
    stdin: { contents, resolveDir: root },
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
    legalComments: "eof",
    outfile: path.join(out, file),
  });
await fs.copyFile(
  path.join(root, "node_modules/uplot/dist/uPlot.min.css"),
  path.join(out, "uplot.css"),
);
await fs.copyFile(
  path.join(root, "node_modules/papaparse/papaparse.min.js"),
  path.join(out, "papaparse.js"),
);
const credits = JSON.parse(
  await fs.readFile(path.join(out, "credits.json"), "utf8"),
);
for (const name of [
  "@js-temporal/polyfill",
  "uplot",
  "wavesurfer.js",
  "mediabunny",
  "@mediabunny/mp3-encoder",
  "papaparse",
]) {
  let dir = path.dirname(require.resolve(name));
  while (
    !(await fs
      .readFile(path.join(dir, "package.json"), "utf8")
      .then((s) => JSON.parse(s).name === name)
      .catch(() => false))
  ) {
    const next = path.dirname(dir);
    if (next === dir) throw Error("Cannot resolve " + name);
    dir = next;
  }
  const manifest = JSON.parse(
      await fs.readFile(path.join(dir, "package.json"), "utf8"),
    ),
    license = (await fs.readdir(dir)).find((f) =>
      /^licen[sc]e(?:\.md|\.txt)?$/i.test(f),
    );
  if (!license) throw Error("Missing license " + name);
  const target = path.join(out, "licenses", name + ".txt");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(dir, license), target);
  const item = { name, version: manifest.version, license: manifest.license },
    index = credits.findIndex((x) => x.name === name);
  if (index >= 0) credits[index] = item;
  else credits.push(item);
}
await fs.writeFile(
  path.join(out, "licenses/fourth-sources.txt"),
  [
    "Unmodified upstream source for the pinned browser dependencies:",
    "Mediabunny and MP3 extension 1.61.6: https://github.com/Vanilagy/mediabunny/tree/v1.61.6",
    "MP3 encoder build instructions and bridge source: https://github.com/Vanilagy/mediabunny/tree/v1.61.6/packages/mp3-encoder",
    "LAME 3.100 source: https://sourceforge.net/projects/lame/files/lame/3.100/",
    "LAME license: https://lame.sourceforge.io/license.txt",
    "Mediabunny modules use MPL-2.0; their embedded LAME encoder uses LGPL. Sources and upstream build instructions are provided in the sources archive.",
    "The archive includes unmodified src, packages, scripts, shared code and root build files; unrelated demo/test media are omitted.",
    "Temporal: https://github.com/js-temporal/temporal-polyfill",
    "WaveSurfer: https://github.com/katspaugh/wavesurfer.js",
    "uPlot: https://github.com/leeoniya/uPlot",
    "Papa Parse: https://github.com/mholt/PapaParse",
  ].join("\n") + "\n",
);
// 同时提供所分发编码器版本的源码与构建信息，避免只留下不确定的网页链接。
const sourceDir = path.join(out, "sources");
await fs.mkdir(sourceDir, { recursive: true });
for (const [url, name] of [
  [
    "https://codeload.github.com/Vanilagy/mediabunny/tar.gz/refs/tags/v1.61.6",
    "mediabunny-1.61.6.tgz",
  ],
  [
    "https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz",
    "lame-3.100.tgz",
  ],
  ["https://lame.sourceforge.io/license.txt", "lame-license.txt"],
]) {
  const destination = path.join(sourceDir, name);
  try {
    await fs.access(destination);
  } catch {
    const response = await fetch(url);
    if (!response.ok)
      throw Error("Cannot retrieve encoder source: " + response.status);
    await fs.writeFile(
      destination,
      new Uint8Array(await response.arrayBuffer()),
    );
  }
}
execFileSync(
  process.env.KENSEI_PYTHON || "python",
  [path.join(root, "scripts/prepare-encoder-sources.py")],
  { stdio: "inherit" },
);
await fs.writeFile(
  path.join(out, "credits.json"),
  JSON.stringify(credits, null, 2) + "\n",
);
console.log(
  "Prepared fourth-batch browser modules, licenses and encoder source.",
);
