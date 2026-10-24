// Route B: a Gen 1 tileset mapped onto a CSE tileset, block by block (or tile by tile), and
// what that mapping produces for one map.

import { COLLISION_NAMES, cseKind, gen1BlockKinds, gen1PairBlocked, isWalkable, QUADRANT_TILE, wallSides, type CollKind, type Gen1Collision } from "./coll.js";
import type { Supported } from "./features.js";
import { pickToIdAttr, type TilePick } from "./tile-layout.js";
import type { GameMap, Tileset } from "./types.js";

export type { TilePick } from "./tile-layout.js";

export interface BlockPairing {
	/** Paired with an existing CSE block. */
	cse?: number;
	/** Or built from 16 picked tiles, row by row. */
	tiles?: TilePick[];
	/** Collision names (TL, TR, BL, BR) that override the CSE block's (or the Gen 1-derived) ones. */
	coll?: string[];
	/**
	 * Or the same CSE block as another Gen 1 block's (its decimal id). For new blocks, which have no
	 * fixed number until they're ported; the link follows that block's later edits.
	 */
	sameAs?: number;
	/** Fingerprint of the CSE block when paired (shared/fingerprint.ts). */
	fp?: string;
	/** Fingerprints of each picked tile's pixels when picked. */
	tileFps?: string[];
}

export interface Mapping {
	version: 1;
	gen1Tileset: string; // e.g. CAVERN
	cseTileset: string; // e.g. TILESET_CAVE
	/** Gen 1 block id (decimal string) -> pairing. */
	blocks: Record<string, BlockPairing>;
	/** D17: "append" adds new blocks to the CSE tileset; "copy" means copy it first (not built yet). */
	newBlocks: "append" | "copy";
	/** The CSE tileset's tile and block fingerprints when last saved (shared/fingerprint.ts). */
	snapshot?: { tiles: string[]; blocks: string[] };
}

export function emptyMapping(gen1Tileset: string, cseTileset: string): Mapping {
	return { version: 1, gen1Tileset, cseTileset, blocks: {}, newBlocks: "append" };
}

/** The collision name a Gen 1 kind becomes in a built block. */
export interface CollDefaults {
	warp: string; // e.g. LADDER for caves
	/** The project's collision names. */
	names: Supported<"collisionNames">;
}

export function defaultCollName(kind: CollKind, defaults: CollDefaults): string {
	const names = COLLISION_NAMES[defaults.names];
	return kind === "warp" ? defaults.warp : kind === "other" ? names.wall : names[kind];
}

export interface ResolvedBlock {
	meta: number[]; // 16
	attr: number[]; // 16
	coll: string[]; // 4
}

export interface BlockResult {
	gen1: number;
	/** The CSE block id this Gen 1 block becomes, if paired. */
	cse?: number;
	/** True when the CSE block is new (appended by this mapping). */
	isNew?: boolean;
	gen1Kinds: CollKind[];
	cseColl?: string[];
	/** Quadrants whose CSE kind differs from Gen 1's. */
	conflicts: number[];
	/** Linked (sameAs) to this Gen 1 block's CSE block. */
	linkedTo?: number;
	/** Linked, but that Gen 1 block has no block of its own (cleared, unused, or linked itself). */
	brokenLink?: boolean;
}

export interface MappingResult {
	/** gen1 block -> result, for every Gen 1 block the maps use (plus border blocks). */
	blocks: Map<number, BlockResult>;
	/** Blocks to append to the CSE tileset, in id order from the tileset's current count. */
	appended: ResolvedBlock[];
	unpaired: number[];
}

function sameBlock(ts: Tileset, id: number, b: ResolvedBlock): boolean {
	for (let i = 0; i < 16; i++) {
		if (ts.blocks[id * 16 + i] !== b.meta[i] || ts.attrs?.[id * 16 + i] !== b.attr[i]) return false;
	}
	for (let q = 0; q < 4; q++) if (ts.collision?.[id * 4 + q] !== b.coll[q]) return false;
	return true;
}

function blockOf(ts: Tileset, id: number): ResolvedBlock {
	return {
		meta: [...ts.blocks.subarray(id * 16, id * 16 + 16)],
		attr: [...(ts.attrs ?? new Uint8Array(ts.blocks.length)).subarray(id * 16, id * 16 + 16)],
		coll: (ts.collision ?? []).slice(id * 4, id * 4 + 4),
	};
}

/**
 * Resolve every Gen 1 block `used` against the CSE tileset. A pairing with an existing block and
 * no collision override uses that block; anything else is a built block, reused if an identical
 * block (tiles, attributes and collision) already exists, appended otherwise.
 */
export function resolveMapping(
	mapping: Mapping,
	gen1: Tileset,
	gen1Coll: Gen1Collision,
	cse: Tileset,
	used: number[],
	defaults: CollDefaults,
): MappingResult {
	const blocks = new Map<number, BlockResult>();
	const appended: ResolvedBlock[] = [];
	const unpaired: number[] = [];
	const findOrAppend = (b: ResolvedBlock): { id: number; isNew: boolean } => {
		for (let id = 0; id < cse.blockCount; id++) if (sameBlock(cse, id, b)) return { id, isNew: false };
		const k = appended.findIndex((a) => a.meta.every((v, i) => v === b.meta[i]) && a.attr.every((v, i) => v === b.attr[i]) && a.coll.every((v, i) => v === b.coll[i]));
		if (k >= 0) return { id: cse.blockCount + k, isNew: true };
		appended.push(b);
		return { id: cse.blockCount + appended.length - 1, isNew: true };
	};

	/** A Gen 1 block's own pairing (not a link) as a CSE block id and its collision. */
	const own = new Map<number, { id: number; isNew: boolean; coll: string[] } | undefined>();
	const resolveOwn = (g: number) => {
		if (own.has(g)) return own.get(g);
		const pairing = mapping.blocks[String(g)];
		const gen1Kinds = gen1BlockKinds(gen1Coll, gen1.blocks, g);
		let out: { id: number; isNew: boolean; coll: string[] } | undefined;
		if (pairing?.tiles && pairing.tiles.length === 16) {
			const parts = pairing.tiles.map((t) => pickToIdAttr(t, cse));
			const b: ResolvedBlock = {
				meta: parts.map((p) => p.id),
				attr: parts.map((p) => p.attr),
				coll: pairing.coll ?? gen1Kinds.map((k) => defaultCollName(k, defaults)),
			};
			out = { ...findOrAppend(b), coll: b.coll };
		} else if (pairing?.cse !== undefined && pairing.cse < cse.blockCount) {
			if (pairing.coll) out = { ...findOrAppend({ ...blockOf(cse, pairing.cse), coll: pairing.coll }), coll: pairing.coll };
			else out = { id: pairing.cse, isNew: false, coll: (cse.collision ?? []).slice(pairing.cse * 4, pairing.cse * 4 + 4) };
		}
		own.set(g, out);
		return out;
	};

	for (const g of used) {
		const gen1Kinds = gen1BlockKinds(gen1Coll, gen1.blocks, g);
		// A link takes the CSE block of the Gen 1 block it follows, which must have one of its own.
		// That block needn't be on this map: the mapping is shared by every map on the tileset pair.
		const to = mapping.blocks[String(g)]?.sameAs;
		const r = to === undefined ? resolveOwn(g) : mapping.blocks[String(to)]?.sameAs === undefined ? resolveOwn(to) : undefined;
		if (!r) {
			unpaired.push(g);
			blocks.set(g, { gen1: g, gen1Kinds, conflicts: [], ...(to !== undefined && { linkedTo: to, brokenLink: true }) });
			continue;
		}
		const conflicts = [0, 1, 2, 3].filter((q) => cseKind(r.coll[q] ?? "") !== gen1Kinds[q]);
		blocks.set(g, { gen1: g, cse: r.id, isNew: r.isNew, gen1Kinds, cseColl: r.coll, conflicts, ...(to !== undefined && { linkedTo: to }) });
	}
	return { blocks, appended, unpaired };
}

/** The CSE tileset with the mapping's appended blocks added (for rendering a preview). */
export function withAppended(cse: Tileset, appended: ResolvedBlock[]): Tileset {
	if (!appended.length) return cse;
	const n = cse.blockCount + appended.length;
	const blocks = new Uint8Array(n * 16), attrs = new Uint8Array(n * 16);
	blocks.set(cse.blocks);
	attrs.set(cse.attrs ?? new Uint8Array(cse.blocks.length));
	appended.forEach((b, k) => {
		blocks.set(b.meta, (cse.blockCount + k) * 16);
		attrs.set(b.attr, (cse.blockCount + k) * 16);
	});
	return { ...cse, blocks, attrs, blockCount: n, collision: [...(cse.collision ?? []), ...appended.flatMap((b) => b.coll)] };
}

/** The ported map's blocks, or undefined where a Gen 1 block is unpaired. */
export function mapBlocks(gen1Map: GameMap, result: MappingResult): (number | undefined)[] {
	return [...gen1Map.blocks].map((g) => result.blocks.get(g)?.cse);
}

export interface WalkIssue {
	x: number; // square, 0-based
	y: number;
	gen1: CollKind;
	cse: CollKind | "unpaired";
}

export interface PairEdge {
	x: number; // the square on the left/top of the edge
	y: number;
	dir: "right" | "down";
	/** True when the player can cross in the result: both squares walkable, and no edge wall between. */
	crossable: boolean;
}

/**
 * Per-square comparison of Gen 1 walkability with the result's, and Gen 1's elevation edges.
 * `grid` is the result's CSE block per map position (finalGrid), `cseResult` the tileset with
 * every appended block.
 */
export function walkabilityDiff(gen1Map: GameMap, gen1Coll: Gen1Collision, grid: (number | undefined)[], cseResult: Tileset) {
	const w = gen1Map.width * 2, h = gen1Map.height * 2;
	const gen1Tile = (x: number, y: number) => {
		const block = gen1Map.blocks[(y >> 1) * gen1Map.width + (x >> 1)] ?? 0;
		return gen1Map.tileset.blocks[block * 16 + QUADRANT_TILE[(y & 1) * 2 + (x & 1)]!] ?? 0;
	};
	const cseNameAt = (x: number, y: number): string | undefined => {
		const id = grid[(y >> 1) * gen1Map.width + (x >> 1)];
		if (id === undefined) return undefined;
		return cseResult.collision?.[id * 4 + (y & 1) * 2 + (x & 1)] ?? "";
	};
	const cseKindAt = (x: number, y: number): CollKind | "unpaired" => {
		const name = cseNameAt(x, y);
		return name === undefined ? "unpaired" : cseKind(name);
	};
	/** Whether a CSE edge wall sits on the side between (x, y) and its neighbor in `dir`. */
	const edgeWalled = (x: number, y: number, dir: "right" | "down"): boolean => {
		const [nx, ny, near, far] = dir === "right" ? [x + 1, y, "right", "left"] as const : [x, y + 1, "down", "up"] as const;
		return wallSides(cseNameAt(x, y) ?? "").includes(near) || wallSides(cseNameAt(nx, ny) ?? "").includes(far);
	};
	const issues: WalkIssue[] = [];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const block = gen1Map.blocks[(y >> 1) * gen1Map.width + (x >> 1)] ?? 0;
			const g = gen1BlockKinds(gen1Coll, gen1Map.tileset.blocks, block)[(y & 1) * 2 + (x & 1)]!;
			const c = cseKindAt(x, y);
			if (c === "unpaired" || isWalkable(g) !== isWalkable(c)) issues.push({ x, y, gen1: g, cse: c });
		}
	}
	const edges: PairEdge[] = [];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			for (const [dx, dy, dir] of [[1, 0, "right"], [0, 1, "down"]] as const) {
				if (x + dx >= w || y + dy >= h) continue;
				if (!gen1PairBlocked(gen1Coll, gen1Tile(x, y), gen1Tile(x + dx, y + dy))) continue;
				const a = cseKindAt(x, y), b = cseKindAt(x + dx, y + dy);
				const crossable = a !== "unpaired" && b !== "unpaired" && isWalkable(a) && isWalkable(b) && !edgeWalled(x, y, dir);
				edges.push({ x, y, dir, crossable });
			}
		}
	}
	return { issues, edges };
}
