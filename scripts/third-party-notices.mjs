// Writes the release's THIRD_PARTY_NOTICES.txt: the license of the Node.js runtime inside the .exe,
// then the license text of every npm package whose files end up in what ships, the built page
// (web/dist) and the server bundle. Which packages those are is read from the bundlers themselves,
// not from package.json: Vite's output for the page (JavaScript modules, stylesheets Tailwind
// pulls in and font files), esbuild's metafile for the server. So the many packages only shadcn's
// CLI uses aren't listed, and one bundled through another package is.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { build } from "vite";

// The names a package's license, copying and notice files go by (LICENSE, LICENSE.md,
// LICENSE-MIT, licence.txt, COPYING, NOTICE, ...).
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-_.][\w.-]*)?$/i;
const NOT_LICENSE = /\.(c?js|mjs|ts|json|map)$/i;
const RULE = "=".repeat(100);

// License texts for the packages that ship none, as their repositories give them; used only while
// a package still has no license file of its own.
const OVERRIDES = {
	"react-remove-scroll-bar": {
		source: "https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE",
		text: `MIT License

Copyright (c) 2025 Anton Korzunov <thekashey@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
	},
};

/**
 * Writes the notices to `outFile`.
 * @param {string} root the project root
 * @param {string} outFile where to write
 * @param {{ serverInputs: string[], webDist: string }} shipped the server bundle's inputs (paths
 *   relative to `root`, from esbuild's metafile) and the built page folder, which the page build
 *   read here has to match
 * @returns {{ name: string, version: string }[]} the packages listed, after Node
 */
export async function writeThirdPartyNotices(root, outFile, { serverInputs, webDist }) {
	const files = new Set([
		...serverInputs.map((input) => resolve(root, input)),
		...(await pageFiles(root, webDist)),
	]);

	const packages = new Map();
	for (const file of files) {
		const pkg = packageOf(file);
		if (pkg) packages.set(pkg.dir, pkg);
	}
	const listed = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

	const sections = [nodeSection(), ...listed.map(packageSection)];
	const header = [
		"Third-party software in this release",
		"",
		"gen1-map-porter.exe holds the Node.js runtime, and it and the page under web/dist include code,",
		"styles and fonts from the npm packages below. Each one's license follows.",
		"",
		`Node.js ${process.version.slice(1)}`,
		...listed.map((pkg) => `${pkg.name} ${pkg.version} (${pkg.license})`),
	].join("\n");
	writeFileSync(outFile, `${[header, ...sections].join(`\n\n${RULE}\n\n`)}\n`);
	return listed;
}

/** Every file the page build takes from outside web/src: modules it bundles, stylesheets and assets. */
async function pageFiles(root, webDist) {
	const files = [];
	const emitted = [];
	await build({
		configFile: join(root, "vite.config.ts"),
		logLevel: "warn",
		build: { write: false },
		plugins: [
			{
				name: "third-party-notices",
				generateBundle(_options, bundle) {
					for (const output of Object.values(bundle)) {
						emitted.push(output.fileName);
						if (output.type === "chunk") {
							for (const [id, module] of Object.entries(output.modules)) {
								if (module.renderedLength > 0) files.push(id);
							}
						} else {
							// A font or image's source, relative to the page's root (web/).
							for (const name of output.originalFileNames ?? []) files.push(resolve(root, "web", name));
						}
					}
					// The stylesheets Tailwind's plugin inlines into the page's CSS aren't modules of their
					// own; the plugin registers them as files to watch.
					for (const file of this.getWatchFiles()) {
						if (file.endsWith(".css")) files.push(file);
					}
				},
			},
		],
	});

	// What was read here has to be what ships: the same file names (which carry content hashes).
	const built = listFiles(webDist).filter((file) => file !== "index.html").sort();
	const read = emitted.filter((file) => file !== "index.html").sort();
	if (built.join("\n") !== read.join("\n")) {
		throw new Error(`${webDist} doesn't match a fresh build of the page: run npm run build first`);
	}
	return files.filter((file) => isAbsolute(file) && file.split(/[\\/]/).includes("node_modules")).map((file) => resolve(file));
}

function listFiles(dir, prefix = "") {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
			: [`${prefix}${entry.name}`],
	);
}

/** The npm package a file under node_modules belongs to, or undefined if it isn't in one. */
function packageOf(file) {
	if (!file.split(sep).includes("node_modules")) return undefined;
	// The nearest package.json with a name: some packages have bare ones ({"type": "module"}) in
	// their subfolders.
	for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
		const manifest = join(dir, "package.json");
		if (!existsSync(manifest)) continue;
		const pkg = JSON.parse(readFileSync(manifest, "utf8"));
		if (!pkg.name || !pkg.version) continue;
		return { dir, name: pkg.name, version: pkg.version, license: licenseOf(pkg), pkg };
	}
	throw new Error(`no package.json above ${file}`);
}

function licenseOf(pkg) {
	if (typeof pkg.license === "string") return pkg.license;
	if (pkg.license?.type) return pkg.license.type;
	if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(" OR ");
	return "unknown";
}

function licenseFiles(dir) {
	return readdirSync(dir)
		.filter((name) => LICENSE_FILE.test(name) && !NOT_LICENSE.test(name) && statSync(join(dir, name)).isFile())
		.sort();
}

function packageSection({ dir, name, version, license, pkg }) {
	const lines = [`${name} ${version}`, `License: ${license}`];
	const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
	if (repository) lines.push(`Repository: ${repository}`);
	const found = licenseFiles(dir);
	const override = OVERRIDES[name];
	if (found.length === 0 && override) {
		lines.push("", `--- not in the package; from ${override.source} ---`, "", override.text);
	} else if (found.length === 0) {
		const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
		if (author) lines.push(`Author: ${author}`);
		lines.push("", "The package includes no license file; its package.json declares the license above.");
		console.warn(`${name} ${version} has no license file: only its declared license (${license}) is listed`);
	}
	for (const file of found) {
		const text = readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n").trimEnd();
		lines.push("", ...(found.length > 1 ? [`--- ${file} ---`, ""] : []), text);
	}
	return lines.join("\n");
}

/**
 * Node's license, from the LICENSE file the Windows installer and zip put beside node.exe: the .exe
 * is a copy of the node.exe running this script.
 */
function nodeSection() {
	const file = join(dirname(process.execPath), "LICENSE");
	if (!existsSync(file)) {
		throw new Error(`no LICENSE beside ${process.execPath}: package with a Node installed from nodejs.org's installer or zip`);
	}
	const text = readFileSync(file, "utf8").replace(/\r\n?/g, "\n").trimEnd();
	return [`Node.js ${process.version.slice(1)}`, "License: MIT, and the licenses of the software it includes, below", "Repository: https://github.com/nodejs/node", "", text].join("\n");
}
