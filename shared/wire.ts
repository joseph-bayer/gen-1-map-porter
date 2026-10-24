// JSON shapes the server sends the page, and their conversion back to the shared types.
// Byte arrays travel as base64; sets and maps as arrays.

import type { Gen1Collision, CollKind } from "./coll.js";
import type { FeatureState, Supported } from "./features.js";
import type { Mapping } from "./mapping.js";
import type { GameMap, Palette, TimeOfDay, Tileset } from "./types.js";

function toBase64(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

function fromBase64(text: string): Uint8Array {
	const s = atob(text);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

export interface WireTileset extends Omit<Tileset, "tiles" | "blocks" | "attrs" | "palMap"> {
	tiles: string;
	blocks: string;
	attrs?: string;
	palMap?: string;
}

export interface WireMap extends Omit<GameMap, "blocks" | "tileset"> {
	blocks: string;
	tileset: WireTileset;
}

export interface WireGen1Collision {
	tileset: string;
	walkable: number[];
	warps: number[];
	doors: number[];
	water: number[];
	grass?: number;
	counters: number[];
	ledges: [number, CollKind][];
	landPairs: string[];
	waterPairs: string[];
	carpets: Record<"up" | "down" | "left" | "right", number[]>;
}

/** A project's features for the Folders panel (GET /api/features; null when no project is chosen). */
export interface WireFeatures {
	looksLike?: string;
	features: (FeatureState & {
		variantLabel?: string;
		/** The detected variant's label, when it is one the porter knows. */
		detectedLabel?: string;
		/** Why the porter can't handle this feature's variant, if it can't. */
		refusal?: string;
		/** The variants an override can pick. */
		choices: { variant: string; label: string }[];
	})[];
}

export interface PortEntrySummary {
	gen1Const: string;
	game: string;
	cseName: string;
	cseConst: string;
}

export interface WirePortContext {
	gen1Const: string;
	entry: Record<string, unknown>;
	warpColl: string;
	gen1Map: WireMap;
	gen1Coll: WireGen1Collision;
	cseTileset: WireTileset;
	csePalettes: Record<TimeOfDay, Palette[]>;
	csePinnedTime?: TimeOfDay;
	/** What the project calls each time of day (its bg_tiles.pal sections). */
	timeNames: Record<TimeOfDay, string>;
	collisionNames: string[];
	/** The project's set of collision names, which built blocks and warp squares are written in. */
	collisionSet: Supported<"collisionNames">;
	mapping: Mapping;
	/** False when this tileset pair has no saved mapping yet (the page pre-fills it). */
	mappingSaved: boolean;
	/** Blocks this tool appended to the tileset that no map uses any more. */
	unusedAdded: number[];
	/** Fingerprint check against the current tileset (shared/fingerprint.ts). */
	reconciled: { moved: { gen1: number; what: string }[]; changed: number[] };
	/** Changes when any file behind this context changes (GET /api/port/version). */
	version: string;
	/** Gen 1 names in this map's events with no CSE match yet, to pick in the page. */
	missing: { kind: "sprite" | "palette" | "item" | "class" | "species"; gen1: string; suggestion?: string }[];
	/** Squares an event gives its own collision (Mart and Poké Center signs, trash cans), where the project does that. */
	collisionSquares: { x: number; y: number; coll: string }[];
	/** What this map's events come to. */
	events: { items: number; hiddenItems: number; signs: number; people: number; trainers: number; notes: string[]; marks: { x: number; y: number; kind: "item" | "hidden" | "sign" | "boulder" | "hole" | "person" | "trainer" | "unplaced"; label: string }[] };
	used: number[];
}

export function tilesetToWire(t: Tileset): WireTileset {
	return { ...t, tiles: toBase64(t.tiles), blocks: toBase64(t.blocks), attrs: t.attrs && toBase64(t.attrs), palMap: t.palMap && toBase64(t.palMap) };
}

export function tilesetFromWire(t: WireTileset): Tileset {
	return { ...t, tiles: fromBase64(t.tiles), blocks: fromBase64(t.blocks), attrs: t.attrs ? fromBase64(t.attrs) : undefined, palMap: t.palMap ? fromBase64(t.palMap) : undefined };
}

export function mapToWire(m: GameMap): WireMap {
	return { ...m, blocks: toBase64(m.blocks), tileset: tilesetToWire(m.tileset) };
}

export function mapFromWire(m: WireMap): GameMap {
	return { ...m, blocks: fromBase64(m.blocks), tileset: tilesetFromWire(m.tileset) };
}

export function collToWire(c: Gen1Collision): WireGen1Collision {
	return {
		tileset: c.tileset,
		walkable: [...c.walkable],
		warps: [...c.warps],
		doors: [...c.doors],
		water: [...c.water],
		grass: c.grass,
		counters: [...c.counters],
		ledges: [...c.ledges],
		landPairs: [...c.landPairs],
		waterPairs: [...c.waterPairs],
		carpets: c.carpets,
	};
}

export function collFromWire(c: WireGen1Collision): Gen1Collision {
	return {
		tileset: c.tileset,
		walkable: new Set(c.walkable),
		warps: new Set(c.warps),
		doors: new Set(c.doors),
		water: new Set(c.water),
		grass: c.grass,
		counters: new Set(c.counters),
		ledges: new Map(c.ledges),
		landPairs: new Set(c.landPairs),
		waterPairs: new Set(c.waterPairs),
		carpets: c.carpets,
	};
}
