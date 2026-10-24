// A project's lookup tables (<project>/tools/gen1-map-porter/tables/*.json), the default names the
// tool ships for a known base (the tool's tables/<base>/*.json), and a project's saved mappings
// (<project>/tools/gen1-map-porter/mappings/*.json).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { emptyMapping, type Mapping } from "../mapping.js";
import type { EventTables, MissingKind } from "./events.js";
import type { Game } from "../types.js";
import { readJsonFile, updateJsonFile } from "./json.js";
import { projectToolDir, TOOL_ROOT } from "./project.js";

export interface MapEntry {
	game: Game;
	name: string;
	const: string;
	group: string;
	environment: string;
	landmark: string;
	music: string;
	noPhone: string;
	palette: string;
	/** In projects whose header row has a fish group. */
	fishGroup?: string;
	/** In projects whose header row has a location sign. */
	sign?: string;
	lastMap: { map: string; warp: number } | null;
	warps: Record<string, { map: string; warp: number }>;
	/** This map's CSE tileset, overriding tables/tilesets.json's for its Gen 1 tileset. */
	tileset?: string;
	/**
	 * "replace": the port writes over an existing CSE map with this constant. It keeps that map's
	 * header row except the tileset, and its map_attributes row and connections except the border block.
	 */
	target?: "new" | "replace";
}

export interface TilesetEntry {
	cse: string;
	warpColl: string;
}

/** Each table's file, and the $comment a new one starts with. */
const TABLES = {
	maps: {
		file: "maps.json",
		comment: "Gen 1 map -> how it lands in the project. Grows as maps are ported; a port stops on a missing entry. warps: Gen 1 warp number (1-based) -> the project's destination, for warps to maps the tool didn't port; lastMap: where LAST_MAP warps lead, or null if nowhere yet.",
	},
	tilesets: { file: "tilesets.json", comment: "Gen 1 tileset -> the project's tileset route B maps it onto, and the collision a Gen 1 warp tile gets in a built block." },
	sprites: { file: "sprites.json", comment: "Gen 1 sprite -> the project's sprite (cse) and NPC palette (palette). Filled from the page as maps need them." },
	items: { file: "items.json", comment: "Gen 1 item -> the project's item, for names that differ. Filled from the page as maps need them." },
	classes: { file: "trainer_classes.json", comment: "Gen 1 trainer class -> the project's trainer class. Filled from the page as maps need them." },
	species: { file: "species.json", comment: "Gen 1 species -> the project's species, for names that differ. Filled from the page as maps need them." },
} as const;
type TableId = keyof typeof TABLES;

/** Where a project's tables live. */
export const tablesDir = (projectRoot: string) => join(projectToolDir(projectRoot), "tables");

/** Every file a project's tables are read from, for noticing changes. */
export const tableFiles = (projectRoot: string) => Object.values(TABLES).map((t) => join(tablesDir(projectRoot), t.file));

/** A table's rows (none until its first row is saved). */
function readTable<T>(projectRoot: string, id: TableId): Record<string, T> {
	const table = { ...readJsonFile<Record<string, T>>(join(tablesDir(projectRoot), TABLES[id].file), {}) };
	delete (table as Record<string, unknown>)["$comment"];
	return table;
}

/** Set one row of a table, keeping its $comment and the other rows' order; a new table starts with its comment. */
function writeTableRow<T>(projectRoot: string, id: TableId, key: string, row: (old: T | undefined) => T): void {
	const { file, comment } = TABLES[id];
	updateJsonFile<Record<string, unknown>>(join(tablesDir(projectRoot), file), { $comment: comment }, (table) => ({ ...table, [key]: row(table[key] as T | undefined) }));
}

export function mapTable(projectRoot: string): Record<string, MapEntry> {
	return readTable<MapEntry>(projectRoot, "maps");
}

export function tilesetTable(projectRoot: string): Record<string, TilesetEntry> {
	return readTable<TilesetEntry>(projectRoot, "tilesets");
}

/** The names the tool ships for a known base (its tables/<base>/*.json), each Gen 1 name -> a name there. */
export interface DefaultNames {
	/** Trainer classes named differently, used when the project has no class of the Gen 1 name. */
	classes: Record<string, string>;
	/** Species named differently. */
	species: Record<string, string>;
	/** Sprites to suggest (never applied without asking). */
	spriteSuggestions: Record<string, string>;
}

const DEFAULT_FILES = { classes: "trainer_classes.json", species: "species.json", spriteSuggestions: "sprite_suggestions.json" } as const;

/** The tool's default-name files for a base, for noticing changes. */
export const defaultFiles = (base: string | undefined) => (base ? Object.values(DEFAULT_FILES).map((f) => join(TOOL_ROOT, "tables", base, f)) : []);

/** The default names for a base; none for a project that matches no known base. */
export function defaultNames(base: string | undefined): DefaultNames {
	const read = (file: string): Record<string, string> => {
		const table = { ...(base ? readJsonFile<Record<string, string>>(join(TOOL_ROOT, "tables", base, file), {}) : {}) };
		delete table["$comment"];
		return table;
	};
	return { classes: read(DEFAULT_FILES.classes), species: read(DEFAULT_FILES.species), spriteSuggestions: read(DEFAULT_FILES.spriteSuggestions) };
}

/** The event tables (sprites, items, trainer classes, species), and the default names of the project's base. */
export function eventTables(projectRoot: string, base: string | undefined): EventTables {
	return {
		sprites: readTable<{ cse?: string; palette?: string }>(projectRoot, "sprites"),
		items: readTable<string>(projectRoot, "items"),
		classes: readTable<string>(projectRoot, "classes"),
		species: readTable<string>(projectRoot, "species"),
		defaults: defaultNames(base),
	};
}

const EVENT_TABLES: Record<MissingKind, TableId> = { sprite: "sprites", palette: "sprites", item: "items", class: "classes", species: "species" };

/** Save a chosen match for a Gen 1 name into its table, creating the file if needed. */
export function saveEventChoice(projectRoot: string, kind: MissingKind, gen1: string, value: string): void {
	if (kind === "sprite" || kind === "palette") {
		writeTableRow<{ cse?: string; palette?: string }>(projectRoot, "sprites", gen1, (row = {}) => (kind === "sprite" ? { ...row, cse: value } : { ...row, palette: value }));
	} else {
		writeTableRow<string>(projectRoot, EVENT_TABLES[kind], gen1, () => value);
	}
}

export function saveMapEntry(projectRoot: string, gen1Const: string, entry: MapEntry): void {
	writeTableRow<MapEntry>(projectRoot, "maps", gen1Const, () => entry);
}

export function saveTilesetEntry(projectRoot: string, gen1Tileset: string, entry: TilesetEntry): void {
	writeTableRow<TilesetEntry>(projectRoot, "tilesets", gen1Tileset, () => entry);
}

/** The table entry for a Gen 1 map; a missing one stops the port, by name. */
export function mapEntry(projectRoot: string, gen1Const: string): MapEntry {
	const e = mapTable(projectRoot)[gen1Const];
	if (!e) throw new Error(`tools/gen1-map-porter/tables/maps.json has no entry for ${gen1Const}; add one and rerun`);
	return e;
}

export function tilesetEntry(projectRoot: string, gen1Tileset: string): TilesetEntry {
	const e = tilesetTable(projectRoot)[gen1Tileset];
	if (!e) throw new Error(`tools/gen1-map-porter/tables/tilesets.json has no entry for ${gen1Tileset}; add one and rerun`);
	return e;
}

export function mappingFile(projectRoot: string, gen1Tileset: string, cseTileset: string): string {
	return join(projectToolDir(projectRoot), "mappings", `${gen1Tileset}__${cseTileset}.json`);
}

export function loadMapping(projectRoot: string, gen1Tileset: string, cseTileset: string): Mapping {
	const path = mappingFile(projectRoot, gen1Tileset, cseTileset);
	if (!existsSync(path)) return emptyMapping(gen1Tileset, cseTileset);
	return JSON.parse(readFileSync(path, "utf8")) as Mapping;
}

export function saveMapping(projectRoot: string, mapping: Mapping): void {
	const path = mappingFile(projectRoot, mapping.gen1Tileset, mapping.cseTileset);
	mkdirSync(dirname(path), { recursive: true });
	// Keys sorted numerically so diffs stay small.
	const blocks: Mapping["blocks"] = {};
	for (const k of Object.keys(mapping.blocks).sort((a, b) => Number(a) - Number(b))) blocks[k] = mapping.blocks[k]!;
	writeFileSync(path, JSON.stringify({ ...mapping, blocks }, null, "\t") + "\n");
}
