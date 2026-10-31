// `npm run dev`: rebuilds the React app on every change AND runs the Worker locally
// (with a local copy of D1) using wrangler. Open the address wrangler prints.

import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

// Build once first so dist/client exists before wrangler starts serving it.
const first = spawnSync(process.execPath, [join(root, "scripts", "build-client.mjs")], { cwd: root, stdio: "inherit" });
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
  spawn(process.execPath, [join(root, "scripts", "build-client.mjs"), "--watch", "--no-clean"], { cwd: root, stdio: "inherit" }),
  spawn(isWindows ? "npx.cmd" : "npx", ["wrangler", "dev"], { cwd: root, stdio: "inherit", shell: isWindows }),
];

const stop = () => {
  for (const c of children) c.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) {
  c.on("exit", (code) => {
    stop();
    process.exit(code ?? 0);
  });
}
