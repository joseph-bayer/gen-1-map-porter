// Checks that manifest.json (what the Crystal Tool Suite launcher reads) has package.json's version.
// usage: node scripts/check-manifest.mjs

import { readFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const manifest = read("manifest.json"), pkg = read("package.json");
if (manifest.version !== pkg.version) {
	console.error(`manifest.json's version is ${manifest.version}, but package.json's is ${pkg.version}`);
	process.exit(1);
}
console.log(`manifest.json and package.json are both version ${pkg.version}`);
