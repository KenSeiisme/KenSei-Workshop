import { build } from "esbuild";
await build({
  entryPoints: ["supabase/functions/games-session/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "_qa/games-session/index.ts",
});
console.log(
  "Built _qa/games-session/index.ts with the canonical versioned game engine.",
);
