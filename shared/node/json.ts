// Small JSON files other programs may write too (the suite's shared folder list, a project's tables
// and settings): read the latest, change it, and write it back only if nobody wrote it meanwhile.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function parse<T>(bytes: Buffer, path: string): T {
	try {
		// A byte-order mark (Notepad, PowerShell 5's utf8) would make JSON.parse fail.
		return JSON.parse(bytes.toString("utf8").replace(/^﻿/, "")) as T;
	} catch {
		throw new Error(`${path} isn't valid JSON; fix or delete it`);
	}
}

/** A JSON file's value, or `fallback` when it doesn't exist. */
export function readJsonFile<T>(path: string, fallback: T): T {
	return existsSync(path) ? parse<T>(readFileSync(path), path) : fallback;
}

/**
 * Re-read a JSON file, apply `change`, and write the result (tab-indented). The new text goes to a
 * temporary file first and replaces the old one only if the old one still holds what was read;
 * otherwise it starts over from the newer content. `badJson: "replace"` treats an unreadable file
 * as `fallback` instead of refusing.
 */
export function updateJsonFile<T>(path: string, fallback: T, change: (value: T) => T, badJson: "refuse" | "replace" = "refuse"): void {
	mkdirSync(dirname(path), { recursive: true });
	for (let attempt = 0; attempt < 5; attempt++) {
		const before = existsSync(path) ? readFileSync(path) : null;
		let value = fallback;
		if (before) {
			try {
				value = parse<T>(before, path);
			} catch (e) {
				if (badJson === "refuse") throw e;
			}
		}
		const text = JSON.stringify(change(value), null, "\t") + "\n";
		const temp = `${path}.${process.pid}.tmp`;
		writeFileSync(temp, text);
		const now = existsSync(path) ? readFileSync(path) : null;
		if (before === null ? now === null : now !== null && before.equals(now)) {
			renameSync(temp, path);
			return;
		}
		unlinkSync(temp);
	}
	throw new Error(`${path} kept changing while this tool wrote it; try again`);
}
