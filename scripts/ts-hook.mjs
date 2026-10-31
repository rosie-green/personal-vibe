// Lets Node load .ts files through esbuild, so the tests also run on Node builds
// that ship without built-in type stripping.
//
// Usage: node --enable-source-maps --import ./scripts/ts-hook.mjs <file.ts>

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
    const path = fileURLToPath(url);
    const { code } = transformSync(readFileSync(path, "utf8"), {
      loader: "ts",
      format: "esm",
      sourcefile: path,
      sourcemap: "inline",
    });
    return { format: "module", source: code, shortCircuit: true };
  },
});
