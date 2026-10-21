import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "vendor");
for (const [file, contents] of Object.entries({
  "math.js": 'export {create,all} from "mathjs";',
  "cropper.js": 'export {default} from "cropperjs";',
}))
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
const credits = JSON.parse(
  await fs.readFile(path.join(out, "credits.json"), "utf8"),
);
for (const name of ["mathjs", "cropperjs"]) {
  const dir = path.join(root, "node_modules", name),
    pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")),
    license = (await fs.readdir(dir)).find((f) =>
      /^license(?:\.md|\.txt)?$/i.test(f),
    );
  await fs.copyFile(
    path.join(dir, license),
    path.join(out, "licenses", name + ".txt"),
  );
  if (name === "mathjs")
    await fs.copyFile(
      path.join(dir, "NOTICE"),
      path.join(out, "licenses/mathjs-NOTICE.txt"),
    );
  const row = { name, version: pkg.version, license: pkg.license },
    index = credits.findIndex((x) => x.name === name);
  if (index < 0) credits.push(row);
  else credits[index] = row;
}
await fs.writeFile(
  path.join(out, "credits.json"),
  JSON.stringify(credits, null, 2) + "\n",
);
console.log("Prepared pinned math and crop modules.");
