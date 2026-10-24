// Render every map of a game in memory and report load errors and missing tiles (magenta).
// usage: node scripts/sweep.mjs yellow|red|blue|cse

import { listMaps, loadConfig, loadMap } from "../dist/shared/node/project.js";
import { renderMap } from "../dist/shared/render.js";

const game = process.argv[2];
const config = loadConfig();
let ok = 0;
const problems = [];
for (const name of listMaps(config, game)) {
	try {
		const map = loadMap(config, game, name);
		const image = renderMap(map);
		let missing = 0;
		for (let i = 0; i < image.rgba.length; i += 4) {
			if (image.rgba[i] === 255 && image.rgba[i + 1] === 0 && image.rgba[i + 2] === 255) missing++;
		}
		const notes = map.notes.filter((n) => !n.startsWith("per-group roof"));
		if (missing || notes.length) problems.push(`${name}: ${missing ? `${missing / 64} missing tile(s); ` : ""}${notes.join("; ")}`);
		else ok++;
	} catch (e) {
		problems.push(`${name}: ERROR ${e.message}`);
	}
}
console.log(`${game}: ${ok} clean, ${problems.length} with notes`);
for (const p of problems) console.log(`  ${p}`);
