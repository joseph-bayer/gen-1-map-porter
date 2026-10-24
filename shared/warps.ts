// Warp squares. Gen 1 fires a warp by tile lists and map edges; CSE by the square's collision.
// So each Gen 1 warp square gets the CSE collision that fires it, through a variant of its block
// when the paired block's quadrant isn't already right. The variant is used only at that square.

import { COLLISION_NAMES, cseWarpType, gen1CarpetRule, QUADRANT_TILE, type Gen1Collision, type Side } from "./coll.js";
import type { Supported } from "./features.js";
import { mapBlocks, type MappingResult, type ResolvedBlock } from "./mapping.js";
import type { GameMap, Tileset } from "./types.js";

export interface WarpPlan {
	/** Index into the map's warp events (0-based). */
	index: number;
	x: number;
	y: number;
	/** How Gen 1 fires it: on stepping onto a door/warp tile, or as a carpet (edge or carpet-tile rule). */
	gen1: "step" | "carpet-edge" | "carpet-tile" | "hole";
	/** The CSE collision the square needs, or undefined if none can be worked out (see note). */
	want?: string;
	/** The square's collision from its paired block, before any variant. */
	before?: string;
	note?: string;
}

/** A square an event gives its own collision (not a warp). */
export interface CollisionSquare {
	x: number;
	y: number;
	coll: string;
}

export interface FinalGrid {
	/** CSE block id per map position (undefined = unpaired). */
	grid: (number | undefined)[];
	/** Blocks to append: the mapping's own, then warp variants. */
	appended: ResolvedBlock[];
	warps: WarpPlan[];
}

const DIRS: [Side, number, number][] = [["down", 0, 1], ["up", 0, -1], ["left", -1, 0], ["right", 1, 0]];

/** The Gen 1 tile Gen 1 tests for square (x, y): its block's quadrant tile; off the map, the border block's. */
function gen1SquareTile(map: GameMap, x: number, y: number): number | undefined {
	const w = map.width * 2, h = map.height * 2;
	const block = x >= 0 && y >= 0 && x < w && y < h ? map.blocks[(y >> 1) * map.width + (x >> 1)] : map.borderBlock;
	if (block === undefined) return undefined;
	return map.tileset.blocks[block * 16 + QUADRANT_TILE[(y & 1) * 2 + (x & 1)]!];
}

function blockData(ts: Tileset, id: number): ResolvedBlock {
	return {
		meta: [...ts.blocks.subarray(id * 16, id * 16 + 16)],
		attr: [...(ts.attrs ?? new Uint8Array(ts.blocks.length)).subarray(id * 16, id * 16 + 16)],
		coll: (ts.collision ?? []).slice(id * 4, id * 4 + 4),
	};
}

const same = (a: ResolvedBlock, b: ResolvedBlock) =>
	a.meta.every((v, i) => v === b.meta[i]) && a.attr.every((v, i) => v === b.attr[i]) && a.coll.every((v, i) => v === b.coll[i]);

/**
 * The map's final CSE blocks: the mapping's, with warp squares given the collision that fires
 * them. `cse` is the tileset before this mapping's appends; `warpColl` is the tileset's default
 * warp collision (e.g. LADDER); `collNames` the project's set of collision names. `squares` are
 * other squares an event gives its own collision (a Mart sign, in projects where signs work that way).
 */
export function finalGrid(gen1Map: GameMap, gen1Coll: Gen1Collision, result: MappingResult, cse: Tileset, warpColl: string, collNames: Supported<"collisionNames">, squares: CollisionSquare[] = []): FinalGrid {
	const names = COLLISION_NAMES[collNames];
	const grid = mapBlocks(gen1Map, result);
	const appended = [...result.appended];
	const blockAt = (id: number) => (id < cse.blockCount ? blockData(cse, id) : appended[id - cse.blockCount]!);
	const w = gen1Map.width * 2, h = gen1Map.height * 2;
	const rule = gen1CarpetRule(gen1Map.constName, gen1Map.tileset.constName);

	const warps: WarpPlan[] = [];
	const changes = new Map<number, Map<number, string>>(); // map position -> quadrant -> collision
	(gen1Map.warps ?? []).forEach((warp, index) => {
		const { x, y } = warp;
		const plan: WarpPlan = { index, x, y, gen1: "step" };
		warps.push(plan);
		if (x < 0 || y < 0 || x >= w || y >= h) {
			plan.note = "outside the map";
			return;
		}
		const pos = (y >> 1) * gen1Map.width + (x >> 1);
		const q = (y & 1) * 2 + (x & 1);
		const id = grid[pos];
		plan.before = id === undefined ? undefined : blockAt(id).coll[q];
		const tile = gen1SquareTile(gen1Map, x, y) ?? -1;

		if (gen1Coll.warps.has(tile) || gen1Coll.doors.has(tile)) {
			plan.gen1 = "step";
			plan.want = plan.before && cseWarpType(plan.before) === "step" ? plan.before : warpColl;
		} else if (rule === "edge") {
			plan.gen1 = "carpet-edge";
			const edge = y === h - 1 ? "down" : y === 0 ? "up" : x === 0 ? "left" : x === w - 1 ? "right" : undefined;
			if (edge) plan.want = names.carpet[edge];
			else plan.note = "a carpet off the map edge, which can't fire in Gen 1 either";
		} else {
			plan.gen1 = "carpet-tile";
			const ssAnneBow = gen1Map.constName === "SS_ANNE_BOW";
			const dir = DIRS.find(([side, dx, dy]) => {
				const front = gen1SquareTile(gen1Map, x + dx, y + dy);
				return front !== undefined && (ssAnneBow ? front === 0x15 : gen1Coll.carpets[side].includes(front));
			});
			if (dir) plan.want = names.carpet[dir[0]];
			else plan.note = "no carpet tile beside it, so Gen 1 can't fire it either";
		}
		if (id !== undefined && plan.want && plan.want !== plan.before) {
			if (!changes.has(pos)) changes.set(pos, new Map());
			changes.get(pos)!.set(q, plan.want);
		}
	});

	// Holes: a pit at once, whether or not the map below is ported yet (its warp_event follows the
	// map's Gen 1 warps, so these plans continue their numbering).
	(gen1Map.holes ?? []).forEach((hole, k) => {
		const { x, y } = hole;
		if (x < 0 || y < 0 || x >= w || y >= h) return;
		const pos = (y >> 1) * gen1Map.width + (x >> 1);
		const q = (y & 1) * 2 + (x & 1);
		const id = grid[pos];
		const before = id === undefined ? undefined : blockAt(id).coll[q];
		warps.push({ index: (gen1Map.warps ?? []).length + k, x, y, gen1: "hole", want: names.pit, before });
		if (id !== undefined && before !== names.pit) {
			if (!changes.has(pos)) changes.set(pos, new Map());
			changes.get(pos)!.set(q, names.pit);
		}
	});

	for (const { x, y, coll } of squares) {
		if (x < 0 || y < 0 || x >= w || y >= h) continue;
		const pos = (y >> 1) * gen1Map.width + (x >> 1);
		const id = grid[pos];
		if (id === undefined || blockAt(id).coll[(y & 1) * 2 + (x & 1)] === coll) continue;
		if (!changes.has(pos)) changes.set(pos, new Map());
		changes.get(pos)!.set((y & 1) * 2 + (x & 1), coll);
	}

	for (const [pos, quads] of changes) {
		const base = blockAt(grid[pos]!);
		const variant: ResolvedBlock = { ...base, coll: base.coll.map((c, q) => quads.get(q) ?? c) };
		let id = -1;
		for (let b = 0; b < cse.blockCount && id < 0; b++) if (same(blockData(cse, b), variant)) id = b;
		if (id < 0) {
			const k = appended.findIndex((a) => same(a, variant));
			id = k >= 0 ? cse.blockCount + k : cse.blockCount + appended.push(variant) - 1;
		}
		grid[pos] = id;
	}
	return { grid, appended, warps };
}
