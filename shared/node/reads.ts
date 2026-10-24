// Checking before writing: what each project file held when a port first read it, so the port can
// refuse to write over a file another program changed in the meantime.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** Each file's sha1 when first read (null: it didn't exist), by absolute path. */
export type Reads = Map<string, string | null>;

/** Where reads are being noted, while noteReads runs. */
let current: Reads | undefined;

const key = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

function stateOf(path: string): string | null {
	return existsSync(path) ? sha1(readFileSync(path)) : null;
}

/** Run `fn`, noting what every project file it reads held at its first read. */
export function noteReads<T>(fn: () => T): { value: T; reads: Reads } {
	const outer = current;
	const reads: Reads = new Map();
	current = reads;
	try {
		return { value: fn(), reads };
	} finally {
		current = outer;
	}
}

/** A file's bytes, noted if this is its first read. */
export function readBytes(path: string): Buffer {
	const data = readFileSync(path);
	if (current && !current.has(key(path))) current.set(key(path), sha1(data));
	return data;
}

/** Whether a file or folder exists; a file's first look is noted, even when it isn't there. */
export function fileExists(path: string): boolean {
	const exists = existsSync(path);
	if (current && !current.has(key(path)) && (!exists || statSync(path).isFile())) current.set(key(path), exists ? sha1(readFileSync(path)) : null);
	return exists;
}

/** Note a file about to be written that nothing has read yet, as it is now. */
export function noteUnread(path: string): void {
	if (current && !current.has(key(path))) current.set(key(path), stateOf(path));
}

/** Whether a file no longer holds what it held when first read. */
export function changedSince(reads: Reads, path: string): boolean {
	const was = reads.get(key(path));
	return was !== undefined && was !== stateOf(path);
}
