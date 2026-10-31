// Builds the React app into dist/client with esbuild:
//   - bundles src/client/main.tsx (+ its CSS) into hashed files
//   - writes index.html with those files filled in
//   - copies everything in public/ (manifest, icons)
//
// Usage: node scripts/build-client.mjs [--watch] [--no-clean]

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist", "client");
const watch = process.argv.includes("--watch");
const clean = !process.argv.includes("--no-clean");

async function writeHtml(result) {
  const outputs = Object.keys(result.metafile.outputs);
  const js = outputs.find((f) => f.endsWith(".js"));
  const css = outputs.find((f) => f.endsWith(".css"));
  if (!js) throw new Error("esbuild produced no JavaScript file");

  const template = await readFile(join(root, "src", "client", "index.html"), "utf8");
  const html = template
    .replace("<!--BUILD:CSS-->", css ? `<link rel="stylesheet" href="/assets/${basename(css)}" />` : "")
    .replace("<!--BUILD:JS-->", `<script type="module" src="/assets/${basename(js)}"></script>`);
  await writeFile(join(outdir, "index.html"), html);
}

async function copyPublic() {
  const pub = join(root, "public");
  if (existsSync(pub)) await cp(pub, outdir, { recursive: true });
}

const options = {
  entryPoints: [join(root, "src", "client", "main.tsx")],
  bundle: true,
  format: "esm",
  target: ["es2022", "safari15"],
  jsx: "automatic",
  outdir: join(outdir, "assets"),
  entryNames: "[name]-[hash]",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  metafile: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  plugins: [
    {
      name: "write-html",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length > 0) return;
          await writeHtml(result);
        });
      },
    },
  ],
};

if (clean) await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await copyPublic();

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching src/client for changes...");
} else {
  await esbuild.build(options);
  console.log(`Built ${outdir}`);
}
