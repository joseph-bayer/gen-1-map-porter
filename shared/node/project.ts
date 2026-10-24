// File access for the command line and the server: the config, and a project tree on disk.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";

import { loadCseMap, listCseMaps, MAP_FEATURES } from "../cse.js";
import { loadGen1Map, listGen1Maps } from "../gen1.js";
import type { Game, GameMap, ProjectFiles } from "../types.js";
import { formatsOf } from "./features.js";
import { decodePng } from "./png.js";
import { fileExists, readBytes } from "./reads.js";
import { FOLDER_LABELS, loadSettings } from "./settings.js";

export interface Config {
	cse: string;
	pokeyellow: string;
	pokered: string;
}

/**
 * The tool's own folder: the one holding package.json, or, built as one executable (npm run
 * package), the one holding the .exe, with the page and the default tables beside it.
 */
export const TOOL_ROOT = isSea() ? dirname(process.execPath) : resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where this tool keeps a project's records (ports/, mappings/): in the project, so they're committed with it. */
export const projectToolDir = (projectRoot: string) => join(projectRoot, "tools", "gen1-map-porter");

/**
 * The folders this tool works with: the ones chosen in the page's Folders panel (settings.json in
 * AppData), or, for development and tests, the config file GEN1_MAP_PORTER_CONFIG names.
 * A folder that hasn't been chosen is "".
 */
export function loadConfig(): Config {
	const override = process.env.GEN1_MAP_PORTER_CONFIG;
	if (override) {
		if (!existsSync(override)) throw new Error(`GEN1_MAP_PORTER_CONFIG names ${override}, which doesn't exist`);
		return JSON.parse(readFileSync(override, "utf8")) as Config;
	}
	const s = loadSettings();
	return { cse: s.folders["cse-project"] ?? "", pokered: s.folders.pokered ?? "", pokeyellow: s.folders.pokeyellow ?? "" };
}

export function projectFiles(root: string): ProjectFiles {
	const abs = (p: string) => join(root, ...p.split("/"));
	return {
		root,
		text: (p) => readBytes(abs(p)).toString("utf8"),
		bytes: (p) => new Uint8Array(readBytes(abs(p))),
		image: (p) => decodePng(new Uint8Array(readBytes(abs(p))), p),
		list: (d) => readdirSync(abs(d)),
		exists: (p) => fileExists(abs(p)),
	};
}

/** The project a game's maps come from. Red and Blue share pokered. */
export function gameFiles(config: Config, game: Game): ProjectFiles {
	const [path, kind] = game === "cse" ? [config.cse, "cse-project"] as const : game === "yellow" ? [config.pokeyellow, "pokeyellow"] as const : [config.pokered, "pokered"] as const;
	if (!path) throw new Error(`choose the ${FOLDER_LABELS[kind]} folder in the Folders panel first`);
	return projectFiles(path);
}

export function loadMap(config: Config, game: Game, constName: string): GameMap {
	const files = gameFiles(config, game);
	return game === "cse" ? loadCseMap(files, constName, formatsOf(files, MAP_FEATURES)) : loadGen1Map(files, game, constName);
}

export function listMaps(config: Config, game: Game): string[] {
	const files = gameFiles(config, game);
	return game === "cse" ? listCseMaps(files, formatsOf(files, MAP_FEATURES)) : listGen1Maps(files);
}
