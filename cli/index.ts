// port-gen1-map command line.
//
//   node dist/cli/index.js list   --game yellow|red|blue|cse
//   node dist/cli/index.js render --game yellow|red|blue|cse --map CONST [--time morn|day|nite|eve] [-o out.png]
//   node dist/cli/index.js port   --map GEN1_CONST [--dry-run] [--force]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { encodePng } from "../shared/node/png.js";
import { portMap, type PortReport } from "../shared/node/port.js";
import { listMaps, loadConfig, loadMap, TOOL_ROOT } from "../shared/node/project.js";
import { renderMap } from "../shared/render.js";
import { TIMES, type Game, type TimeOfDay } from "../shared/types.js";

const GAMES: readonly Game[] = ["yellow", "red", "blue", "cse"];

function usage(): never {
	console.error(`usage:
  list   --game yellow|red|blue|cse
  render --game yellow|red|blue|cse --map CONST [--time morn|day|nite|eve] [-o out.png]
  port   --map GEN1_CONST [--dry-run] [--force]`);
	process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
	args: rest,
	options: {
		game: { type: "string" },
		map: { type: "string" },
		time: { type: "string" },
		out: { type: "string", short: "o" },
		"dry-run": { type: "boolean" },
		force: { type: "boolean" },
	},
});
const config = loadConfig();
const game = (values.game ?? (command === "port" ? "cse" : undefined)) as Game | undefined;
if (!game || !GAMES.includes(game)) usage();

if (command === "list") {
	for (const name of listMaps(config, game)) console.log(name);
} else if (command === "render") {
	if (!values.map) usage();
	const time = values.time as TimeOfDay | undefined;
	if (time && !TIMES.includes(time)) usage();
	const map = loadMap(config, game, values.map);
	const image = renderMap(map, { time });
	const out = values.out ?? join(TOOL_ROOT, "out", `${game}_${map.constName}.png`);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, encodePng(image));
	const ts = map.tileset;
	console.log(`${map.name} (${map.constName}): ${map.width}x${map.height} blocks, tileset ${ts.constName} ` +
		`(${ts.tileCount} tiles, ${ts.blockCount} blocks)${map.pinnedTime ? `, pinned ${map.pinnedTime}` : ""}`);
	for (const note of map.notes) console.log(`  note: ${note}`);
	console.log(`wrote ${out}`);
} else if (command === "port") {
	if (!values.map) usage();
	const report = portMap(config, values.map, { dryRun: values["dry-run"] ?? false, force: values.force ?? false });
	printReport(report);
	process.exit(report.unpaired.length || report.missing.length || report.errors.length || report.needsConfirm ? 1 : 0);
} else {
	usage();
}

function printReport(r: PortReport) {
	console.log(`${r.map} -> ${r.cseMap}${r.dryRun ? " (dry run)" : ""}`);
	if (r.unpaired.length) console.log(`  unpaired Gen 1 blocks (nothing written): ${r.unpaired.map((b) => `$${b.toString(16)}`).join(" ")}`);
	console.log(`  new blocks for the project's tileset: ${r.appendedBlocks}`);
	if (r.unusedAdded.length) console.log(`  blocks this tool added that no map uses any more (delete by hand if you like): ${r.unusedAdded.map((b) => `$${b.toString(16)}`).join(" ")}`);
	for (const m of r.reconciled.moved) console.log(`  re-pointed Gen 1 $${m.gen1.toString(16)}: ${m.what} (content moved; save the mapping to keep it)`);
	if (r.reconciled.changed.length) console.log(`  changed since paired (confirm in the page): ${r.reconciled.changed.map((b) => `$${b.toString(16)}`).join(" ")}`);
	if (r.conflicts.length) console.log(`  collision differs from Gen 1 in ${r.conflicts.length} block(s): ${r.conflicts.map((c) => `$${c.gen1Block.toString(16)}`).join(" ")}`);
	console.log(`  walkability differs on ${r.walkIssues.length} square(s)`);
	const crossable = r.pairEdges.filter((e) => e.crossable).length;
	console.log(`  Gen 1 elevation edges: ${r.pairEdges.length}, ${crossable} crossable in the result`);
	for (const w of r.warps) {
		const g = `${w.gen1.x},${w.gen1.y} -> ${w.gen1.dest} ${w.gen1.warp}`;
		console.log(`  warp ${g}: ${w.cse ? `${w.cse.map} ${w.cse.warp}` : `omitted (${w.reason})`}`);
	}
	for (const s of r.warpSquares) {
		const what = s.want ? (s.want === s.before ? `${s.want} (already)` : `${s.before ?? "?"} -> ${s.want}`) : `left as ${s.before ?? "?"}: ${s.note}`;
		console.log(`  warp square ${s.x},${s.y} (Gen 1 ${s.gen1}): ${what}`);
	}
	for (const c of r.connections) console.log(`  connection ${c.dir} ${c.target}: ${c.included ? "included" : `omitted (${c.reason})`}`);
	const e = r.events;
	console.log(`  events: ${e.items} item(s), ${e.hiddenItems} hidden item(s), ${e.signs} sign(s) and other bg events, ${e.people} person(s), ${e.trainers} trainer(s)`);
	for (const n of e.notes) console.log(`    ${n}`);
	if (r.missing.length) console.log(`  needs a match in the project (choose in the page; nothing written): ${r.missing.map((m) => `${m.kind} ${m.gen1}`).join(", ")}`);
	for (const f of r.files) console.log(`  ${f.action}: ${f.path}`);
	for (const e of r.errors) console.log(`  ERROR: ${e}`);
	if (r.outsideEdits) {
		const why = r.outsideEdits.reason === "no-record" ? "exists, and the tool has no record of writing it" : "changed outside the tool since the last port";
		console.log(`  WARNING: ${r.outsideEdits.path} ${why}; ${r.outsideEdits.blocks.length} block(s) differ from this port: ${r.outsideEdits.blocks.slice(0, 12).map((b) => `(${b.x},${b.y})`).join(" ")}${r.outsideEdits.blocks.length > 12 ? " …" : ""}`);
		if (r.needsConfirm) console.log("  Nothing written. Rerun with --force to overwrite those edits.");
	}
}
