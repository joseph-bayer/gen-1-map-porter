// Loads a map and its tileset from a pokered / pokeyellow tree.

import { constValues, labelFiles, lines, macroCalls, mapConsts, parseNumber } from "./asm.js";
import { tilesFromImage } from "./tiles.js";
import type { Game, GameMap, Gen1Hole, Gen1Warp, ProjectFiles, Tileset } from "./types.js";

interface Gen1Header {
	name: string;
	constName: string;
	tileset: string;
	file: string;
}

function headers(files: ProjectFiles): Gen1Header[] {
	const out: Gen1Header[] = [];
	for (const file of files.list("data/maps/headers")) {
		if (!file.endsWith(".asm")) continue;
		const path = `data/maps/headers/${file}`;
		const [call] = macroCalls(files.text(path), "map_header");
		if (call && call.length >= 3) {
			out.push({ name: call[0]!, constName: call[1]!, tileset: call[2]!, file: path });
		}
	}
	return out;
}

/** Every map with a header, by constant. */
export function listGen1Maps(files: ProjectFiles): string[] {
	return headers(files).map((h) => h.constName).sort();
}

/** Every map's label name, constant and tileset, by constant. */
export function gen1MapHeaders(files: ProjectFiles): { name: string; constName: string; tileset: string }[] {
	return headers(files).map(({ name, constName, tileset }) => ({ name, constName, tileset })).sort((a, b) => a.constName.localeCompare(b.constName));
}

/**
 * A map's holes (Seafoam, Victory Road 2F, the Mansion): the squares its script lists
 * (`<X>HolesCoords: dbmapcoord x, y`), the map below (`ld a, MAP` / `ld [wDungeonWarpDestinationMap], a`),
 * and each hole's landing square there (special_warps.asm: DungeonWarpList / DungeonWarpData, hole i
 * of a map below being the entry (map below, i)).
 */
export function gen1Holes(files: ProjectFiles, mapName: string): Gen1Hole[] {
	const path = `scripts/${mapName}.asm`;
	if (!files.exists(path)) return [];
	const ls = lines(files.text(path));
	// `ld a, MAP` / `ld [wDungeonWarpDestinationMap], a` / `ld hl, <coords>` / `call IsPlayerOnDungeonWarp`
	const at = ls.findIndex((l) => /^ld\s+\[wDungeonWarpDestinationMap\],\s*a/.test(l));
	const dest = at > 0 ? ls[at - 1]?.match(/^ld\s+a,\s*(\w+)/)?.[1] : undefined;
	const label = at >= 0 ? ls[at + 1]?.match(/^ld\s+hl,\s*(\.?\w+)/)?.[1] : undefined;
	if (!dest || !label) return [];
	const coords: { x: number; y: number }[] = [];
	let on = false;
	for (const l of ls) {
		if (new RegExp(`^${label.replace(".", "\\.")}:`).test(l) || (label.startsWith(".") && l === `${label}:`)) {
			on = true;
			continue;
		}
		if (!on) continue;
		const m = l.match(/^dbmapcoord\s+(\d+),\s*(\d+)/);
		if (m) coords.push({ x: Number(m[1]), y: Number(m[2]) });
		else if (/^db\s+-1/.test(l)) break;
	}
	// A list can mix holes with other squares (Victory Road 3F's switch): entry i is a hole only
	// when DungeonWarpList has a landing for (map below, i).
	const landings = dungeonLandings(files);
	return coords.flatMap((c, i) => {
		const land = landings.get(`${dest} ${i + 1}`);
		return land ? [{ ...c, dest, land }] : [];
	});
}

/** DungeonWarpList's (map, n) entries with DungeonWarpData's squares, in the same order. */
function dungeonLandings(files: ProjectFiles): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	if (!files.exists("data/maps/special_warps.asm")) return out;
	const ls = lines(files.text("data/maps/special_warps.asm"));
	const list: string[] = [], data: { x: number; y: number }[] = [];
	let part: "list" | "data" | undefined;
	for (const l of ls) {
		if (l.startsWith("DungeonWarpList:")) part = "list";
		else if (l.startsWith("DungeonWarpData:")) part = "data";
		else if (/^\w+:/.test(l)) part = undefined;
		const e = part === "list" && l.match(/^db\s+(\w+),\s*(\d+)/);
		if (e) list.push(`${e[1]} ${Number(e[2])}`);
		const d = part === "data" && l.match(/^fly_warp\s+\w+,\s*(\d+),\s*(\d+)/);
		if (d) data.push({ x: Number(d[1]), y: Number(d[2]) });
	}
	list.forEach((k, i) => data[i] && out.set(k, data[i]!));
	return out;
}

/** The boulders a hole map's script hides and shows when boulder i falls into hole i (in hole order). */
export function gen1BoulderToggles(files: ProjectFiles, mapName: string): { hide: string; show: string }[] {
	const path = `scripts/${mapName}.asm`;
	if (!files.exists(path)) return [];
	const toggles = lines(files.text(path)).flatMap((l) => l.match(/^ld\s+a,\s*(TOGGLE_\w+_BOULDER_\d+)/)?.[1] ?? []);
	const out: { hide: string; show: string }[] = [];
	for (let i = 0; i + 1 < toggles.length; i += 2) out.push({ hide: toggles[i]!, show: toggles[i + 1]! });
	return out;
}

/** TOGGLE_SEAFOAM_ISLANDS_1F_BOULDER_1 → its map constant and object constant (SEAFOAMISLANDS1F_BOULDER1). */
export function toggleObject(toggle: string): { map: string; object: string } | undefined {
	const m = toggle.match(/^TOGGLE_(\w+)_BOULDER_(\d+)$/);
	return m ? { map: m[1]!, object: `${m[1]!.replace(/_/g, "")}_BOULDER${m[2]}` } : undefined;
}

export function loadGen1Tileset(files: ProjectFiles, constName: string): Tileset {
	const index = constValues(files.text("constants/tileset_constants.asm")).get(constName);
	if (index === undefined) throw new Error(`no tileset constant ${constName}`);
	const rows = macroCalls(files.text("data/tilesets/tileset_headers.asm"), "tileset");
	const name = rows[index]?.[0];
	if (!name) throw new Error(`no tileset header row ${index} for ${constName}`);
	const labels = labelFiles(files.text("gfx/tilesets.asm"));
	const gfx = labels.get(`${name}_GFX`);
	const block = labels.get(`${name}_Block`);
	if (!gfx || !block) throw new Error(`no ${name}_GFX / ${name}_Block in gfx/tilesets.asm`);
	const png = gfx.replace(/\.2bpp$/, ".png");
	const { tiles, tileCount } = tilesFromImage(files.image(png), png);
	const blocks = files.bytes(block);
	return {
		constName,
		tiles,
		tileCount,
		blocks,
		blockCount: blocks.length >> 4,
		files: { png, blocks: block },
	};
}

export function loadGen1Map(files: ProjectFiles, game: Game, constName: string): GameMap {
	const header = headers(files).find((h) => h.constName === constName);
	if (!header) throw new Error(`no map_header for ${constName}`);
	const dims = mapConsts(files.text("constants/map_constants.asm")).get(constName);
	if (!dims) throw new Error(`no map_const for ${constName}`);
	const blkPath = labelFiles(files.text("maps.asm")).get(`${header.name}_Blocks`);
	if (!blkPath) throw new Error(`no ${header.name}_Blocks in maps.asm`);
	const blocks = files.bytes(blkPath);
	const notes: string[] = [];
	if (blocks.length !== dims.width * dims.height) {
		notes.push(`${blkPath} is ${blocks.length} bytes, not ${dims.width} x ${dims.height}`);
	}

	let borderBlock: number | undefined;
	const warps: Gen1Warp[] = [];
	const objects = `data/maps/objects/${header.name}.asm`;
	if (files.exists(objects)) {
		const text = files.text(objects);
		for (const line of lines(text)) {
			const m = line.match(/^db\s+(\S+)/);
			if (m) {
				borderBlock = parseNumber(m[1]!);
				break;
			}
		}
		for (const [x, y, dest, warp] of macroCalls(text, "warp_event")) {
			warps.push({ x: parseNumber(x ?? "") ?? 0, y: parseNumber(y ?? "") ?? 0, dest: dest ?? "", warp: parseNumber(warp ?? "") ?? 0 });
		}
	}

	return {
		game,
		name: header.name,
		constName,
		width: dims.width,
		height: dims.height,
		blocks,
		borderBlock,
		warps,
		holes: gen1Holes(files, header.name),
		tileset: loadGen1Tileset(files, header.tileset),
		notes,
	};
}
