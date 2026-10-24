// Tile sheets: a 4-shade PNG, 8x8 tiles in rows of 16, into color indexes 0 (white) to 3 (black).

import type { RgbaImage } from "./types.js";

export function tilesFromImage(image: RgbaImage, name: string): { tiles: Uint8Array; tileCount: number } {
	const { width, height, rgba } = image;
	if (width % 8 || height % 8) throw new Error(`${name}: ${width}x${height} isn't a whole number of tiles`);
	const across = width >> 3;
	const tileCount = across * (height >> 3);
	const tiles = new Uint8Array(tileCount * 64);
	for (let t = 0; t < tileCount; t++) {
		const tx = (t % across) * 8, ty = Math.floor(t / across) * 8;
		for (let y = 0; y < 8; y++) {
			for (let x = 0; x < 8; x++) {
				const o = ((ty + y) * width + tx + x) * 4;
				const lum = 0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!;
				tiles[t * 64 + y * 8 + x] = Math.min(3, Math.max(0, Math.round((255 - lum) / 85)));
			}
		}
	}
	return { tiles, tileCount };
}
