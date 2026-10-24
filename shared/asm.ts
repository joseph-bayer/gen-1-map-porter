// Parsers for the bits of RGBDS assembly source this tool reads. They only understand the
// patterns pret-style projects use; anything else is skipped.

import type { Palette, Rgb5 } from "./types.js";

/** The line without its `;` comment, trimmed. */
export function stripComment(line: string): string {
	let inString = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '"') inString = !inString;
		else if (c === ";" && !inString) return line.slice(0, i).trim();
	}
	return line.trim();
}

export function lines(text: string): string[] {
	return text.split(/\r?\n/).map(stripComment);
}

/** A number in RGBDS syntax: $ff, %0101, 0xff, decimal, or a negative. */
export function parseNumber(token: string): number | undefined {
	const t = token.trim();
	let m: RegExpMatchArray | null;
	if ((m = t.match(/^-?\$([0-9a-fA-F]+)$/))) return parseInt(m[1]!, 16) * (t.startsWith("-") ? -1 : 1);
	if ((m = t.match(/^-?%([01]+)$/))) return parseInt(m[1]!, 2) * (t.startsWith("-") ? -1 : 1);
	if (/^-?\d+$/.test(t)) return parseInt(t, 10);
	return undefined;
}

/** Split macro arguments on commas (no nesting is needed for the macros read here). */
export function args(rest: string): string[] {
	return rest.split(",").map((a) => a.trim()).filter((a) => a.length > 0);
}

/** `name arg, arg, ...` invocations of a macro, in file order. */
export function macroCalls(text: string, macro: string): string[][] {
	const out: string[][] = [];
	const re = new RegExp(`^${macro}\\s+(.*)$`);
	for (const line of lines(text)) {
		const m = line.match(re);
		if (m) out.push(args(m[1]!));
	}
	return out;
}

/**
 * A macro's body, from `MACRO name` (also `MACRO? name`, or the older `name: MACRO`) to `ENDM`:
 * its lines without comments, blank lines dropped. Undefined when the text doesn't define it.
 */
export function macroBody(text: string, name: string): string[] | undefined {
	const start = new RegExp(`^(?:MACRO\\??\\s+${name}|${name}:\\s*MACRO)$`);
	let body: string[] | undefined;
	for (const line of lines(text)) {
		if (!body) {
			if (start.test(line)) body = [];
		} else if (/^ENDM\b/.test(line)) {
			return body;
		} else if (line) {
			body.push(line);
		}
	}
	return undefined;
}

/** The highest argument a macro body uses: \1 to \9, then \<10> and up. */
export function macroArgCount(body: string[]): number {
	let n = 0;
	for (const line of body) {
		for (const m of line.matchAll(/\\(?:([1-9])|<(\d+)>)/g)) n = Math.max(n, Number(m[1] ?? m[2]));
	}
	return n;
}

/**
 * The values of `const` lists: `const_def [start]`, `const X`, `const_skip [n]`, `const_next n`.
 * Every `const_def` restarts the count; names are global.
 */
export function constValues(text: string): Map<string, number> {
	const out = new Map<string, number>();
	let value = 0;
	for (const line of lines(text)) {
		let m: RegExpMatchArray | null;
		if ((m = line.match(/^const_def(?:\s+(\S+))?/))) {
			value = m[1] ? (parseNumber(m[1]) ?? 0) : 0;
		} else if ((m = line.match(/^const_skip(?:\s+(\S+))?/))) {
			value += m[1] ? (parseNumber(m[1]) ?? 1) : 1;
		} else if ((m = line.match(/^const_next\s+(\S+)/))) {
			value = parseNumber(m[1]!) ?? value;
		} else if ((m = line.match(/^const\s+([A-Za-z_][A-Za-z0-9_]*)/))) {
			out.set(m[1]!, value++);
		}
	}
	return out;
}

/** `map_const NAME, width, height` → dimensions in blocks. */
export function mapConsts(text: string): Map<string, { width: number; height: number }> {
	const out = new Map<string, { width: number; height: number }>();
	for (const [name, w, h] of macroCalls(text, "map_const")) {
		const width = parseNumber(w ?? ""), height = parseNumber(h ?? "");
		if (name && width !== undefined && height !== undefined) out.set(name, { width, height });
	}
	return out;
}

/**
 * Labels and the file the next INCBIN/INCLUDE pulls in. Stacked labels share the file:
 *   TilesetCaveMeta::
 *   TilesetDarkCaveMeta::
 *   INCBIN "data/tilesets/cave_metatiles.bin.lz"
 * Also `Label:: INCBIN "file"` on one line.
 */
export function labelFiles(text: string): Map<string, string> {
	const out = new Map<string, string>();
	let pending: string[] = [];
	for (const line of lines(text)) {
		if (!line) continue;
		const m = line.match(/^([A-Za-z_.][A-Za-z0-9_.]*)::?\s*(.*)$/);
		let rest = line;
		if (m) {
			pending.push(m[1]!);
			rest = m[2]!;
			if (!rest) continue;
		}
		const inc = rest.match(/^(?:INCBIN|INCLUDE)\s+"([^"]+)"/);
		if (inc) {
			for (const label of pending) out.set(label, inc[1]!);
		}
		pending = [];
	}
	return out;
}

/** Every `RGB r,g,b, r,g,b, ...` line, grouped into palettes of 4 colors. */
export function rgbPalettes(text: string): Palette[] {
	const colors: Rgb5[] = [];
	for (const line of lines(text)) {
		const m = line.match(/^RGB\s+(.*)$/);
		if (!m) continue;
		const n = args(m[1]!).map((a) => parseNumber(a) ?? 0);
		for (let i = 0; i + 2 < n.length; i += 3) colors.push([n[i]!, n[i + 1]!, n[i + 2]!]);
	}
	const out: Palette[] = [];
	for (let i = 0; i + 3 < colors.length; i += 4) {
		out.push([colors[i]!, colors[i + 1]!, colors[i + 2]!, colors[i + 3]!]);
	}
	return out;
}

/** The `db` bytes after a local label such as `.OutdoorColors:`, until the next label (labels stacked on it share them). */
export function bytesAfterLabel(text: string, label: string): number[] {
	const out: number[] = [];
	let inside = false;
	for (const line of lines(text)) {
		if (/^[A-Za-z_.][A-Za-z0-9_.]*::?$/.test(line)) {
			if (inside && out.length) break;
			inside ||= line.replace(/:+$/, "") === label;
			continue;
		}
		if (!inside) continue;
		const m = line.match(/^db\s+(.*)$/);
		if (m) for (const a of args(m[1]!)) out.push(parseNumber(a) ?? 0);
	}
	return out;
}
