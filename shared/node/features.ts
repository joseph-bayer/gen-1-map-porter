// The probes: one per feature, each reading the project's own definitions (macro definitions and
// their arguments, the constants that exist, the kinds of files present) to find which variant the
// project uses. Overrides are saved per project, in <project>/tools/gen1-map-porter/features.json.

import { existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { lines, macroArgCount, macroBody, parseNumber, stripComment } from "../asm.js";
import { writtenCollisionNames } from "../coll.js";
import { describeFeatures, FEATURE_IDS, isSupported, need, type Detected, type FeatureId, type Formats, type ProjectFeatures } from "../features.js";
import type { ProjectFiles } from "../types.js";
import { readJsonFile, updateJsonFile } from "./json.js";
import { projectToolDir } from "./project.js";

/** Files that define the macros the probes read, before any other file in macros/ and macros/scripts/. */
const MACRO_FILES = [
	"macros/scripts/maps.asm",
	"macros/scripts/events.asm",
	"macros/lists.asm",
	"data/maps/maps.asm",
	"data/maps/attributes.asm",
	"data/tilesets.asm",
	"constants/map_constants.asm",
	"data/trainers/macros.asm",
	"gfx/tilesets.asm",
];

interface Macro {
	body: string[];
	file: string;
}

/** Every macro the project defines in the usual places, by name (the first definition wins). */
function projectMacros(files: ProjectFiles): Map<string, Macro> {
	const asmIn = (dir: string) => (files.exists(dir) ? files.list(dir).filter((f) => f.endsWith(".asm")).map((f) => `${dir}/${f}`) : []);
	const out = new Map<string, Macro>();
	for (const file of new Set([...MACRO_FILES, ...asmIn("macros"), ...asmIn("macros/scripts")])) {
		if (!files.exists(file)) continue;
		const text = files.text(file);
		for (const line of lines(text)) {
			const m = line.match(/^MACRO\??\s+(\w+)$/) ?? line.match(/^(\w+):\s*MACRO$/);
			if (m && !out.has(m[1]!)) out.set(m[1]!, { body: macroBody(text, m[1]!) ?? [], file });
		}
	}
	return out;
}

const textOr = (files: ProjectFiles, path: string) => (files.exists(path) ? files.text(path) : undefined);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const flat = (body: string[]) => body.map((l) => l.replace(/\s+/g, " ")).join("\n");

type Probe = (files: ProjectFiles, macros: Map<string, Macro>) => Detected;

const PROBES: Record<FeatureId, Probe> = {
	tileColors(files, macros) {
		const ts = macros.get("tileset");
		const body = ts ? ts.body.join("\n") : "";
		if (/\\1Attr\b/.test(body)) return { variant: "block-attributes", detail: "tileset macro points at an attributes file (\\1Attr)", source: ts!.file };
		if (/\\1PalMap\b/.test(body)) return { variant: "palette-map", detail: "tileset macro points at a palette map (\\1PalMap)", source: ts!.file };
		if (files.exists("gfx/tileset_palette_maps.asm")) return { variant: "palette-map", detail: "tiles take their colors from gfx/tileset_palette_maps.asm", source: "gfx/tileset_palette_maps.asm" };
		return { detail: ts ? "tileset macro names neither an attributes file nor a palette map" : "tileset macro wasn't found", source: ts?.file ?? "data/tilesets.asm" };
	},

	tilesetSize(_files, macros) {
		const ts = macros.get("tileset");
		if (!ts) return { detail: "tileset macro wasn't found", source: "data/tilesets.asm" };
		const gfx = [...new Set([...ts.body.join("\n").matchAll(/\\1(\w*GFX\w*)/g)].map((m) => m[1]!))].sort();
		const detail = gfx.length ? `tileset macro loads ${gfx.join(", ")}` : "tileset macro loads no GFX labels";
		const is = (...names: string[]) => names.length === gfx.length && names.every((n) => gfx.includes(n));
		const variant = is("vTiles2GFX", "vTiles4GFX", "vTiles5GFX") ? "384" : is("GFX") ? "192" : is("GFX0", "GFX1", "GFX2") ? "3x128" : undefined;
		return { variant, detail, source: ts.file };
	},

	blockFiles(files) {
		const source = "data/maps/blocks.asm";
		const text = textOr(files, source);
		if (text === undefined) return { detail: `${source} doesn't exist`, source };
		const counts = new Map<string, number>();
		for (const line of lines(text)) {
			const m = line.match(/INCBIN\s+"maps\/[^"]*?\.((?:a?blk)(?:\.\w+)?)"/);
			if (m) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
		}
		const [ext, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
		if (!ext) return { detail: "map blocks aren't INCBINed from maps/", source };
		const total = [...counts.values()].reduce((a, b) => a + b, 0);
		const variant = ({ ablk: "ablk", blk: "blk", "ablk.lzp": "ablk-lzp" } as Record<string, string>)[ext];
		return { variant, detail: `map blocks are .${ext} files (${n} of ${plural(total, "INCBIN")})`, source };
	},

	mapGroups(_files, macros) {
		const ng = macros.get("newgroup");
		if (!ng) return { detail: "newgroup macro wasn't found", source: "constants/map_constants.asm" };
		const named = macroArgCount(ng.body) >= 1;
		if (named && macros.has("endgroup")) return { variant: "named", detail: "newgroup takes a group name, and endgroup closes it", source: ng.file };
		if (!named) return { variant: "unnamed", detail: "newgroup takes no name", source: ng.file };
		return { detail: "newgroup takes a name, but there's no endgroup", source: ng.file };
	},

	mapHeader(_files, macros) {
		const map = macros.get("map");
		if (!map) return { detail: "map macro wasn't found", source: "data/maps/maps.asm" };
		const n = macroArgCount(map.body);
		const shapes: Record<string, string> = {
			"fish-group": "db BANK(\\1_MapAttributes), \\2, \\3\ndw \\1_MapAttributes\ndb \\4, \\5\ndn \\6, \\7\ndb \\8",
			sign: "db \\2\ndn \\4, \\3\ndw \\1_MapAttributes\ndb \\5, \\6\ndn \\7, \\8",
		};
		const variant = Object.keys(shapes).find((k) => shapes[k] === flat(map.body));
		const layout = variant === "fish-group" ? "ending in a fish group" : variant === "sign" ? "with a sign column and no fish group" : "laid out in a way the porter hasn't seen";
		return { variant, detail: `map macro takes ${n} arguments, ${layout}`, source: map.file };
	},

	mapAttributes(_files, macros) {
		const ma = macros.get("map_attributes");
		if (!ma) return { detail: "map_attributes macro wasn't found", source: "data/maps/attributes.asm" };
		const n = macroArgCount(ma.body), body = ma.body.join("\n");
		const scripts = /\\1_MapScripts\b/.test(body) && /\\1_MapEvents\b/.test(body), header = /\\1_MapScriptHeader\b/.test(body);
		const variant = n === 4 && scripts ? "connection-mask" : n === 3 && scripts ? "connection-lines" : n === 3 && header ? "script-header" : undefined;
		const points = scripts ? "_MapScripts and _MapEvents" : header ? "_MapScriptHeader" : "no script labels the porter knows";
		return { variant, detail: `map_attributes takes ${n} arguments and points at ${points}`, source: ma.file };
	},

	objectEvent(_files, macros) {
		const oe = macros.get("object_event");
		if (!oe) return { detail: "object_event macro wasn't found", source: "macros/scripts/maps.asm" };
		const most = macroArgCount(oe.body);
		// A last argument used only when `_NARG == most` is optional.
		const optional = oe.body.some((l) => new RegExp(`_NARG\\s*==\\s*${most}\\b`).test(l));
		const n = optional ? most - 1 : most;
		const detail = `object_event takes ${n} arguments${optional ? ` (or ${most})` : ""}`;
		// The 12-argument variant writes trainers and boulders with these helpers.
		const helpers = ["generictrainer", "strengthboulder_event"].filter((m) => !macros.has(m));
		if (n === 12 && helpers.length) return { detail: `${detail}, but there's no ${helpers.join(" or ")} macro`, source: oe.file };
		const variant = n === 13 || n === 12 ? String(n) : undefined;
		return { variant, detail, source: oe.file };
	},

	itemEvents(_files, macros) {
		const source = macros.get("itemball")?.file ?? macros.get("itemball_event")?.file ?? "macros/scripts/maps.asm";
		if (macros.has("itemball") && macros.has("hiddenitem")) return { variant: "scripts", detail: "event macros include itemball and hiddenitem", source };
		if (macros.has("itemball_event")) return { variant: "event-macros", detail: "event macros include itemball_event", source };
		return { detail: "event macros have neither itemball and hiddenitem nor itemball_event", source };
	},

	indexWidth(files, macros) {
		const table = "constants/16_bit_translation_constants.asm";
		const item = macros.get("itemball")?.body.find((l) => /^d[bw]\s+\\1\b/.test(l))?.slice(0, 2);
		if (files.exists(table)) {
			if (item === "db") return { detail: `species go through ${table}, but itemball stores the item with db`, source: table };
			return { variant: "16-bit", detail: `species, items and moves go through the 16-bit index tables (${table})`, source: table };
		}
		const data = textOr(files, "constants/pokemon_data_constants.asm") ?? "";
		if (/^\s*DEF\s+MON_EXTSPECIES\b/m.test(data)) return { variant: "9-bit-forms", detail: "species have an extra bit beside the form (MON_EXTSPECIES)", source: "constants/pokemon_data_constants.asm" };
		if (item === "db") return { variant: "8-bit", detail: "itemball stores the item with db, and there are no 16-bit index tables", source: macros.get("itemball")!.file };
		return { detail: "the index width can't be read: no 16-bit index tables, and no itemball to read it from", source: table };
	},

	collisionNames(files) {
		const source = "constants/collision_constants.asm";
		const names = new Set(lines(textOr(files, source) ?? "").flatMap((l) => l.match(/^(?:DEF\s+)?COLL_(\w+)\s+EQU\b/i)?.[1] ?? []));
		// Each variant needs every name the porter writes in it.
		const check = (variant: "pit-hop" | "hole-ledge", what: string): Detected => {
			const missing = writtenCollisionNames(variant).filter((n) => !names.has(n));
			if (missing.length) return { detail: `collision constants have ${what}, but no ${missing.map((n) => `COLL_${n}`).join(", ")}`, source };
			return { variant, detail: `collision constants use ${what} (${names.size} names)`, source };
		};
		if (names.has("PIT") && names.has("HOP_DOWN")) return check("pit-hop", "PIT and HOP_*");
		if (names.has("HOLE") && names.has("LEDGE_DOWN")) return check("hole-ledge", "HOLE and LEDGE_*");
		return { detail: names.size ? "collision constants have neither PIT and HOP_* nor HOLE and LEDGE_*" : "collision constants weren't found", source };
	},

	eventFlags(files) {
		const source = "constants/event_flags.asm";
		const raw = (textOr(files, source) ?? "").split(/\r?\n/);
		const ls = raw.map(stripComment);
		const numAt = ls.findIndex((l) => /^(?:DEF\s+)?NUM_EVENTS\s+EQU\b/.test(l));
		let padAt = numAt - 1;
		while (padAt > 0 && !ls[padAt]) padAt--;
		const pad = numAt > 0 ? ls[padAt]?.match(/^const_next\s+(\S+)/) : null;
		const cap = pad ? parseNumber(pad[1]!) : undefined;
		if (cap === undefined) return { detail: numAt < 0 ? "event flags have no NUM_EVENTS" : "event flags aren't padded by const_next before NUM_EVENTS", source };
		let value = 0;
		const unused = raw.slice(0, padAt).filter((l) => /^\s*const_skip\s*;\s*unused/.test(l)).length;
		for (const l of ls.slice(0, padAt)) {
			let m: RegExpMatchArray | null;
			if ((m = l.match(/^const_def(?:\s+(\S+))?/))) value = m[1] ? (parseNumber(m[1]) ?? 0) : 0;
			else if ((m = l.match(/^const_skip(?:\s+(\S+))?/))) value += m[1] ? (parseNumber(m[1]) ?? 1) : 1;
			else if ((m = l.match(/^const_next\s+(\S+)/))) value = parseNumber(m[1]!) ?? value;
			else if (/^const\s+\w/.test(l)) value++;
		}
		return { variant: "padded", detail: `event flags are padded to ${cap} by const_next (${value} places taken, ${unused} of them marked unused)`, source };
	},

	startingFlags(files) {
		const script = "engine/events/std_scripts.asm", list = "data/events/initialize_events.asm";
		const st = textOr(files, script) ?? "";
		if (/^InitializeEventsScript:/m.test(st) && /^\s*setevent\s+EVENT_INITIALIZED_EVENTS\b/m.test(st)) {
			return { variant: "initialize-events-script", detail: "starting flags are set by InitializeEventsScript", source: script };
		}
		if (/^InitialEvents:/m.test(textOr(files, list) ?? "")) return { variant: "initial-events-list", detail: "starting flags are listed under InitialEvents:", source: list };
		return { detail: "starting flags are in neither InitializeEventsScript nor an InitialEvents: list", source: script };
	},

	trainerParties(files) {
		const source = "data/trainers/parties.asm";
		const ls = lines(textOr(files, source) ?? "");
		if (!ls.length) return { detail: `${source} doesn't exist`, source };
		if (ls.some((l) => /^def_trainer\b/.test(l))) return { variant: "def-trainer", detail: "trainer parties use def_trainer", source };
		const flags = /^\s*DEF\s+TRAINERTYPE_MOVES\s+EQU\s+1\s*<</m.test(textOr(files, "constants/trainer_data_constants.asm") ?? "");
		if (ls.some((l) => /^next_list_item\b/.test(l))) {
			if (flags) return { variant: "list-items", detail: "trainer parties use next_list_item, with TRAINERTYPE_* as bit flags", source };
			return { detail: "trainer parties use next_list_item, but TRAINERTYPE_* aren't bit flags", source };
		}
		if (ls.some((l) => /^db\s+\d+\s*,\s*[A-Z]\w*/.test(l))) return { variant: "rows", detail: "trainer parties have one db row per Pokémon", source };
		return { detail: "trainer parties are in a format the porter hasn't seen", source };
	},

	boulders(_files, macros) {
		if (macros.has("usestonetable")) return { variant: "usestonetable", detail: "falling boulders use usestonetable", source: macros.get("usestonetable")!.file };
		if (macros.has("stonetable") && macros.has("cmdqueue")) return { variant: "stonetable-cmdqueue", detail: "falling boulders use a stonetable in a cmdqueue", source: macros.get("stonetable")!.file };
		return { detail: "there's no stonetable macro", source: "macros/scripts/maps.asm" };
	},
};

/** What every probe finds in the project. */
export function detectFeatures(files: ProjectFiles): Record<FeatureId, Detected> {
	const macros = projectMacros(files);
	const out = {} as Record<FeatureId, Detected>;
	for (const id of FEATURE_IDS) out[id] = PROBES[id](files, macros);
	return out;
}

/** The last detection per project, kept while no file or folder the probes looked at changes. */
const detections = new Map<string, { looked: string[]; stamp: string; detected: Record<FeatureId, Detected> }>();

const stampOf = (root: string, paths: string[]) =>
	paths.map((p) => {
		try {
			const s = statSync(join(root, p));
			return `${s.mtimeMs}:${s.size}`;
		} catch {
			return "-";
		}
	}).join("|");

function detectCached(files: ProjectFiles): Record<FeatureId, Detected> {
	const key = resolve(files.root).toLowerCase();
	const last = detections.get(key);
	if (last && stampOf(files.root, last.looked) === last.stamp) return last.detected;
	const looked = new Set<string>();
	const watched: ProjectFiles = {
		...files,
		text: (p) => (looked.add(p), files.text(p)),
		exists: (p) => (looked.add(p), files.exists(p)),
		list: (d) => (looked.add(d), files.list(d)),
	};
	const detected = detectFeatures(watched);
	detections.set(key, { looked: [...looked], stamp: stampOf(files.root, [...looked]), detected });
	return detected;
}

interface FeaturesFile {
	$comment?: string;
	overrides: Partial<Record<FeatureId, string>>;
}

const COMMENT = "Features this project is treated as having, where the porter's detection is overridden (in the page's Folders panel).";
/** Where a project's feature overrides are saved. */
export const featuresPath = (projectRoot: string) => join(projectToolDir(projectRoot), "features.json");

export function readOverrides(projectRoot: string): Partial<Record<FeatureId, string>> {
	const overrides = readJsonFile<FeaturesFile>(featuresPath(projectRoot), { overrides: {} }).overrides ?? {};
	// An override only counts for a feature and variant the porter still knows.
	return Object.fromEntries(Object.entries(overrides).filter(([id, v]) => FEATURE_IDS.includes(id as FeatureId) && isSupported(id as FeatureId, v)));
}

/** Set (or, with undefined, clear) one feature's override for a project. With none left, the file goes. */
export function saveOverride(projectRoot: string, id: FeatureId, variant: string | undefined): void {
	const path = featuresPath(projectRoot);
	if (variant === undefined && !existsSync(path)) return;
	let left = 0;
	updateJsonFile<FeaturesFile>(path, { overrides: {} }, (file) => {
		const overrides = { ...file.overrides };
		if (variant === undefined) delete overrides[id];
		else overrides[id] = variant;
		left = Object.keys(overrides).length;
		return { $comment: file.$comment ?? COMMENT, overrides };
	});
	if (!left) rmSync(path, { force: true });
}

/** A project's features: what the probes detect, with its saved overrides applied. */
export function projectFeatures(files: ProjectFiles): ProjectFeatures {
	return describeFeatures(detectCached(files), readOverrides(files.root));
}

/** The variants in effect for the features some code needs, or an error naming each one it can't handle. */
export function formatsOf<F extends FeatureId>(files: ProjectFiles, ids: readonly F[]): Formats<F> {
	return need(projectFeatures(files), ids);
}
