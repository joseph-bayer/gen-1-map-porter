// Draws a map's blocks to RGBA: Gen 1 in its four grays, CSE in its CGB colors.

import { sheetTile } from "./tile-layout.js";
import type { GameMap, Palette, RgbaImage, TimeOfDay } from "./types.js";

const GEN1_SHADES = [255, 170, 85, 0] as const;
const MISSING = [255, 0, 255] as const; // a tile id the sheet doesn't have

/** 5-bit CGB channel to 8 bits. */
export function to8(c: number): number {
	return (c << 3) | (c >> 2);
}

export interface RenderOptions {
	/** CSE: which time of day's colors; a map that pins one uses that instead. */
	time?: TimeOfDay;
}

/** Draw one block (32x32) into `out` at pixel (px, py). */
export function drawBlock(map: GameMap, block: number, out: RgbaImage, px: number, py: number, palettes?: Palette[]): void {
	const ts = map.tileset;
	for (let i = 0; i < 16; i++) {
		const id = ts.blocks[block * 16 + i];
		const attr = ts.attrs?.[block * 16 + i] ?? 0;
		const sheet = id === undefined ? -1 : sheetTile(ts, id, attr);
		const xflip = (attr & 0x20) !== 0, yflip = (attr & 0x40) !== 0;
		const pal = palettes?.[attr & 0x07];
		const tx = px + (i & 3) * 8, ty = py + (i >> 2) * 8;
		for (let y = 0; y < 8; y++) {
			for (let x = 0; x < 8; x++) {
				const o = ((ty + y) * out.width + tx + x) * 4;
				let rgb: readonly [number, number, number];
				if (block >= ts.blockCount || sheet < 0 || sheet >= ts.tileCount) {
					rgb = MISSING;
				} else {
					const sx = xflip ? 7 - x : x, sy = yflip ? 7 - y : y;
					const c = ts.tiles[sheet * 64 + sy * 8 + sx]!;
					if (pal) {
						const p = pal[c]!;
						rgb = [to8(p[0]), to8(p[1]), to8(p[2])];
					} else {
						const g = GEN1_SHADES[c]!;
						rgb = [g, g, g];
					}
				}
				out.rgba[o] = rgb[0];
				out.rgba[o + 1] = rgb[1];
				out.rgba[o + 2] = rgb[2];
				out.rgba[o + 3] = 255;
			}
		}
	}
}

export function renderMap(map: GameMap, options: RenderOptions = {}): RgbaImage {
	const out: RgbaImage = {
		width: map.width * 32,
		height: map.height * 32,
		rgba: new Uint8Array(map.width * 32 * map.height * 32 * 4),
	};
	const time = map.pinnedTime ?? options.time ?? "day";
	const palettes = map.palettes?.[time];
	for (let by = 0; by < map.height; by++) {
		for (let bx = 0; bx < map.width; bx++) {
			drawBlock(map, map.blocks[by * map.width + bx] ?? 0, out, bx * 32, by * 32, palettes);
		}
	}
	return out;
}
