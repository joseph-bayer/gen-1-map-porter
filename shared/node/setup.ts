// Setting up a Gen 1 map for porting: the full map list with each map's status, the setup form's
// starting values and choices, and saving the result into the project's tables/maps.json (and
// tables/tilesets.json).

import { constValues, lines, macroCalls, mapConsts } from "../asm.js";
import { cseCollisionNames, cseWarpType } from "../coll.js";
import { ATTRIBUTE_COLUMNS, HEADER_COLUMNS, headerExtras } from "../cse.js";
import { gen1MapHeaders } from "../gen1.js";
import type { Game, ProjectFiles } from "../types.js";
import { GROUP_STYLES, isPorted } from "./port.js";
import { formatsOf } from "./features.js";
import { gameFiles, type Config } from "./project.js";
import { mapTable, saveMapEntry, saveTilesetEntry, tilesetTable, type MapEntry } from "./tables.js";
import { headerDefaults, type CseMapRow, type Gen1MapRow, type SetupDraft, type SetupForm } from "../setup.js";

export type { Gen1MapRow, SetupDraft, SetupForm } from "../setup.js";

/** The project's map groups, in order, and each map constant's group (a name, or a number where groups have none). */
function mapGroups(files: ProjectFiles): { groups: string[]; groupOf: Map<string, string> } {
	const style = GROUP_STYLES[formatsOf(files, ["mapGroups"]).mapGroups];
	const ls = lines(files.text("constants/map_constants.asm"));
	const groups: string[] = [], groupOf = new Map<string, string>();
	ls.forEach((line, i) => {
		if (/^newgroup\b/.test(line)) groups.push(style.groupAt(ls, i) ?? "");
		const m = line.match(/^map_const\s+(\w+)/);
		if (m) groupOf.set(m[1]!, groups.at(-1) ?? "");
	});
	return { groups, groupOf };
}

/** Every project map's header row, with its constant, group and size. */
export function cseMapRows(files: ProjectFiles): CseMapRow[] {
	const sizes = mapConsts(files.text("constants/map_constants.asm"));
	const { groupOf } = mapGroups(files);
	const formats = formatsOf(files, ["mapHeader", "mapAttributes", "mapGroups"]);
	const col = HEADER_COLUMNS[formats.mapHeader], attr = ATTRIBUTE_COLUMNS[formats.mapAttributes];
	const at = (r: string[], c: number | undefined) => (c === undefined ? "" : r[c] ?? "");
	const constOf = new Map(macroCalls(files.text("data/maps/attributes.asm"), "map_attributes").map((r) => [r[attr.name]!, r[attr.const]!]));
	return macroCalls(files.text("data/maps/maps.asm"), "map").map((r) => {
		const c = constOf.get(r[0]!) ?? "";
		const size = sizes.get(c);
		return {
			name: r[0]!, const: c, group: groupOf.get(c) ?? "", tileset: r[col.tileset] ?? "", environment: r[col.environment] ?? "", landmark: r[col.landmark] ?? "",
			music: r[col.music] ?? "", noPhone: r[col.noPhone] ?? "", palette: r[col.palette] ?? "", fishGroup: at(r, col.fishGroup), sign: at(r, col.sign), width: size?.width ?? 0, height: size?.height ?? 0,
		};
	});
}

export function gen1MapList(config: Config, game: Game): Gen1MapRow[] {
	const cseFiles = gameFiles(config, "cse");
	const table = mapTable(cseFiles.root);
	const cseConsts = mapConsts(cseFiles.text("constants/map_constants.asm"));
	return gen1MapHeaders(gameFiles(config, game)).map((h) => {
		const entry = table[h.constName];
		return {
			gen1Const: h.constName,
			name: h.name,
			tileset: h.tileset,
			status: entry ? (isPorted(cseFiles.root, entry.const) || cseConsts.has(entry.const) ? "ported" : "set up") : "new",
			entryGame: entry?.game,
			nameTaken: !entry && cseConsts.has(h.constName),
		};
	});
}

function constsWithPrefix(text: string, prefix: string): string[] {
	return [...constValues(text).keys()].filter((k) => k.startsWith(prefix));
}

/** The constants of the const_def block that ends at the line defining `endName` (e.g. NUM_ENVIRONMENTS). */
function constBlockBefore(text: string, endName: string): string[] {
	let block: string[] = [];
	for (const line of lines(text)) {
		if (/^const_def\b/.test(line)) block = [];
		const m = line.match(/^const\s+(\w+)/);
		if (m) block.push(m[1]!);
		if (line.includes(endName)) return block;
	}
	return [];
}

export function setupForm(config: Config, game: Game, gen1Const: string): SetupForm {
	const cseFiles = gameFiles(config, "cse");
	const header = gen1MapHeaders(gameFiles(config, game)).find((h) => h.constName === gen1Const);
	if (!header) throw new Error(`no ${game} map ${gen1Const}`);
	const gen1Size = mapConsts(gameFiles(config, game).text("constants/map_constants.asm")).get(gen1Const) ?? { width: 0, height: 0 };
	const cseMaps = cseMapRows(cseFiles);
	const entry = mapTable(cseFiles.root)[gen1Const];
	const tsRow = tilesetTable(cseFiles.root)[header.tileset];
	const dataConsts = cseFiles.text("constants/map_data_constants.asm");
	const landmarkText = cseFiles.text("constants/landmark_constants.asm");
	// Landmarks are LANDMARK_* constants, or (in Polished Crystal) every landmark constant, unprefixed.
	const landmarks = constsWithPrefix(landmarkText, "LANDMARK_");
	// The phone column holds TRUE/FALSE, or 1/0 where the project's rows do.
	const phones = new Set(cseMaps.map((m) => m.noPhone));
	const options: SetupForm["options"] = {
		groups: mapGroups(cseFiles).groups,
		tilesets: constsWithPrefix(cseFiles.text("constants/tileset_constants.asm"), "TILESET_"),
		environments: constBlockBefore(dataConsts, "NUM_ENVIRONMENTS"),
		landmarks: landmarks.length ? landmarks : constBlockBefore(landmarkText, "NUM_LANDMARKS"),
		music: constsWithPrefix(cseFiles.text("constants/music_constants.asm"), "MUSIC_"),
		palettes: constsWithPrefix(dataConsts, "PALETTE_"),
		fishGroups: constsWithPrefix(dataConsts, "FISHGROUP_"),
		signs: constsWithPrefix(dataConsts, "SIGN_"),
		phone: !phones.has("TRUE") && !phones.has("FALSE") && (phones.has("1") || phones.has("0")) ? { off: "1", on: "0" } : { off: "TRUE", on: "FALSE" },
		warpColls: cseCollisionNames(cseFiles).filter((n) => cseWarpType(n) === "step"),
	};
	const extras = headerExtras(formatsOf(cseFiles, ["mapHeader"]).mapHeader);
	const base = { gen1: { name: header.name, const: gen1Const, tileset: header.tileset, ...gen1Size }, warpCollSet: !!tsRow, options, cseMaps, extras };
	const warpColl = tsRow?.warpColl ?? (header.tileset === "CAVERN" ? "LADDER" : "DOOR");

	if (entry) {
		// Map settings for a map already set up.
		const draft: SetupDraft = {
			gen1Const, game: entry.game, name: entry.name, const: entry.const, target: entry.target ?? "new",
			group: entry.group, tileset: entry.tileset ?? tsRow?.cse ?? "", environment: entry.environment, landmark: entry.landmark,
			music: entry.music, noPhone: entry.noPhone, palette: entry.palette, fishGroup: entry.fishGroup ?? "", sign: entry.sign ?? "", warpColl,
		};
		return { ...base, draft, sameNamed: cseMaps.find((m) => m.const === gen1Const && m.const !== entry.const), setUp: true, locked: isPorted(cseFiles.root, entry.const) || cseMaps.some((m) => m.const === entry.const) };
	}
	const sameNamed = cseMaps.find((m) => m.const === gen1Const);
	const tileset = tsRow?.cse ?? sameNamed?.tileset ?? "";
	const draft: SetupDraft = {
		gen1Const, game, target: "new",
		name: sameNamed ? `${header.name}Gen1` : header.name,
		const: sameNamed ? `${gen1Const}_GEN1` : gen1Const,
		tileset, ...headerDefaults(cseMaps, tileset, sameNamed), warpColl,
	};
	return { ...base, draft, sameNamed, setUp: false, locked: false };
}

/** Check a draft and write it to the tables. Returns the problem, if any, and writes nothing then. */
export function saveSetup(config: Config, draft: SetupDraft): string | undefined {
	const form = setupForm(config, draft.game, draft.gen1Const);
	const root = gameFiles(config, "cse").root;
	const table = mapTable(root);
	const existing = table[draft.gen1Const];
	if (form.locked && existing && (draft.const !== existing.const || draft.name !== existing.name)) {
		return `${existing.const} is already ported, so its name and constant can't change; rename by hand or start again`;
	}
	if (!/^[A-Z][A-Z0-9_]*$/.test(draft.const)) return `${draft.const} isn't a constant (capitals, digits and _)`;
	if (!/^[A-Z][A-Za-z0-9]*$/.test(draft.name)) return `${draft.name} isn't a map name (letters and digits, starting with a capital)`;
	if (!form.options.tilesets.includes(draft.tileset)) return "choose a project tileset";
	if (draft.target === "new") {
		if (!form.options.groups.includes(draft.group)) return "choose a group";
		for (const field of ["environment", "landmark", "music", "noPhone", "palette", ...form.extras] as const) {
			if (!draft[field]) return `choose a value for ${field}`;
		}
	}
	const cse = form.cseMaps.find((m) => m.const === draft.const);
	if (draft.target === "replace") {
		if (!cse) return `there's no project map ${draft.const} to replace`;
		if (cse.name !== draft.name) return `${draft.const} is named ${cse.name} in the project`;
		if (cse.width !== form.gen1.width || cse.height !== form.gen1.height) {
			return `${draft.const} is ${cse.width}x${cse.height} in the project but ${form.gen1.width}x${form.gen1.height} in Gen 1, so it can't be replaced; port it as a new map`;
		}
	} else {
		// A set-up map keeps its own constant and name; only other maps' count as taken.
		const ownConst = existing?.const === draft.const, ownName = existing?.name === draft.name;
		if (cse && !ownConst) return `a project map already uses ${draft.const}; pick another constant or replace it`;
		if (!ownName && form.cseMaps.some((m) => m.name === draft.name)) return `a project map is already named ${draft.name}`;
	}
	const clash = Object.entries(table).find(([g, e]) => g !== draft.gen1Const && (e.const === draft.const || e.name === draft.name));
	if (clash) return `${clash[0]} is already set up as ${clash[1].const} (${clash[1].name})`;

	// A replaced map keeps its own header (all but the tileset), so the entry records that.
	const header = draft.target === "replace" && cse ? cse : draft;
	const entry: MapEntry = {
		game: draft.game, name: draft.name, const: draft.const, group: header.group,
		environment: header.environment, landmark: header.landmark, music: header.music, noPhone: header.noPhone,
		palette: header.palette,
		...(form.extras.includes("fishGroup") && { fishGroup: header.fishGroup }),
		...(form.extras.includes("sign") && { sign: header.sign }),
		lastMap: existing?.lastMap ?? null, warps: existing?.warps ?? {},
		tileset: draft.tileset, target: draft.target,
	};
	saveMapEntry(root, draft.gen1Const, entry);
	if (!tilesetTable(root)[form.gen1.tileset]) saveTilesetEntry(root, form.gen1.tileset, { cse: draft.tileset, warpColl: draft.warpColl });
	return undefined;
}
