// Talking to the tool's server. Writes carry the header the server requires.

import type { Gen1Collision } from "../../shared/coll";
import type { Supported } from "../../shared/features";
import type { Mapping } from "../../shared/mapping";
import type { Gen1MapRow, SetupDraft, SetupForm } from "../../shared/setup";
import type { Game, GameMap, Palette, TimeOfDay, Tileset } from "../../shared/types";
import { collFromWire, mapFromWire, tilesetFromWire, type PortEntrySummary, type WirePortContext } from "../../shared/wire";

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	const body = await res.json();
	if (!res.ok) throw new Error(body.error ?? res.statusText);
	return body as T;
}

function write(method: string, body?: unknown): RequestInit {
	return {
		method,
		headers: { "x-gen1-map-porter": "1", "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	};
}

export interface PortContext {
	gen1Const: string;
	entry: Record<string, unknown>;
	warpColl: string;
	gen1Map: GameMap;
	gen1Coll: Gen1Collision;
	cse: Tileset;
	palettes: Record<TimeOfDay, Palette[]>;
	pinnedTime?: TimeOfDay;
	/** What the project calls each time of day. */
	timeNames: Record<TimeOfDay, string>;
	collisionNames: string[];
	/** The project's set of collision names, which built blocks and warp squares are written in. */
	collisionSet: Supported<"collisionNames">;
	mapping: Mapping;
	mappingSaved: boolean;
	unusedAdded: number[];
	reconciled: { moved: { gen1: number; what: string }[]; changed: number[] };
	version: string;
	used: number[];
	missing: Missing[];
	/** Squares an event gives its own collision, where the project does that. */
	collisionSquares: { x: number; y: number; coll: string }[];
	events: EventSummary;
}

export type MissingKind = "sprite" | "palette" | "item" | "class" | "species";
/** A Gen 1 name with no CSE match yet. */
export interface Missing {
	kind: MissingKind;
	gen1: string;
	suggestion?: string;
}
export interface EventSummary {
	items: number;
	hiddenItems: number;
	signs: number;
	people: number;
	trainers: number;
	notes: string[];
	/** Where each event sits (the port context has them; a port report doesn't). */
	marks?: EventMark[];
}
export type EventKind = "item" | "hidden" | "sign" | "boulder" | "hole" | "person" | "trainer" | "unplaced";
export interface EventMark {
	x: number;
	y: number;
	kind: EventKind;
	label: string;
}
export const loadCseChoices = () => getJson<Record<MissingKind, string[]>>("/api/cse-choices");
export const saveChoice = (kind: MissingKind, gen1: string, value: string) =>
	getJson<{ ok: boolean }>("/api/tables/choice", write("PUT", { kind, gen1, value }));

export const portVersion = (map: string) => getJson<{ version: string }>(`/api/port/version?map=${map}`);

/** Where the Port page was left in the current project. */
export interface Place {
	game: Game;
	map: string;
	block?: number;
}
export const loadPlace = () => getJson<Place | null>("/api/place");
/** `leaving`: the page is closing, so the request must outlive it. */
export const savePlace = (place: Place, leaving = false) => getJson<{ ok: boolean }>("/api/place", { ...write("PUT", place), keepalive: leaving });

export const listGen1Maps = (game: Game) => getJson<Gen1MapRow[]>(`/api/gen1-maps?game=${game}`);
export const loadSetup = (game: Game, map: string) => getJson<SetupForm>(`/api/setup?game=${game}&map=${map}`);
export const saveSetup = (draft: SetupDraft) => getJson<{ ok: boolean }>("/api/setup", write("PUT", draft));

export const listPorts = () => getJson<PortEntrySummary[]>("/api/ports");

export async function loadPortContext(map: string): Promise<PortContext> {
	const w = await getJson<WirePortContext>(`/api/port/context?map=${map}`);
	return {
		gen1Const: w.gen1Const,
		entry: w.entry,
		warpColl: w.warpColl,
		gen1Map: mapFromWire(w.gen1Map),
		gen1Coll: collFromWire(w.gen1Coll),
		cse: tilesetFromWire(w.cseTileset),
		palettes: w.csePalettes,
		pinnedTime: w.csePinnedTime,
		timeNames: w.timeNames,
		collisionNames: w.collisionNames,
		collisionSet: w.collisionSet,
		mapping: w.mapping,
		mappingSaved: w.mappingSaved,
		unusedAdded: w.unusedAdded,
		reconciled: w.reconciled,
		version: w.version,
		used: w.used,
		missing: w.missing,
		collisionSquares: w.collisionSquares,
		events: w.events,
	};
}

export const saveMapping = (mapping: Mapping) => getJson<{ ok: boolean }>("/api/mapping", write("PUT", mapping));

export interface PortReport {
	map: string;
	cseMap: string;
	dryRun: boolean;
	written: boolean;
	unpaired: number[];
	appendedBlocks: number;
	unusedAdded: number[];
	reconciled: { moved: { gen1: number; what: string }[]; changed: number[] };
	warpSquares: { x: number; y: number; gen1: string; want?: string; before?: string; note?: string }[];
	conflicts: { gen1Block: number; quadrants: number[] }[];
	walkIssues: unknown[];
	pairEdges: { crossable: boolean }[];
	warps: { gen1: { x: number; y: number; dest: string; warp: number }; cse?: { map: string; warp: number }; reason?: string }[];
	connections: { dir: string; target: string; included: boolean; reason?: string }[];
	files: { path: string; action: string }[];
	errors: string[];
	outsideEdits?: { path: string; reason: "changed" | "no-record"; blocks: { x: number; y: number }[] };
	needsConfirm?: boolean;
	missing: Missing[];
	events: EventSummary;
}

export const runPort = (map: string, dry: boolean, force = false) =>
	getJson<PortReport>(`/api/port?map=${map}&dry=${dry ? 1 : 0}&force=${force ? 1 : 0}`, write("POST"));
