// Types shared by the command line, the server and the page.

import type { TileFormats } from "./tile-layout.js";

export interface RgbaImage {
	width: number;
	height: number;
	rgba: Uint8Array; // width * height * 4
}

/** A CGB color, 5 bits per channel. */
export type Rgb5 = readonly [number, number, number];

/** Four colors, index 0 (lightest) to 3 (darkest). */
export type Palette = readonly [Rgb5, Rgb5, Rgb5, Rgb5];

export type Game = "cse" | "yellow" | "red" | "blue";

export const TIMES = ["morn", "day", "nite", "eve"] as const;
export type TimeOfDay = (typeof TIMES)[number];

export interface Tileset {
	/** The tileset's constant, e.g. TILESET_CAVE or CAVERN. */
	constName: string;
	/** Color index (0-3) of every pixel, 64 per tile, in sheet order. */
	tiles: Uint8Array;
	tileCount: number;
	/** 16 tile ids per block. */
	blocks: Uint8Array;
	blockCount: number;
	/** A project's tileset only: 16 attribute bytes per block (from its attributes file, or its palette map). */
	attrs?: Uint8Array;
	/** A project's tileset only: how its blocks name tiles and colors. Gen 1 tilesets have none. */
	formats?: TileFormats;
	/** A palette-map tileset only: each tile id's attribute (palette and VRAM bank), 256 of them. */
	palMap?: Uint8Array;
	/** CSE only: 4 collision names per block (TL, TR, BL, BR), without the COLL_ prefix. */
	collision?: string[];
	/** Where each piece came from, relative to its project. */
	files: Record<string, string>;
}

/** A Gen 1 `warp_event`: its square, and where it leads (warp is 1-based). */
export interface Gen1Warp {
	x: number;
	y: number;
	dest: string;
	warp: number;
}

/** A Gen 1 hole: its square, the map below, and the square it lands on there. */
export interface Gen1Hole {
	x: number;
	y: number;
	dest: string;
	land?: { x: number; y: number };
}

export interface GameMap {
	game: Game;
	/** The map's label name, e.g. UnionCave1F. */
	name: string;
	/** The map's constant, e.g. UNION_CAVE_1F. */
	constName: string;
	width: number; // blocks
	height: number; // blocks
	blocks: Uint8Array;
	borderBlock?: number;
	/** Gen 1 only: the map's warp events, in order. */
	warps?: Gen1Warp[];
	/** Gen 1 only: holes to the map below (they become pit warps). */
	holes?: Gen1Hole[];
	tileset: Tileset;
	/** CSE only: the 8 BG palettes for each time of day. */
	palettes?: Record<TimeOfDay, Palette[]>;
	/** CSE only: the time of day the map pins (PALETTE_NITE etc.), if any. */
	pinnedTime?: TimeOfDay;
	/** CSE only: the map's environment, e.g. CAVE. */
	environment?: string;
	/** Things the renderer doesn't model for this map. */
	notes: string[];
}

/** Read access to one project tree, relative paths with forward slashes. */
export interface ProjectFiles {
	root: string;
	text(path: string): string;
	bytes(path: string): Uint8Array;
	image(path: string): RgbaImage;
	list(dir: string): string[];
	exists(path: string): boolean;
}
