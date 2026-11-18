import fs from "node:fs/promises";
const pkg = new URL("../node_modules/mediabunny-video/", import.meta.url);
const manifest = JSON.parse(
  await fs.readFile(new URL("package.json", pkg), "utf8"),
);
if (manifest.version !== "1.66.1")
  throw Error("Unexpected video library version.");
await fs.copyFile(
  new URL("dist/bundles/mediabunny.min.mjs", pkg),
  "src/vendor/mediabunny-video-1.66.1.mjs",
);
const notice =
  "# Mediabunny v1.66.1\n\nSource: https://github.com/Vanilagy/mediabunny/tree/v1.66.1\n\n";
await fs.writeFile(
  "src/vendor/licenses/mediabunny-video.txt",
  notice + (await fs.readFile(new URL("LICENSE", pkg), "utf8")),
);
