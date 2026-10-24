// Builds the release folder the Crystal Tool Suite launcher installs: the server as one Windows
// .exe with Node inside (Node's single-executable application feature), with the built page, the
// default tables, the icon, the license and third-party notices, and a manifest whose entry is that
// .exe.
// usage: npm run package (builds first), or node scripts/package.mjs after npm run build

import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import postject from "postject";

import { writeThirdPartyNotices } from "./third-party-notices.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RELEASE = join(ROOT, "release");
const EXE = "gen1-map-porter.exe";
// The fuse Node looks for to know a blob was injected (from Node's single-executable docs).
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const fromRoot = (...parts) => join(ROOT, ...parts);
for (const built of [fromRoot("dist", "server", "index.js"), fromRoot("web", "dist", "index.html")]) {
	if (!existsSync(built)) {
		console.error(`${built} is missing: run npm run build first`);
		process.exit(1);
	}
}
if (process.platform !== "win32") {
	console.error("the release folder is a Windows build: run this on Windows");
	process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "gen1-map-porter-sea-"));
let serverInputs;
try {
	// One CommonJS script, as Node's single-executable feature runs. The server's code only reaches
	// TOOL_ROOT's import.meta.url when it isn't an executable, so it's left undefined here.
	const script = join(work, "server.cjs");
	const bundled = await build({
		entryPoints: [fromRoot("dist", "server", "index.js")],
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
		outfile: script,
		define: { "import.meta.url": "undefined" },
		logLevel: "warning",
		metafile: true,
	});
	serverInputs = Object.keys(bundled.metafile.inputs);

	const blob = join(work, "sea-prep.blob");
	writeFileSync(join(work, "sea-config.json"), JSON.stringify({ main: script, output: blob, disableExperimentalSEAWarning: true }));
	execFileSync(process.execPath, ["--experimental-sea-config", join(work, "sea-config.json")], { stdio: "inherit" });

	rmSync(RELEASE, { recursive: true, force: true });
	mkdirSync(RELEASE);
	const exe = join(RELEASE, EXE);
	copyFileSync(process.execPath, exe);
	// postject warns "The signature seems corrupted!": node.exe's signature can't cover the added
	// blob, so it's dropped and the .exe comes out unsigned.
	await postject.inject(exe, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: SEA_FUSE });
} finally {
	rmSync(work, { recursive: true, force: true });
}

// What the server reads from beside the .exe: the built page and the default tables.
cpSync(fromRoot("web", "dist"), join(RELEASE, "web", "dist"), { recursive: true });
cpSync(fromRoot("tables"), join(RELEASE, "tables"), { recursive: true });
copyFileSync(fromRoot("icon.png"), join(RELEASE, "icon.png"));
copyFileSync(fromRoot("LICENSE"), join(RELEASE, "LICENSE"));
const listed = await writeThirdPartyNotices(ROOT, join(RELEASE, "THIRD_PARTY_NOTICES.txt"), {
	serverInputs,
	webDist: fromRoot("web", "dist"),
});

const manifest = JSON.parse(readFileSync(fromRoot("manifest.json"), "utf8"));
manifest.entry = { windows: { command: EXE } };
writeFileSync(join(RELEASE, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);

console.log(`release/ holds ${EXE} ${manifest.version}, built with Node ${process.version}`);
console.log(`THIRD_PARTY_NOTICES.txt lists Node and ${listed.length} npm packages`);
