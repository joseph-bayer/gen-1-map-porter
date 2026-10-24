// Collision on both sides, reduced to a common "kind" so they can be compared.
//
// Gen 1 decides per tile: the engine tests the bottom-left tile of each 2x2 walkable square
// against per-tileset lists. CSE stores one COLL_* per block quadrant. A quadrant's Gen 1 tile is
// the bottom-left of its 2x2 tiles: block tile 4 (top-left quadrant), 6, 12 and 14.

import { args, constValues, lines, macroCalls, parseNumber } from "./asm.js";
import type { Supported } from "./features.js";
import type { ProjectFiles } from "./types.js";

export type CollKind =
	| "floor" | "wall" | "water" | "warp" | "grass" | "counter"
	| "ledge-down" | "ledge-up" | "ledge-left" | "ledge-right" | "other";

/** Block tile index (0-15) that Gen 1 tests for each quadrant: TL, TR, BL, BR. */
export const QUADRANT_TILE = [4, 6, 12, 14] as const;

export function isWalkable(kind: CollKind): boolean {
	return kind === "floor" || kind === "grass" || kind === "warp" || kind.startsWith("ledge");
}

// ---------------------------------------------------------------------------------------------
// CSE

/** The kind of a CSE collision name (without the COLL_ prefix). */
export function cseKind(name: string): CollKind {
	if (name === "FLOOR" || name === "ICE" || /_WALL$/.test(name)) return "floor"; // *_WALL: floor with a one-way edge
	if (name === "WALL" || name === "BUOY" || name.startsWith("BOOKSHELF") || name.startsWith("PC")) return "wall";
	if (/^(WATER|WHIRLPOOL|WATERFALL|CURRENT)/.test(name)) return "water";
	if (/^(TALL_GRASS|LONG_GRASS)/.test(name)) return "grass";
	if (/^(LADDER|DOOR|STAIRCASE|CAVE|WARP|PIT|HOLE$|AWNING$)/.test(name)) return "warp";
	if (name.startsWith("COUNTER")) return "counter";
	// HOP_* in pret's names, LEDGE_* in Polished Crystal's.
	const ledge = name.match(/^(?:HOP|LEDGE)_(\w+)$/)?.[1];
	if (ledge === "DOWN" || ledge?.startsWith("DOWN_")) return "ledge-down";
	if (ledge === "UP") return "ledge-up";
	if (ledge === "LEFT") return "ledge-left";
	if (ledge === "RIGHT") return "ledge-right";
	return "other";
}

export type Side = "up" | "down" | "left" | "right";

/** What a square's collision can stand for in place of a bg_event, in projects that have it. */
export type CollisionSign = "mart" | "pokecenter" | "trash";

/** The collision names the port writes, per the project's set of names (without the COLL_ prefix). */
export const COLLISION_NAMES: Record<Supported<"collisionNames">, Record<Exclude<CollKind, "warp" | "other">, string> & {
	pit: string;
	carpet: Record<Side, string>;
	/** Where Mart and Poké Center signs and trash cans work by the square's collision, its names for them. */
	signs?: Record<CollisionSign, string>;
}> = {
	"pit-hop": {
		floor: "FLOOR", wall: "WALL", water: "WATER", grass: "TALL_GRASS", counter: "COUNTER",
		"ledge-down": "HOP_DOWN", "ledge-up": "HOP_UP", "ledge-left": "HOP_LEFT", "ledge-right": "HOP_RIGHT",
		pit: "PIT",
		carpet: { down: "WARP_CARPET_DOWN", up: "WARP_CARPET_UP", left: "WARP_CARPET_LEFT", right: "WARP_CARPET_RIGHT" },
	},
	"hole-ledge": {
		floor: "FLOOR", wall: "WALL", water: "WATER", grass: "TALL_GRASS", counter: "COUNTER",
		"ledge-down": "LEDGE_DOWN", "ledge-up": "LEDGE_UP", "ledge-left": "LEDGE_LEFT", "ledge-right": "LEDGE_RIGHT",
		pit: "HOLE",
		carpet: { down: "WARP_CARPET_DOWN", up: "WARP_CARPET_UP", left: "WARP_CARPET_LEFT", right: "WARP_CARPET_RIGHT" },
		signs: { mart: "MART_SIGN", pokecenter: "POKECENTER_SIGN", trash: "TRASH_CAN" },
	},
};

/** Every collision name the port writes in a set of names. */
export const writtenCollisionNames = (set: Supported<"collisionNames">): string[] => {
	const n = COLLISION_NAMES[set];
	return [n.floor, n.wall, n.water, n.grass, n.counter, n["ledge-down"], n["ledge-up"], n["ledge-left"], n["ledge-right"], n.pit, ...Object.values(n.carpet), ...Object.values(n.signs ?? {})];
};

/** Whether a CSE collision fires a warp, and whether it's a carpet (fires on a held direction). */
export function cseWarpType(name: string): "carpet" | "step" | undefined {
	if (name.startsWith("WARP_CARPET_") || name === "CAVE_MOUTH_GLOW") return "carpet";
	return cseKind(name) === "warp" ? "step" : undefined;
}

/**
 * The sides of a square a CSE collision walls off: UP_WALL, DOWN_RIGHT_WALL and so on, and the
 * matching *_BUOY. The engine blocks crossing that side in both directions (leaving and entering),
 * so it is the CSE way to say what Gen 1's elevation pairs say.
 */
export function wallSides(name: string): Side[] {
	const m = name.match(/^((?:UP|DOWN|TOP|BOTTOM)_)?((?:LEFT|RIGHT|UP|DOWN|TOP|BOTTOM))_(?:WALL|BUOY)$/);
	if (!m) return [];
	// TOP_* and BOTTOM_* are Polished Crystal's names for UP_* and DOWN_*.
	const side = (s: string) => ({ top: "up", bottom: "down" } as Record<string, Side>)[s.toLowerCase()] ?? (s.toLowerCase() as Side);
	const sides: Side[] = [side(m[2]!)];
	if (m[1]) sides.push(side(m[1].slice(0, -1)));
	return sides;
}

/** Every COLL_* name (without the prefix) defined in constants/collision_constants.asm. */
export function cseCollisionNames(files: ProjectFiles): string[] {
	const out: string[] = [];
	for (const line of lines(files.text("constants/collision_constants.asm"))) {
		const m = line.match(/^(?:DEF\s+)?COLL_([A-Z0-9_]+)\s+EQU/i);
		if (m) out.push(m[1]!);
	}
	return out;
}

/** A tileset's `tilecoll` lines: 4 names per block. */
export function cseTilesetCollision(files: ProjectFiles, path: string): string[] {
	const out: string[] = [];
	for (const call of macroCalls(files.text(path), "tilecoll")) out.push(...call.slice(0, 4));
	return out;
}

// ---------------------------------------------------------------------------------------------
// Gen 1

export interface Gen1Collision {
	tileset: string;
	walkable: Set<number>;
	warps: Set<number>;
	doors: Set<number>;
	water: Set<number>;
	grass?: number;
	counters: Set<number>;
	/** Ledge tile -> direction (overworld only). */
	ledges: Map<number, CollKind>;
	/** Unordered tile pairs the player can't step between (elevation), as "a,b" with a < b. */
	landPairs: Set<string>;
	waterPairs: Set<string>;
	/** warp_carpet_tile_ids.asm: tiles that let a carpet warp fire when in front of the player, by facing. */
	carpets: Record<Side, number[]>;
}

/**
 * Which extra check a Gen 1 carpet warp must pass on this map (home/overworld.asm, ExtraWarpCheck):
 * "edge" = the player is on the map's edge facing out; "tile" = the tile in front of the player
 * is in the carpet list for the facing.
 */
export function gen1CarpetRule(mapConst: string, tilesetConst: string): "edge" | "tile" {
	if (mapConst === "SS_ANNE_3F") return "edge";
	if (["ROCKET_HIDEOUT_B1F", "ROCKET_HIDEOUT_B2F", "ROCKET_HIDEOUT_B4F", "ROCK_TUNNEL_1F"].includes(mapConst)) return "tile";
	if (["OVERWORLD", "SHIP", "SHIP_PORT", "PLATEAU"].includes(tilesetConst)) return "tile";
	return "edge";
}

const pairKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

/** `Label::` (stacked) followed by `<macro> a, b, ...`: label → values. */
function labelledLists(text: string, macro: string): Map<string, number[]> {
	const out = new Map<string, number[]>();
	let pending: string[] = [];
	for (const line of lines(text)) {
		if (!line) continue;
		const label = line.match(/^([A-Za-z_.][A-Za-z0-9_.]*)::?$/);
		if (label) {
			pending.push(label[1]!);
			continue;
		}
		const m = line.match(new RegExp(`^${macro}(?:\\s+(.*))?$`));
		if (m) {
			const values = m[1] ? args(m[1]).map((a) => parseNumber(a) ?? -1).filter((v) => v >= 0) : [];
			for (const l of pending) out.set(l, values);
		}
		pending = [];
	}
	return out;
}

export function loadGen1Collision(files: ProjectFiles, tilesetConst: string): Gen1Collision {
	const consts = constValues(files.text("constants/tileset_constants.asm"));
	const index = consts.get(tilesetConst);
	if (index === undefined) throw new Error(`no tileset constant ${tilesetConst}`);
	const header = macroCalls(files.text("data/tilesets/tileset_headers.asm"), "tileset")[index];
	if (!header) throw new Error(`no tileset header row for ${tilesetConst}`);
	const name = header[0]!;
	const num = (s: string | undefined) => {
		const v = parseNumber(s ?? "");
		return v === undefined || v < 0 ? undefined : v;
	};

	const walkable = labelledLists(files.text("data/tilesets/collision_tile_ids.asm"), "coll_tiles").get(`${name}_Coll`);
	if (!walkable) throw new Error(`no ${name}_Coll in collision_tile_ids.asm`);

	// Warp tiles: WarpTileIDPointers has one `dw .Label` per tileset, in constant order.
	const warpText = files.text("data/tilesets/warp_tile_ids.asm");
	const warpLabels: string[] = [];
	for (const line of lines(warpText)) {
		const m = line.match(/^dw\s+(\.\w+)/);
		if (m) warpLabels.push(m[1]!);
	}
	const warps = labelledLists(warpText, "warp_tiles").get(warpLabels[index] ?? "") ?? [];

	// Door tiles: `dbw TILESET, .Label`.
	const doorText = files.text("data/tilesets/door_tile_ids.asm");
	let doorLabel: string | undefined;
	for (const line of lines(doorText)) {
		const m = line.match(/^dbw\s+([A-Z0-9_]+)\s*,\s*(\.\w+)/);
		if (m && m[1] === tilesetConst) doorLabel = m[2];
	}
	const doors = doorLabel ? (labelledLists(doorText, "door_tiles").get(doorLabel) ?? []) : [];

	// Water: tile $14 on the tilesets listed in water_tilesets.asm.
	const water = new Set<number>();
	if (files.exists("data/tilesets/water_tilesets.asm")) {
		for (const line of lines(files.text("data/tilesets/water_tilesets.asm"))) {
			const m = line.match(/^db\s+([A-Z0-9_]+)/);
			if (m && m[1] === tilesetConst) water.add(0x14);
		}
	}

	const ledges = new Map<number, CollKind>();
	if (tilesetConst === "OVERWORLD" && files.exists("data/tilesets/ledge_tiles.asm")) {
		const dirs: Record<string, CollKind> = {
			SPRITE_FACING_DOWN: "ledge-down", SPRITE_FACING_UP: "ledge-up",
			SPRITE_FACING_LEFT: "ledge-left", SPRITE_FACING_RIGHT: "ledge-right",
		};
		for (const line of lines(files.text("data/tilesets/ledge_tiles.asm"))) {
			const m = line.match(/^db\s+(SPRITE_FACING_\w+)\s*,\s*(\S+)\s*,\s*(\S+)/);
			const tile = m ? parseNumber(m[3]!.replace(/,$/, "")) : undefined;
			if (m && tile !== undefined && dirs[m[1]!]) ledges.set(tile, dirs[m[1]!]!);
		}
	}

	const landPairs = new Set<string>(), waterPairs = new Set<string>();
	let into: Set<string> | undefined;
	for (const line of lines(files.text("data/tilesets/pair_collision_tile_ids.asm"))) {
		if (line.startsWith("TilePairCollisionsLand")) into = landPairs;
		else if (line.startsWith("TilePairCollisionsWater")) into = waterPairs;
		const m = line.match(/^db\s+([A-Z0-9_]+)\s*,\s*(\S+)\s*,\s*(\S+)/);
		if (m && into && m[1] === tilesetConst) {
			const a = parseNumber(m[2]!.replace(/,$/, "")), b = parseNumber(m[3]!);
			if (a !== undefined && b !== undefined) into.add(pairKey(a, b));
		}
	}

	// Carpet tiles: WarpTileListPointers lists the four facings' lists, down, up, left, right.
	const carpets: Record<Side, number[]> = { down: [], up: [], left: [], right: [] };
	if (files.exists("data/tilesets/warp_carpet_tile_ids.asm")) {
		const text = files.text("data/tilesets/warp_carpet_tile_ids.asm");
		const order: Side[] = ["down", "up", "left", "right"];
		const labels: string[] = [];
		for (const line of lines(text)) {
			const m = line.match(/^dw\s+(\.\w+)/);
			if (m) labels.push(m[1]!);
		}
		const lists = labelledLists(text, "warp_carpet_tiles");
		order.forEach((side, i) => (carpets[side] = lists.get(labels[i] ?? "") ?? []));
	}

	const counters = new Set<number>([num(header[1]), num(header[2]), num(header[3])].filter((v): v is number => v !== undefined));
	return {
		carpets,
		tileset: tilesetConst,
		walkable: new Set(walkable),
		warps: new Set(warps),
		doors: new Set(doors),
		water,
		grass: num(header[4]),
		counters,
		ledges,
		landPairs,
		waterPairs,
	};
}

/** The kind Gen 1 gives a square whose bottom-left tile is `tile` (spec §2.3 order). */
export function gen1Kind(coll: Gen1Collision, tile: number): CollKind {
	if (coll.warps.has(tile) || coll.doors.has(tile)) return "warp";
	const ledge = coll.ledges.get(tile);
	if (ledge) return ledge;
	if (coll.water.has(tile)) return "water";
	if (coll.grass === tile) return "grass";
	if (coll.counters.has(tile)) return "counter";
	if (coll.walkable.has(tile)) return "floor";
	return "wall";
}

/** The four quadrant kinds of a Gen 1 block. */
export function gen1BlockKinds(coll: Gen1Collision, blocks: Uint8Array, block: number): CollKind[] {
	return QUADRANT_TILE.map((i) => gen1Kind(coll, blocks[block * 16 + i] ?? 0));
}

/** Whether Gen 1 forbids stepping between two adjacent squares with these bottom-left tiles. */
export function gen1PairBlocked(coll: Gen1Collision, a: number, b: number): boolean {
	return coll.landPairs.has(pairKey(a, b)) || coll.waterPairs.has(pairKey(a, b));
}
