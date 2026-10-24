// The setup form's shapes and its header defaults, shared by the server and the page.

import type { Game } from "./types.js";

export interface Gen1MapRow {
	gen1Const: string;
	name: string;
	tileset: string;
	/** ported: the tool wrote it in this project; set up: it has a table entry; new: neither. */
	status: "ported" | "set up" | "new";
	/** The game a set-up map's entry ports from, which may not be the list's game. */
	entryGame?: Game;
	/** A CSE map already uses this constant (only for maps not set up yet). */
	nameTaken: boolean;
}

/** One `map` row of data/maps/maps.asm, with its constant, group and size. */
export interface CseMapRow {
	name: string;
	const: string;
	group: string;
	tileset: string;
	environment: string;
	landmark: string;
	music: string;
	noPhone: string;
	palette: string;
	fishGroup: string;
	/** Empty where the project's header row has no sign column. */
	sign: string;
	width: number;
	height: number;
}

export interface SetupDraft {
	gen1Const: string;
	game: Game;
	name: string;
	const: string;
	target: "new" | "replace";
	group: string;
	tileset: string;
	environment: string;
	landmark: string;
	music: string;
	noPhone: string;
	palette: string;
	fishGroup: string;
	sign: string;
	/** The Gen 1 tileset's warp collision; only saved when its tilesets.json row is new. */
	warpColl: string;
}

export interface SetupForm {
	draft: SetupDraft;
	gen1: { name: string; const: string; tileset: string; width: number; height: number };
	/** The CSE map using the Gen 1 map's constant, if any. */
	sameNamed?: CseMapRow;
	/** The Gen 1 tileset already has a tables/tilesets.json row, so its warp collision is set. */
	warpCollSet: boolean;
	/** The map already has a table entry, so this is its Map settings. */
	setUp: boolean;
	/** Already ported: the name and constant can't change. */
	locked: boolean;
	/** The header fields only some projects have that this one's header row has (fish group, sign). */
	extras: ("fishGroup" | "sign")[];
	options: {
		groups: string[];
		tilesets: string[];
		environments: string[];
		landmarks: string[];
		music: string[];
		palettes: string[];
		fishGroups: string[];
		signs: string[];
		/** The phone column's values: no phone service, and phone works. */
		phone: { off: string; on: string };
		warpColls: string[];
	};
	/** Every CSE map's header, for the most-common defaults and Copy from. */
	cseMaps: CseMapRow[];
}

export const HEADER_FIELDS = ["group", "environment", "landmark", "music", "noPhone", "palette", "fishGroup", "sign"] as const;
export type HeaderValues = Pick<SetupDraft, (typeof HEADER_FIELDS)[number]>;

/** The most common value of a field among `rows`, or "". */
function mostCommon(rows: CseMapRow[], field: keyof CseMapRow): string {
	const counts = new Map<string, number>();
	for (const r of rows) counts.set(String(r[field]), (counts.get(String(r[field])) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** Header values for a new map: the same-named CSE map's, else each field's most common on the tileset. */
export function headerDefaults(cseMaps: CseMapRow[], tileset: string, sameNamed?: CseMapRow): HeaderValues {
	const onTileset = cseMaps.filter((m) => m.tileset === tileset);
	const out = {} as HeaderValues;
	for (const f of HEADER_FIELDS) out[f] = sameNamed ? sameNamed[f] : mostCommon(onTileset, f);
	return out;
}

/** One CSE map's header values, for Copy from and for a replaced map. */
export function headerOf(map: CseMapRow): HeaderValues {
	const out = {} as HeaderValues;
	for (const f of HEADER_FIELDS) out[f] = map[f];
	return out;
}
