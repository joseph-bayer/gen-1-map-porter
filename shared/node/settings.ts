// This tool's chosen folders (%APPDATA%\gen1-map-porter\settings.json), and the list of folders
// every Crystal Tool Suite tool shares (%APPDATA%\Crystal Tool Suite\known-paths.json).

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { updateJsonFile } from "./json.js";

export const TOOL_ID = "gen1-map-porter";

export type FolderKind = "cse-project" | "pokered" | "pokeyellow";
export const FOLDER_KINDS: readonly FolderKind[] = ["cse-project", "pokered", "pokeyellow"];

export const FOLDER_LABELS: Record<FolderKind, string> = {
	"cse-project": "Crystal project",
	pokered: "Red/Blue repo (pokered)",
	pokeyellow: "Yellow repo (pokeyellow)",
};

export interface Settings {
	folders: Partial<Record<FolderKind, string>>;
	/** Where the Port page was left, per CSE project (keyed by its lower-cased path). */
	places?: Record<string, Place>;
}

/** Where the Port page was left in a project: the Gen 1 game, map and selected block. */
export interface Place {
	game: "yellow" | "red" | "blue";
	map: string;
	block?: number;
}

const placeKey = (projectRoot: string) => resolve(projectRoot).toLowerCase().replace(/\\/g, "/");

export function loadPlace(projectRoot: string): Place | undefined {
	return loadSettings().places?.[placeKey(projectRoot)];
}

export function savePlace(projectRoot: string, place: Place): void {
	const settings = loadSettings();
	settings.places = { ...settings.places, [placeKey(projectRoot)]: place };
	writeJson(settingsPath(), settings);
}

interface KnownPath {
	kind: FolderKind;
	path: string;
	lastUsed: string;
	tool: string;
}

function appData(): string {
	return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
}

export const settingsPath = () => join(appData(), TOOL_ID, "settings.json");
export const knownPathsPath = () => join(appData(), "Crystal Tool Suite", "known-paths.json");

function readJson<T>(path: string, fallback: T): T {
	try {
		// A byte-order mark (Notepad, PowerShell 5's utf8) would make JSON.parse fail.
		return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as T) : fallback;
	} catch {
		return fallback;
	}
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, "\t") + "\n");
}

const isDir = (p: string) => {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
};
const isFile = (p: string) => {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
};

/** Why a folder isn't the right kind, or undefined if it is. */
export function folderProblem(kind: FolderKind, path: string): string | undefined {
	if (!path || !isDir(path)) return "the folder doesn't exist";
	if (kind === "cse-project") {
		// Only what every project the porter reads has; its features are checked separately.
		for (const f of ["constants/map_constants.asm", "data/maps/maps.asm", "data/maps/attributes.asm"]) {
			if (!isFile(join(path, f))) return `not a Crystal project: no ${f}`;
		}
		return undefined;
	}
	if (!isDir(join(path, "data", "maps", "headers"))) return "not a pokered/pokeyellow repo: no data/maps/headers/";
	const yellow = isDir(join(path, "data", "pikachu"));
	if (kind === "pokered" && yellow) return "this is pokeyellow (it has data/pikachu/), not pokered";
	if (kind === "pokeyellow" && !yellow) return "this is pokered (no data/pikachu/), not pokeyellow";
	return undefined;
}

/** This tool's settings; none yet means no folders chosen. */
export function loadSettings(): Settings {
	return readJson<Settings>(settingsPath(), { folders: {} });
}

/** Choose a folder for this tool; it must pass its kind's check. Returns the problem, if any. */
export function chooseFolder(kind: FolderKind, path: string): string | undefined {
	const problem = folderProblem(kind, path);
	if (problem) return problem;
	const settings = loadSettings();
	settings.folders[kind] = resolve(path);
	writeJson(settingsPath(), settings);
	rememberKnown(kind, resolve(path));
	return undefined;
}

/** Add a folder to the suite's shared list, merged into whatever another tool wrote meanwhile. */
function rememberKnown(kind: FolderKind, path: string): void {
	const same = (k: KnownPath) => k.kind === kind && k.path.toLowerCase() === path.toLowerCase();
	const entry: KnownPath = { kind, path, lastUsed: new Date().toISOString(), tool: TOOL_ID };
	updateJsonFile<{ version: 1; paths: KnownPath[] }>(knownPathsPath(), { version: 1, paths: [] }, (data) => ({ ...data, paths: [entry, ...(data.paths ?? []).filter((k) => !same(k))] }), "replace");
}

/** Folders any suite tool has found for this kind that still pass the check, most recent first. */
export function knownFolders(kind: FolderKind): { path: string; tool: string; lastUsed: string }[] {
	const data = readJson<{ version: 1; paths: KnownPath[] }>(knownPathsPath(), { version: 1, paths: [] });
	return data.paths
		.filter((k) => k.kind === kind && !folderProblem(kind, k.path))
		.sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
		.map(({ path, tool, lastUsed }) => ({ path, tool, lastUsed }));
}
