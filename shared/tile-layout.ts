// Where a project tileset's tiles sit, and how a block names one: a block holds a tile id per
// cell, plus an attribute byte (palette, VRAM bank, flips) that comes either from the tileset's
// attributes file or from its palette map. Both differ per project (shared/features.ts), so the
// readers, the renderer and the page all go through here.

import type { Formats, Supported } from "./features.js";
import type { Tileset } from "./types.js";

/** The features that decide how a tileset's blocks name tiles and colors. */
export const TILE_FEATURES = ["tileColors", "tilesetSize"] as const;
export type TileFormats = Formats<(typeof TILE_FEATURES)[number]>;

/** One tile of a tile-level pairing: a sheet tile with its palette and flips. */
export interface TilePick {
	tile: number;
	pal: number;
	xflip?: boolean;
	yflip?: boolean;
}

const BANK1 = 0x08;

/** Sheet tiles 0-127 are VRAM bank 0's $00-$7F; 128-255 bank 1's $00-$7F; 256-383 bank 1's $80-$FF. */
const THREE_BANKS = {
	sheetTile: (id: number, bank1: boolean) => (!bank1 ? (id < 0x80 ? id : -1) : id < 0x80 ? 0x80 + id : 0x100 + (id - 0x80)), // bank 0 $80+ is sprites
	place: (t: number) => (t < 0x80 ? { id: t, bank1: false } : { id: t < 0x100 ? t - 0x80 : t - 0x100 + 0x80, bank1: true }),
};

/** Per tileset size: the sheet tile a block's tile id and bank bit show, and back. */
const SHEETS: Record<Supported<"tilesetSize">, { sheetTile(id: number, bank1: boolean): number; place(tile: number): { id: number; bank1: boolean } }> = {
	"384": THREE_BANKS,
	// GFX0 loads into bank 0's $00-$7F, GFX1 into bank 1's $00-$7F and GFX2 into bank 1's $80-$FF:
	// the same places as a 384-tile sheet's.
	"3x128": THREE_BANKS,
	// Sheet tiles 0-95 are VRAM bank 0's $00-$5F, 96-191 bank 1's. The engine drops a tile id's top
	// bit and takes the bank from the palette map, so ids $80-$DF name bank 1 and $60-$7F the font.
	"192": {
		sheetTile: (id, bank1) => ((id & 0x7f) < 0x60 ? (bank1 ? 0x60 : 0) + (id & 0x7f) : -1),
		place: (t) => (t < 0x60 ? { id: t, bank1: false } : { id: 0x80 + (t - 0x60), bank1: true }),
	},
};

/** The sheet tile a block cell shows: its id plus the attribute's bank bit. Gen 1 tilesets use the id as it is. */
export function sheetTile(ts: Tileset, id: number, attr: number): number {
	return ts.formats ? SHEETS[ts.formats.tilesetSize].sheetTile(id, (attr & BANK1) !== 0) : id;
}

/** Whether a tileset's blocks choose each tile's palette and flips (else the palette map gives them). */
export function picksColors(ts: Tileset): boolean {
	return ts.formats?.tileColors === "block-attributes";
}

/** A picked sheet tile as a block's tile id + attribute byte. */
export function pickToIdAttr(pick: TilePick, ts: Tileset): { id: number; attr: number } {
	const { id, bank1 } = SHEETS[ts.formats?.tilesetSize ?? "384"].place(pick.tile);
	if (ts.formats?.tileColors === "palette-map") return { id, attr: ts.palMap?.[id] ?? 0 };
	const attr = (pick.pal & 7) | (bank1 ? BANK1 : 0) | (pick.xflip ? 0x20 : 0) | (pick.yflip ? 0x40 : 0);
	return { id, attr };
}

/** The reverse of pickToIdAttr, for starting a tile-level pairing from an existing block. */
export function idAttrToPick(id: number, attr: number, ts: Tileset): TilePick {
	const tile = sheetTile(ts, id, attr);
	return { tile: tile < 0 ? id : tile, pal: attr & 7, xflip: (attr & 0x20) !== 0, yflip: (attr & 0x40) !== 0 };
}

/** The palette a palette map gives a sheet tile (palette-map tilesets only). */
export function sheetTilePalette(ts: Tileset, tile: number): number {
	return pickToIdAttr({ tile, pal: 0 }, ts).attr & 7;
}

/** Each block cell's attribute byte, from a palette map (one value per tile id). */
export function attrsFromPaletteMap(blocks: Uint8Array, palMap: Uint8Array): Uint8Array {
	return blocks.map((id) => palMap[id] ?? 0);
}
