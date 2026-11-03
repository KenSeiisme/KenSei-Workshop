import { build } from "esbuild";
await build({
  entryPoints: ["supabase/functions/board-match/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "_qa/board-match/index.ts",
});
console.log("Built the authoritative board-match Edge bundle.");
