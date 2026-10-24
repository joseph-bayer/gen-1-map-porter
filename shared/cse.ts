// Loads a map, its tileset and its colors from a CrystalShireEngine tree, or any project with the
// same features: each loader takes the variants it reads (shared/features.ts).

import { args, bytesAfterLabel, constValues, labelFiles, lines, macroCalls, mapConsts, parseNumber, rgbPalettes } from "./asm.js";
import { cseTilesetCollision } from "./coll.js";
import type { Formats, Supported } from "./features.js";
import { attrsFromPaletteMap, TILE_FEATURES } from "./tile-layout.js";
import { tilesFromImage } from "./tiles.js";
import { TIMES, type GameMap, type Palette, type ProjectFiles, type TimeOfDay, type Tileset } from "./types.js";

const PINNED_TIMES: Record<string, TimeOfDay> = {
	PALETTE_MORN: "morn",
	PALETTE_DAY: "day",
	PALETTE_NITE: "nite",
	PALETTE_EVE: "eve",
};

/** Special palettes the game loads in place of the environment's (LoadSpecialMapPalette etc.). */
const SPECIAL_PALETTE_TILESETS = [
	"TILESET_POKECOM_CENTER",
	"TILESET_BATTLE_TOWER_INSIDE",
	"TILESET_ICE_PATH",
	"TILESET_HOUSE",
	"TILESET_RADIO_TOWER",
	"TILESET_MANSION",
];

/** The features reading a tileset depends on. */
export const TILESET_FEATURES = TILE_FEATURES;
export type TilesetFormats = Formats<(typeof TILESET_FEATURES)[number]>;
/** The features reading maps depends on. */
export const MAP_FEATURES = ["mapHeader", "mapAttributes", "blockFiles", ...TILESET_FEATURES] as const;
export type MapFormats = Formats<(typeof MAP_FEATURES)[number]>;

/** The header fields only some layouts have: a fish group, or a location sign. */
export type OptionalHeaderField = "fishGroup" | "sign";

/** Where each field sits in a `map` header row, per header layout (column 0 is the map's name). */
export const HEADER_COLUMNS: Record<Supported<"mapHeader">, Record<"tileset" | "environment" | "landmark" | "music" | "noPhone" | "palette", number> & Partial<Record<OptionalHeaderField, number>>> = {
	"fish-group": { tileset: 1, environment: 2, landmark: 3, music: 4, noPhone: 5, palette: 6, fishGroup: 7 },
	sign: { tileset: 1, environment: 2, sign: 3, landmark: 4, music: 5, noPhone: 6, palette: 7 },
};

/** The optional header fields a layout has. */
export const headerExtras = (layout: Supported<"mapHeader">): OptionalHeaderField[] =>
	(["sign", "fishGroup"] as const).filter((f) => HEADER_COLUMNS[layout][f] !== undefined);

/** Where each field sits in a `map_attributes` row, per layout. */
export const ATTRIBUTE_COLUMNS: Record<Supported<"mapAttributes">, Record<"name" | "const" | "border", number>> = {
	"connection-mask": { name: 0, const: 1, border: 2 },
	"connection-lines": { name: 0, const: 1, border: 2 },
	"script-header": { name: 0, const: 1, border: 2 },
};

/**
 * A map's block file, the label data/maps/blocks.asm gives it and the file INCBINed there, per kind
 * of block file. `source` turns an INCBINed file back into the block file the project keeps.
 */
export const BLOCK_FILES: Record<Supported<"blockFiles">, { path(name: string): string; label(name: string): string; incbin(name: string): string; source(incbin: string): string }> = {
	ablk: { path: (name) => `maps/${name}.ablk`, label: (name) => `${name}_Blocks`, incbin: (name) => `maps/${name}.ablk`, source: (incbin) => incbin },
	blk: { path: (name) => `maps/${name}.blk`, label: (name) => `${name}_Blocks`, incbin: (name) => `maps/${name}.blk`, source: (incbin) => incbin },
	// Make compresses the .ablk into the .ablk.lzp the ROM includes.
	"ablk-lzp": { path: (name) => `maps/${name}.ablk`, label: (name) => `${name}_BlockData`, incbin: (name) => `maps/${name}.ablk.lzp`, source: (incbin) => incbin.replace(/\.lzp$/, "") },
};

/** A tileset sheet's part: a label, the sheet tile its first tile lands on, and how many tiles it can hold. */
interface SheetPart {
	label: string;
	at: number;
	size: number;
}

/**
 * The labels a tileset's graphics load from, and the PNG (and the tile it starts at) behind a file
 * INCBINed there, per tileset size. A part with no file behind its label is empty.
 */
const TILE_SHEETS: Record<Supported<"tilesetSize">, { parts: SheetPart[]; png(incbin: string): { png: string; from: number } }> = {
	"384": { parts: [{ label: "vTiles2GFX", at: 0, size: 384 }], png: (incbin) => ({ png: incbin.replace(/\.2bpp\.vtiles2\.lz$/, ".png"), from: 0 }) },
	"192": { parts: [{ label: "GFX", at: 0, size: 192 }], png: (incbin) => ({ png: incbin.replace(/\.2bpp(\.lz)?$/, ".png"), from: 0 }) },
	// Each part is a PNG, or the 128 tiles from the Nth of a PNG (.2bpp.vramN): Make cuts them out.
	"3x128": {
		parts: [{ label: "GFX0", at: 0, size: 128 }, { label: "GFX1", at: 128, size: 128 }, { label: "GFX2", at: 256, size: 128 }],
		png: (incbin) => {
			const m = incbin.replace(/\.lzp?$/, "").match(/^(.*)\.2bpp(?:\.vram([012]))?$/);
			return { png: `${m?.[1] ?? incbin}.png`, from: m?.[2] ? Number(m[2]) * 128 : 0 };
		},
	},
};

/** The label of a tileset's color data, and the files that may label it, per way of coloring tiles. */
const TILE_COLORS: Record<Supported<"tileColors">, { label: string; labels: string[] }> = {
	"block-attributes": { label: "Attr", labels: ["gfx/tilesets.asm", "data/tilesets.asm"] },
	"palette-map": { label: "PalMap", labels: ["gfx/tileset_palette_maps.asm"] },
};

/** Where a tileset's labels are: gfx/tilesets.asm, or data/tilesets.asm with the tileset table (the first wins). */
const TILESET_LABEL_FILES = ["gfx/tilesets.asm", "data/tilesets.asm"];

/** Labels and the files INCBINed or INCLUDEd under them, from the first of these files that has each. */
function labelsIn(files: ProjectFiles, paths: string[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const p of paths) if (files.exists(p)) for (const [k, v] of labelFiles(files.text(p))) if (!out.has(k)) out.set(k, v);
	return out;
}

/** The file a tileset's data is kept in, from the file INCBINed: without Make's compression, and collision as its .asm. */
function tilesetSource(files: ProjectFiles, incbin: string): string {
	const plain = incbin.replace(/\.lzp?$/, "");
	const asm = plain.replace(/\.bin$/, ".asm");
	return plain.endsWith("_collision.bin") && files.exists(asm) ? asm : plain;
}

/**
 * A palette map (`tilepal bank, PAL, ...` lines, eight tiles each, and `db` bytes of two tiles
 * each, also inside `rept`): each tile id's attribute, palette plus the VRAM bank bit.
 */
export function readPaletteMap(files: ProjectFiles, path: string): Uint8Array {
	const pals = constValues(files.text("constants/tileset_constants.asm"));
	const out = new Uint8Array(256);
	let at = 0;
	const put = (nibble: number) => {
		if (at < 256) out[at] = nibble;
		at++;
	};
	const ls = lines(files.text(path));
	for (let i = 0; i < ls.length; i++) {
		const line = ls[i]!;
		const rept = line.match(/^rept\s+(\S+)$/i);
		if (rept) {
			const end = ls.findIndex((l, k) => k > i && /^endr$/i.test(l));
			const body = ls.slice(i + 1, end < 0 ? ls.length : end);
			for (let n = parseNumber(rept[1]!) ?? 0; n > 0; n--) for (const l of body) putBytes(l);
			i = end < 0 ? ls.length : end;
			continue;
		}
		const tp = line.match(/^tilepal\s+(.*)$/);
		if (tp) {
			const [bank, ...names] = args(tp[1]!);
			for (const name of names) {
				const pal = pals.get(`PAL_BG_${name}`);
				if (pal === undefined) throw new Error(`${path}: no palette PAL_BG_${name}`);
				put((pal & 7) | (bank === "1" ? 0x08 : 0));
			}
			continue;
		}
		putBytes(line);
	}
	return out;

	function putBytes(line: string) {
		const db = line.match(/^db\s+(.*)$/);
		if (!db) return;
		for (const a of args(db[1]!)) {
			const v = parseNumber(a) ?? 0;
			put(v & 0x0f);
			put((v >> 4) & 0x0f);
		}
	}
}

interface CseMapRow {
	name: string;
	constName: string;
	borderBlock?: number;
	tileset: string;
	environment: string;
	palette: string;
}

function mapRows(files: ProjectFiles, formats: MapFormats): CseMapRow[] {
	const col = HEADER_COLUMNS[formats.mapHeader], attr = ATTRIBUTE_COLUMNS[formats.mapAttributes];
	const byName = new Map<string, { tileset: string; environment: string; palette: string }>();
	for (const call of macroCalls(files.text("data/maps/maps.asm"), "map")) {
		if (call.length >= 7) byName.set(call[0]!, { tileset: call[col.tileset]!, environment: call[col.environment]!, palette: call[col.palette]! });
	}
	const out: CseMapRow[] = [];
	for (const call of macroCalls(files.text("data/maps/attributes.asm"), "map_attributes")) {
		const header = byName.get(call[attr.name] ?? "");
		if (!header || !call[attr.const]) continue;
		out.push({ name: call[attr.name]!, constName: call[attr.const]!, borderBlock: parseNumber(call[attr.border] ?? ""), ...header });
	}
	return out;
}

/** Every block id used by any map on this tileset (reads only the headers and the .ablk files). */
export function cseTilesetUsage(files: ProjectFiles, tilesetConst: string, formats: Formats<"mapHeader" | "blockFiles">): Set<number> {
	const blocksFiles = labelFiles(files.text("data/maps/blocks.asm"));
	const blockFile = BLOCK_FILES[formats.blockFiles];
	const used = new Set<number>();
	for (const call of macroCalls(files.text("data/maps/maps.asm"), "map")) {
		if (call[HEADER_COLUMNS[formats.mapHeader].tileset] !== tilesetConst) continue;
		const incbin = blocksFiles.get(blockFile.label(call[0]!));
		const path = incbin && blockFile.source(incbin);
		if (path && files.exists(path)) for (const b of files.bytes(path)) used.add(b);
	}
	return used;
}

export function listCseMaps(files: ProjectFiles, formats: MapFormats): string[] {
	return mapRows(files, formats).map((r) => r.constName).sort();
}

/** The source files behind a project's tileset, relative to the project: its attributes file or its palette map. */
/** One PNG behind a tileset's sheet: from its tile `from`, up to `size` tiles land on sheet tile `at`. */
export interface SheetSource {
	png: string;
	from: number;
	at: number;
	size: number;
}

export function cseTilesetFiles(files: ProjectFiles, constName: string, formats: TilesetFormats): { name: string; png: string; pngs: SheetSource[]; blocks: string; attrs?: string; palMap?: string; collision: string } {
	const consts = constValues(files.text("constants/tileset_constants.asm"));
	const index = consts.get(constName);
	if (index === undefined) throw new Error(`no tileset constant ${constName}`);
	const rows = macroCalls(files.text("data/tilesets.asm"), "tileset");
	// The table's first row is the first constant's, unless it has a row for every value from 0 up.
	const tilesetValues = [...consts].filter(([k]) => k.startsWith("TILESET_")).map(([, v]) => v);
	const first = rows.length === tilesetValues.length ? Math.min(...tilesetValues) : 0;
	const name = rows[index - first]?.[0];
	if (!name) throw new Error(`no Tilesets row ${index} for ${constName}`);
	const labels = labelsIn(files, TILESET_LABEL_FILES);
	const sheet = TILE_SHEETS[formats.tilesetSize], colors = TILE_COLORS[formats.tileColors];
	const pngs = sheet.parts.flatMap((part) => {
		const gfx = labels.get(`${name}${part.label}`);
		return gfx ? [{ ...sheet.png(gfx), at: part.at, size: part.size }] : [];
	});
	const meta = labels.get(`${name}Meta`);
	const coll = labels.get(`${name}Coll`);
	const where = TILESET_LABEL_FILES.filter((p) => files.exists(p)).join(" or ");
	if (!pngs.length || !meta || !coll) throw new Error(`${name}: missing ${sheet.parts.map((p) => p.label).join("/")}, Meta or Coll in ${where}`);
	const color = (colors.label === "Attr" ? labels : labelsIn(files, colors.labels)).get(`${name}${colors.label}`);
	if (!color) throw new Error(`${name}: missing ${colors.label} in ${colors.labels.filter((p) => files.exists(p)).join(" or ")}`);
	return {
		name,
		png: pngs[0]!.png,
		pngs,
		blocks: tilesetSource(files, meta),
		...(formats.tileColors === "palette-map" ? { palMap: color } : { attrs: tilesetSource(files, color) }),
		collision: tilesetSource(files, coll),
	};
}

/** A tileset's sheet from its PNGs: each one's tiles at its place, blank tiles where a part has none. */
function sheetTiles(files: ProjectFiles, pngs: SheetSource[]): { tiles: Uint8Array; tileCount: number } {
	if (pngs.length === 1 && pngs[0]!.from === 0 && pngs[0]!.at === 0) return tilesFromImage(files.image(pngs[0]!.png), pngs[0]!.png);
	const parts = pngs.map((p) => {
		const { tiles, tileCount } = tilesFromImage(files.image(p.png), p.png);
		const count = Math.max(0, Math.min(p.size, tileCount - p.from));
		return { at: p.at, tiles: tiles.subarray(p.from * 64, (p.from + count) * 64), count };
	});
	const tileCount = Math.max(...parts.map((p) => p.at + p.count));
	const tiles = new Uint8Array(tileCount * 64);
	for (const p of parts) tiles.set(p.tiles, p.at * 64);
	return { tiles, tileCount };
}

export function loadCseTileset(files: ProjectFiles, constName: string, formats: TilesetFormats): Tileset {
	const { name, png, pngs, blocks: metaPath, attrs: attrPath, palMap: palMapPath, collision: coll } = cseTilesetFiles(files, constName, formats);
	const { tiles, tileCount } = sheetTiles(files, pngs);
	const blocks = files.bytes(metaPath);
	const palMap = palMapPath ? readPaletteMap(files, palMapPath) : undefined;
	const attrs = palMap ? attrsFromPaletteMap(blocks, palMap) : files.bytes(attrPath!);
	const blockCount = blocks.length >> 4;
	// Lines past the last block describe blocks that don't exist, so nothing reads them.
	const allCollision = cseTilesetCollision(files, coll);
	const collision = allCollision.slice(0, blockCount * 4);
	if (attrs.length !== blocks.length || collision.length !== blockCount * 4) {
		throw new Error(`${name}: ${blockCount} blocks, but ${attrs.length / 16} attribute rows and ${allCollision.length / 4} tilecoll lines`);
	}
	return {
		constName,
		tiles,
		tileCount,
		blocks,
		blockCount,
		attrs,
		collision,
		formats: { tileColors: formats.tileColors, tilesetSize: formats.tilesetSize },
		...(palMap && { palMap }),
		files: { png, ...Object.fromEntries([...new Set(pngs.map((p) => p.png))].slice(1).map((p, i) => [`png${i + 2}`, p])), blocks: metaPath, ...(attrPath ? { attrs: attrPath } : { palMap: palMapPath! }), collision: coll },
	};
}

/**
 * The names of the four times of day, morning to the fourth, from the section comments in the
 * project's gfx/tilesets/bg_tiles.pal (`; morn`, `; day`, `; nite`, then `; eve` or `; dark`).
 */
export function timeNames(files: ProjectFiles): Record<TimeOfDay, string> {
	const path = "gfx/tilesets/bg_tiles.pal";
	const found = files.exists(path) ? files.text(path).split(/\r?\n/).flatMap((l) => l.match(/^\s*;\s*(\w+)\s*$/)?.[1] ?? []).slice(0, 4) : [];
	return Object.fromEntries(TIMES.map((t, i) => [t, found.length === 4 ? found[i]! : t])) as Record<TimeOfDay, string>;
}

/** The eight BG palettes for each time of day, for an environment such as CAVE. */
export function environmentPalettes(files: ProjectFiles, environment: string): Record<TimeOfDay, Palette[]> {
	const envValue = constValues(files.text("constants/map_data_constants.asm")).get(environment);
	if (envValue === undefined) throw new Error(`no environment constant ${environment}`);
	const colorsText = files.text("data/maps/environment_colors.asm");
	const tableLabels: string[] = [];
	let inTable = false;
	for (const line of lines(colorsText)) {
		if (line.startsWith("EnvironmentColorsPointers")) inTable = true;
		else if (inTable) {
			const m = line.match(/^d[wr]\s+(\.\w+)/);
			if (m) tableLabels.push(m[1]!);
			else if (line.startsWith("assert_table_length")) break;
		}
	}
	const label = tableLabels[envValue];
	if (!label) throw new Error(`no EnvironmentColorsPointers entry ${envValue} for ${environment}`);
	const indexes = bytesAfterLabel(colorsText, label);
	const all = rgbPalettes(files.text("gfx/tilesets/bg_tiles.pal"));
	const out = {} as Record<TimeOfDay, Palette[]>;
	TIMES.forEach((time, t) => {
		out[time] = indexes.slice(t * 8, t * 8 + 8).map((i) => {
			const pal = all[i];
			if (!pal) throw new Error(`bg_tiles.pal has no palette $${i.toString(16)}`);
			return pal;
		});
	});
	return out;
}

export function loadCseMap(files: ProjectFiles, constName: string, formats: MapFormats): GameMap {
	const row = mapRows(files, formats).find((r) => r.constName === constName);
	if (!row) throw new Error(`no map_attributes/map row for ${constName}`);
	const dims = mapConsts(files.text("constants/map_constants.asm")).get(constName);
	if (!dims) throw new Error(`no map_const for ${constName}`);
	const blockFile = BLOCK_FILES[formats.blockFiles];
	const label = blockFile.label(row.name);
	const incbin = labelFiles(files.text("data/maps/blocks.asm")).get(label);
	if (!incbin) throw new Error(`no ${label} in data/maps/blocks.asm`);
	const blkPath = blockFile.source(incbin);
	const blocks = files.bytes(blkPath);
	const notes: string[] = [];
	if (blocks.length !== dims.width * dims.height) {
		notes.push(`${blkPath} is ${blocks.length} bytes, not ${dims.width} x ${dims.height}`);
	}
	if (SPECIAL_PALETTE_TILESETS.includes(row.tileset)) {
		notes.push(`${row.tileset} loads its own palette in the game; this render uses the ${row.environment} colors`);
	}
	if (row.palette.includes("IN_DARKNESS")) notes.push("the map is dark until Flash; this render shows it lit");
	notes.push("per-group roof tiles and colors, and tile animations, aren't drawn");
	const pin = Object.entries(PINNED_TIMES).find(([p]) => row.palette.includes(p))?.[1];
	return {
		game: "cse",
		name: row.name,
		constName,
		width: dims.width,
		height: dims.height,
		blocks,
		borderBlock: row.borderBlock,
		tileset: loadCseTileset(files, row.tileset, formats),
		palettes: environmentPalettes(files, row.environment),
		pinnedTime: pin,
		environment: row.environment,
		notes,
	};
}
