// Ranks CSE blocks for a Gen 1 block: matching collision kinds first, then the closest shades.

import { cseKind, type CollKind } from "./coll.js";
import { sheetTile } from "./tile-layout.js";
import type { Tileset } from "./types.js";

/** A block's 32x32 color indexes (0-3), ignoring palettes; flips applied. */
export function blockIndexes(ts: Tileset, block: number): Uint8Array {
	const out = new Uint8Array(1024);
	for (let i = 0; i < 16; i++) {
		const id = ts.blocks[block * 16 + i] ?? 0;
		const attr = ts.attrs?.[block * 16 + i] ?? 0;
		const sheet = sheetTile(ts, id, attr);
		const xflip = (attr & 0x20) !== 0, yflip = (attr & 0x40) !== 0;
		for (let y = 0; y < 8; y++) {
			for (let x = 0; x < 8; x++) {
				const sx = xflip ? 7 - x : x, sy = yflip ? 7 - y : y;
				const v = sheet >= 0 && sheet < ts.tileCount ? ts.tiles[sheet * 64 + sy * 8 + sx]! : 0;
				out[((i >> 2) * 8 + y) * 32 + (i & 3) * 8 + x] = v;
			}
		}
	}
	return out;
}

export interface Suggestion {
	cse: number;
	/** Quadrants whose kind matches Gen 1's (0-4). */
	kindMatches: number;
	/** Mean shade difference per pixel, 0 (same) to 3. */
	shadeDiff: number;
}

export function suggestBlocks(
	gen1: Tileset,
	gen1Block: number,
	gen1Kinds: CollKind[],
	cse: Tileset,
	limit = 8,
): Suggestion[] {
	const g = blockIndexes(gen1, gen1Block);
	const out: Suggestion[] = [];
	for (let b = 0; b < cse.blockCount; b++) {
		const c = blockIndexes(cse, b);
		let diff = 0;
		for (let i = 0; i < 1024; i++) diff += Math.abs(g[i]! - c[i]!);
		let kindMatches = 0;
		for (let q = 0; q < 4; q++) kindMatches += cseKind(cse.collision?.[b * 4 + q] ?? "") === gen1Kinds[q] ? 1 : 0;
		out.push({ cse: b, kindMatches, shadeDiff: diff / 1024 });
	}
	// Matching collision first; the closest shades break ties.
	out.sort((a, b) => b.kindMatches - a.kindMatches || a.shadeDiff - b.shadeDiff);
	return out.slice(0, limit);
}
