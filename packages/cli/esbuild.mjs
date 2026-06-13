import { build } from "esbuild";
import { chmod, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

await chmod("dist/index.mjs", 0o755);
console.log("Built dist/index.mjs");
