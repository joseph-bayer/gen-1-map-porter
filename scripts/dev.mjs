// npm run dev: compile the Node side, then run tsc --watch, the server (restarted on change) and
// Vite's dev server (which proxies /api to the server) together. Ctrl+C stops all three.

import { spawn, spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const opts = { stdio: "inherit", shell: process.platform === "win32" };

const first = spawnSync(npx, ["tsc", "-p", "tsconfig.node.json"], opts);
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
	spawn(npx, ["tsc", "-p", "tsconfig.node.json", "--watch", "--preserveWatchOutput"], opts),
	spawn(process.execPath, ["--watch", "dist/server/index.js"], { stdio: "inherit" }),
	spawn(npx, ["vite"], opts),
];
const stop = () => {
	for (const child of children) child.kill();
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
