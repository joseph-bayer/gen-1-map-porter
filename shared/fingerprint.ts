// Fingerprints let pairings survive outside edits: each remembers the CSE block (or picked tiles)
// it was made against. When the tileset changes, a pairing whose content moved to another number
// is re-pointed there, and one whose content changed under the same number is flagged.

import type { Mapping } from "./mapping.js";
import type { Tileset } from "./types.js";

/** FNV-1a over a list of numbers, as 8 hex digits. */
function hash(values: Iterable<number>): string {
	let h = 0x811c9dc5;
	for (const v of values) {
		h ^= v & 0xff;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/** A CSE block's tiles, attributes and collision. */
export function blockFingerprint(ts: Tileset, id: number): string {
	const coll = (ts.collision ?? []).slice(id * 4, id * 4 + 4).join(",");
	const bytes = [...ts.blocks.subarray(id * 16, id * 16 + 16), ...(ts.attrs ?? new Uint8Array(ts.blocks.length)).subarray(id * 16, id * 16 + 16)];
	return `${hash(bytes)}:${hash([...coll].map((c) => c.charCodeAt(0)))}`;
}

/** A sheet tile's 64 pixels. */
export function tileFingerprint(ts: Tileset, tile: number): string {
	return hash(ts.tiles.subarray(tile * 64, tile * 64 + 64));
}

/** Every tile's and block's fingerprint, stored with the mapping when it's saved. */
export function snapshotOf(ts: Tileset): NonNullable<Mapping["snapshot"]> {
	return {
		tiles: [...Array(ts.tileCount).keys()].map((t) => tileFingerprint(ts, t)),
		blocks: [...Array(ts.blockCount).keys()].map((b) => blockFingerprint(ts, b)),
	};
}

export interface Reconcile {
	mapping: Mapping;
	/** Gen 1 block -> what was re-pointed. */
	moved: { gen1: number; what: string }[];
	/** Gen 1 blocks whose pairing content changed under the same number (until confirmed). */
	changed: number[];
	/** True when the mapping differs from the one passed in (re-points or new fingerprints). */
	touched: boolean;
}

/**
 * Check every pairing's fingerprint against the current CSE tileset. Re-points moved content,
 * fills in missing fingerprints from the current content, and lists what changed.
 *
 * Content counts as moved to number j only if j held something else when the mapping was last
 * saved (its snapshot): content copied to j earlier, then edited at the old number, isn't a move.
 * With no snapshot, nothing is re-pointed; changed pairings are only flagged.
 */
export function reconcile(mapping: Mapping, ts: Tileset): Reconcile {
	const snap = mapping.snapshot;
	const arrivedTile = (j: number, fp: string) => snap !== undefined && snap.tiles[j] !== fp;
	const arrivedBlock = (j: number, fp: string) => snap !== undefined && snap.blocks[j] !== fp;
	const blocks: Mapping["blocks"] = {};
	const moved: Reconcile["moved"] = [];
	const changed: number[] = [];
	let touched = false;
	const blockIndex = new Map<string, number[]>();
	for (let b = 0; b < ts.blockCount; b++) {
		const fp = blockFingerprint(ts, b);
		blockIndex.set(fp, [...(blockIndex.get(fp) ?? []), b]);
	}
	const tileIndex = new Map<string, number[]>();
	for (let t = 0; t < ts.tileCount; t++) {
		const fp = tileFingerprint(ts, t);
		tileIndex.set(fp, [...(tileIndex.get(fp) ?? []), t]);
	}

	for (const [key, pairing] of Object.entries(mapping.blocks)) {
		const g = Number(key);
		const p = { ...pairing };
		if (p.cse !== undefined && !p.tiles) {
			const now = p.cse < ts.blockCount ? blockFingerprint(ts, p.cse) : undefined;
			if (!p.fp) {
				if (now) {
					p.fp = now;
					touched = true;
				}
			} else if (p.fp !== now) {
				const elsewhere = blockIndex.get(p.fp)?.find((b) => b !== p.cse && arrivedBlock(b, p.fp!));
				if (elsewhere !== undefined) {
					moved.push({ gen1: g, what: `block $${p.cse.toString(16)} → $${elsewhere.toString(16)}` });
					p.cse = elsewhere;
					touched = true;
				} else changed.push(g);
			}
		}
		if (p.tiles) {
			const fps = p.tileFps ? [...p.tileFps] : [];
			let tileChanged = false;
			p.tiles = p.tiles.map((pick, i) => {
				const now = pick.tile < ts.tileCount ? tileFingerprint(ts, pick.tile) : undefined;
				const was = fps[i];
				if (!was) {
					if (now) fps[i] = now;
					touched = true;
					return pick;
				}
				if (was === now) return pick;
				const elsewhere = tileIndex.get(was)?.find((t) => t !== pick.tile && arrivedTile(t, was));
				if (elsewhere !== undefined) {
					moved.push({ gen1: g, what: `tile $${pick.tile.toString(16)} → $${elsewhere.toString(16)} (cell ${i + 1})` });
					touched = true;
					return { ...pick, tile: elsewhere };
				}
				tileChanged = true;
				return pick;
			});
			p.tileFps = fps;
			if (tileChanged) changed.push(g);
		}
		blocks[key] = p;
	}
	return { mapping: { ...mapping, blocks }, moved, changed, touched };
}

/** The pairing's fingerprints set to the current content (pairing made, or a change confirmed). */
export function stamp(pairing: Mapping["blocks"][string], ts: Tileset): Mapping["blocks"][string] {
	const p = { ...pairing };
	if (p.cse !== undefined && !p.tiles && p.cse < ts.blockCount) p.fp = blockFingerprint(ts, p.cse);
	if (p.tiles) p.tileFps = p.tiles.map((pick) => (pick.tile < ts.tileCount ? tileFingerprint(ts, pick.tile) : ""));
	return p;
}
