import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/lambda.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  minify: false,
  // pg optionally requires pg-native; stub it out of the bundle
  external: ["pg-native"],
  banner: {
    // ESM bundles need require for pg's conditional CJS interop
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

execFileSync("zip", ["-j", "-q", "dist/lambda.zip", "dist/index.mjs"], { stdio: "inherit" });
console.log("Built dist/lambda.zip");

// Cognito pre-sign-up trigger — a separate, dependency-light Lambda bundle.
await build({
  entryPoints: ["src/presignup.ts"],
  outfile: "dist/presignup.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  minify: false,
});

execFileSync("zip", ["-j", "-q", "dist/presignup.zip", "dist/presignup.mjs"], { stdio: "inherit" });
console.log("Built dist/presignup.zip");
