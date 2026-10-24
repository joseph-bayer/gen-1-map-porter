// A Gen 1 map's events (items, hidden items, signs, people, trainers) as CSE event lines, scripts,
// texts, event flags and trainer parties. Nothing is written here; port.ts writes the result.
//
// Gen 1 sources (pokered / pokeyellow, the same shape):
//   data/maps/objects/<Map>.asm   bg_event / object_event
//   scripts/<Map>.asm             TEXT_ID -> label (TextPointers), labels' bodies, trainer headers
//   text/*.asm                    the words (_Label:: text/line/cont/para/done)
//   data/events/hidden_events.asm hidden items and other hidden events, per map
//   data/trainers/parties.asm     parties, per class (TrainerDataPointers order)
//   data/trainers/special_moves.asm  Yellow's move changes

import { constValues, lines, macroCalls, parseNumber, stripComment } from "../asm.js";
import { COLLISION_NAMES, type CollisionSign } from "../coll.js";
import type { Supported } from "../features.js";
import type { CollisionSquare } from "../warps.js";
import { gen1BoulderToggles, gen1Holes, gen1MapHeaders, toggleObject } from "../gen1.js";
import type { Gen1Hole, ProjectFiles } from "../types.js";
import type { DefaultNames, MapEntry } from "./tables.js";

export type MissingKind = "sprite" | "palette" | "item" | "class" | "species";

/** A Gen 1 name with no CSE match yet: the page asks for one (and saves it to the table). */
export interface Missing {
	kind: MissingKind;
	gen1: string;
	suggestion?: string;
}

/** Chosen matches for Gen 1 names (tables/sprites.json, items.json, trainer_classes.json, species.json). */
export interface EventTables {
	sprites: Record<string, { cse?: string; palette?: string }>;
	items: Record<string, string>;
	classes: Record<string, string>;
	species: Record<string, string>;
	/** The tool's default names for the project's base, under the chosen matches. */
	defaults: DefaultNames;
}

/** How the project writes the events this file makes. */
export interface EventFormats {
	objectEvent: Supported<"objectEvent">;
	itemEvents: Supported<"itemEvents">;
	boulders: Supported<"boulders">;
	/** Its collision names, which say whether Mart and Poké Center signs and trash cans are collision. */
	collisionNames: Supported<"collisionNames">;
}

/** A new party for an existing CSE trainer class. */
export interface TrainerAdd {
	cseClass: string;
	/** The new trainer constant, appended to the class's trainerclass block. */
	constName: string;
	/** The party's name, at most 10 characters. */
	name: string;
	/** TRAINERTYPE_NORMAL or TRAINERTYPE_MOVES. */
	moves: boolean;
	/** `dropped`: Gen 1 moves the project doesn't have, left out of `moves`. */
	mons: { level: number; species: string; moves?: string[]; dropped?: string[] }[];
	/** For the report: where it came from. */
	source: string;
}

export interface MapEvents {
	objectConsts: string[];
	bgEvents: string[];
	objectEvents: string[];
	/** Comment lines that stand in for what isn't placed (static Pokémon, other hidden events). */
	notes: string[];
	/** Scripts and texts, after the events block's labels. */
	scripts: string[];
	flags: string[];
	trainers: TrainerAdd[];
	missing: Missing[];
	/** What a person should read in the report: stubs, unplaced events, long text lines. */
	report: string[];
	/** Where each event sits, for the preview (squares; Gen 1's and CSE's are the same). */
	marks: EventMark[];
	/** warp_events after the map's Gen 1 warps: landings from holes above, then this map's holes. */
	extraWarps: string[];
	/** Lines for def_callbacks (the falling-boulder stonetable). */
	callbacks: string[];
	/** Flags set at game start (boulders that start below a hole), for InitializeEventsScript. */
	initFlags: string[];
	/** Squares that work by their collision (Mart and Poké Center signs and trash cans, where the project does that). */
	collisionSquares: CollisionSquare[];
}

export interface EventMark {
	x: number;
	y: number;
	kind: "item" | "hidden" | "sign" | "boulder" | "hole" | "person" | "trainer" | "unplaced";
	label: string;
}

/** What the CSE project has, to check names against. */
export interface CseNames {
	sprites: Set<string>;
	items: Set<string>;
	classes: Set<string>;
	species: Set<string>;
	moves: Set<string>;
	/** Learnsets by species constant: [level, move] in level order. */
	learnsets: Map<string, [number, string][]>;
	/** NPC palettes for object_event, the sprite's own palette first (PAL_NPC_DEFAULT, or 0 where the project has no name for it). */
	npcPalettes: string[];
	/** Where items, key items and TMs are separate spaces: the key items and the TMs (and HMs). */
	keyItems?: Set<string>;
	tms?: Set<string>;
}

// ---------------------------------------------------------------------------------------------
// CSE names

/** The constants of the const_def block that ends at the line defining `endName` (e.g. NUM_ITEMS). */
function constBlockBefore(text: string, endName: string): string[] {
	let block: string[] = [];
	for (const line of lines(text)) {
		if (/^const_def\b/.test(line)) block = [];
		const m = line.match(/^const\s+(\w+)/);
		if (m) block.push(m[1]!);
		if (new RegExp(`^DEF\\s+${endName}\\b`).test(line)) return block;
	}
	return [];
}

/**
 * The project's names to check Gen 1's against. `itemEvents` says how items are kept: one space with
 * TMs among them, or (with itemball_event) items, key items and TMs as separate spaces.
 */
export function cseNames(files: ProjectFiles, itemEvents?: Supported<"itemEvents">): CseNames {
	const itemText = files.text("constants/item_constants.asm");
	let items: Set<string>, keyItems: Set<string> | undefined, tms: Set<string> | undefined;
	if (itemEvents === "event-macros") {
		keyItems = new Set(constBlockBefore(itemText, "NUM_KEY_ITEMS"));
		const tmText = files.exists("constants/tmhm_constants.asm") ? files.text("constants/tmhm_constants.asm") : "";
		tms = new Set([...macroCalls(tmText, "add_tm").map(([m]) => `TM_${m}`), ...macroCalls(tmText, "add_hm").map(([m]) => `HM_${m}`)]);
		items = new Set([...constBlockBefore(itemText, "NUM_ITEMS").filter((n) => n !== "NO_ITEM"), ...keyItems, ...tms]);
	} else {
		items = new Set([...constValues(itemText).keys()]);
		for (const [m] of macroCalls(itemText, "add_tm")) if (m) items.add(`TM_${m}`);
		for (const [m] of macroCalls(itemText, "add_hm")) if (m) items.add(`HM_${m}`);
	}
	const classes = new Set(macroCalls(files.text("constants/trainer_constants.asm"), "trainerclass").map((c) => c[0]!));
	const species = new Set([...constValues(files.text("constants/pokemon_constants.asm")).keys()]);
	return {
		sprites: new Set([...constValues(files.text("constants/sprite_constants.asm")).keys()].filter((k) => k.startsWith("SPRITE_"))),
		items,
		classes,
		species,
		moves: new Set([...constValues(files.text("constants/move_constants.asm")).keys()]),
		learnsets: cseLearnsets(files),
		npcPalettes: npcPalettes(files.text("constants/sprite_data_constants.asm")),
		...(keyItems && { keyItems }),
		...(tms && { tms }),
	};
}

/** The project's NPC palette names: made by ow_npc_pal_const, or plain PAL_NPC_* constants. */
function npcPalettes(text: string): string[] {
	const consts = [...constValues(text).keys()].filter((k) => k.startsWith("PAL_NPC_"));
	const viaMacro = macroCalls(text, "ow_npc_pal_const").map((c) => `PAL_NPC_${c[0]}`);
	const hasDefault = consts.includes("PAL_NPC_DEFAULT") || /^\s*DEF\s+PAL_NPC_DEFAULT\b/m.test(text);
	return [hasDefault ? "PAL_NPC_DEFAULT" : "0", ...(viaMacro.length ? viaMacro : consts).filter((n) => n !== "PAL_NPC_DEFAULT")];
}

/**
 * Level-up moves per species: the block labelled <Species>EvosAttacks (GENGAR → Gengar,
 * MR__MIME → MrMime, FARFETCH_D → FarfetchD). By name, since pokemon_constants.asm also holds form
 * constants that would throw off a count.
 */
function cseLearnsets(files: ProjectFiles): Map<string, [number, string][]> {
	const out = new Map<string, [number, string][]>();
	const blocks = new Map<string, [number, string][]>();
	for (const path of ["data/pokemon/evos_attacks_kanto.asm", "data/pokemon/evos_attacks_johto.asm", "data/pokemon/evos_attacks.asm"]) {
		if (!files.exists(path)) continue;
		let label: string | undefined, inMoves = false;
		for (const line of lines(files.text(path))) {
			// Polished Crystal's: `evos_attacks <Name>` (with its form, as GeodudePlain), then `learnset level, MOVE`.
			const named = line.match(/^evos_attacks\s+(\w+)$/);
			if (named) {
				label = `${named[1]!.replace(/Plain$/, "")}EvosAttacks`;
				inMoves = true;
				if (!blocks.has(label)) blocks.set(label, []);
				else label = undefined; // a later form's learnset
				continue;
			}
			const learn = label && line.match(/^learnset\s+(\d+),\s*(\w+)/);
			if (learn) {
				blocks.get(label!)!.push([Number(learn[1]), learn[2]!]);
				continue;
			}
			const l = line.match(/^(\w+EvosAttacks):/);
			if (l) {
				label = l[1]!;
				inMoves = false;
				blocks.set(label, []);
				continue;
			}
			if (!label) continue;
			if (/^db\s+0\b/.test(line)) {
				if (inMoves) label = undefined;
				else inMoves = true;
				continue;
			}
			const m = inMoves && line.match(/^dbw?\s+(\d+),\s*(\w+)/);
			if (m) blocks.get(label)!.push([Number(m[1]), m[2]!]);
		}
	}
	for (const s of constValues(files.text("constants/pokemon_constants.asm")).keys()) {
		const b = blocks.get(`${camel(s)}EvosAttacks`);
		if (b) out.set(s, b);
	}
	return out;
}

/** A Pokémon's default moves at a level: its last four distinct level-up moves at or below it. */
export function defaultMoves(learnset: [number, string][], level: number): string[] {
	const moves: string[] = [];
	for (const [lv, move] of learnset) {
		if (lv > level) break;
		if (moves.includes(move)) continue;
		moves.push(move);
		if (moves.length > 4) moves.shift();
	}
	while (moves.length < 4) moves.push("NO_MOVE");
	return moves;
}

// ---------------------------------------------------------------------------------------------
// Gen 1 sources

interface Gen1Text {
	/** The words, as `text`/`line`/... lines, or undefined when the text isn't plain. */
	body?: string[];
	/** Why it isn't plain (text_asm, text_ram, a missing label...). */
	why?: string;
	/** The text was code, but its same-named words were found and copied: what was lost. */
	copiedFromCode?: string;
	/** The script label's body, for finding a trainer header in a text_asm. */
	code: string[];
}

/** Every `_Label::` in text/*.asm and its lines, up to the next label. */
function gen1TextLabels(files: ProjectFiles): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const file of files.list("text")) {
		if (!file.endsWith(".asm")) continue;
		let cur: string[] | undefined;
		for (const raw of files.text(`text/${file}`).split(/\r?\n/)) {
			const l = raw.match(/^(_?\w+)::?\s*$/);
			if (l) {
				cur = [];
				out.set(l[1]!, cur);
				continue;
			}
			if (cur && raw.trim()) cur.push(raw.replace(/\s+$/, ""));
		}
	}
	return out;
}

const PLAIN_TEXT = /^(text|line|cont|para|done|prompt|text_end)\b/;

/** The label bodies of a map's script file, and its TEXT_ID -> label table. */
function gen1Script(files: ProjectFiles, mapName: string) {
	const path = `scripts/${mapName}.asm`;
	const bodies = new Map<string, string[]>();
	const textIds = new Map<string, string>();
	if (!files.exists(path)) return { bodies, textIds, headers: new Map<string, string[]>() };
	let cur: string[] | undefined;
	for (const raw of files.text(path).split(/\r?\n/)) {
		const line = stripComment(raw);
		const l = raw.match(/^(\w+):{1,2}\s*$/);
		if (l) {
			cur = [];
			bodies.set(l[1]!, cur);
			continue;
		}
		if (cur && line) cur.push(line);
		const t = line.match(/^dw_const\s+(\w+),\s*(TEXT_\w+)/);
		if (t) textIds.set(t[2]!, t[1]!);
	}
	// Trainer headers: label -> [flag, sight, battle, end battle, after battle]
	const headers = new Map<string, string[]>();
	for (const [label, body] of bodies) {
		const m = body[0]?.match(/^trainer\s+(.*)$/);
		if (m) headers.set(label, m[1]!.split(",").map((s) => s.trim()));
	}
	return { bodies, textIds, headers };
}

/** A script label's text: `text_far _X` + `text_end` with _X plain, or why not. */
function resolveText(label: string | undefined, bodies: Map<string, string[]>, texts: Map<string, string[]>): Gen1Text {
	if (!label) return { why: "no text", code: [] };
	const code = bodies.get(label) ?? [];
	if (!code.length) return { why: `${label} is shared or elsewhere`, code };
	const far = code[0]!.match(/^text_far\s+(\w+)/);
	if (!far || code.length > 2 || (code[1] && code[1] !== "text_end")) {
		const why = code[0]!.startsWith("text_asm") ? `${label} is code (text_asm)` : `${label} isn't a plain text_far`;
		// Code that prints a text of the same name (_Label in text/): copy its words; the code's other work is lost.
		const same = plainBody(texts.get(`_${label}`));
		if (same.body) return { body: same.body, code, copiedFromCode: `${why}; its words (_${label}) were copied, its other behavior wasn't` };
		return { why, code };
	}
	const p = plainBody(texts.get(far[1]!), far[1]!);
	return p.body ? { body: p.body, code } : { why: p.why, code };
}

/** A text label's lines if they're plain text, or why not. */
function plainBody(body: string[] | undefined, name = "the text"): { body?: string[]; why?: string } {
	if (!body) return { why: `${name} not found in text/` };
	for (const l of body) {
		const t = l.trim();
		if (!PLAIN_TEXT.test(t)) return { why: `${name} uses ${t.split(/\s/)[0]}` };
		if (/@"/.test(t)) return { why: `${name} builds text at run time (@)` };
	}
	return { body: body.map((l) => `\t${l.trim()}`) };
}

/** Tiles a text line takes in the box: # is POKé (4), <PLAYER>/<RIVAL> up to 7, 's and the like one. */
function textTiles(s: string): number {
	return s.replace(/<PLAYER>|<RIVAL>/g, "1234567").replace(/#/g, "1234").replace(/'[dlmrstv]/g, "1").length;
}

const DIRS = ["DOWN", "UP", "LEFT", "RIGHT"];

function movement(kind: string, arg: string): { data: string; rx: number; ry: number } {
	if (kind === "WALK") {
		if (arg === "LEFT_RIGHT") return { data: "SPRITEMOVEDATA_WALK_LEFT_RIGHT", rx: 1, ry: 0 };
		if (arg === "UP_DOWN") return { data: "SPRITEMOVEDATA_WALK_UP_DOWN", rx: 0, ry: 1 };
		return { data: "SPRITEMOVEDATA_WANDER", rx: 1, ry: 1 };
	}
	if (DIRS.includes(arg)) return { data: `SPRITEMOVEDATA_STANDING_${arg}`, rx: 0, ry: 0 };
	if (arg === "BOULDER_MOVEMENT_BYTE_2") return { data: "SPRITEMOVEDATA_STRENGTH_BOULDER", rx: 0, ry: 0 };
	if (arg === "ANY_DIR") return { data: "SPRITEMOVEDATA_SPINRANDOM_SLOW", rx: 0, ry: 0 };
	return { data: "SPRITEMOVEDATA_STILL", rx: 0, ry: 0 };
}

/** The fields of an object_event, whatever the project's argument layout. */
interface ObjectEventFields {
	xy: string;
	sprite: string;
	movement: string;
	rx: number;
	ry: number;
	palette: string;
	type: string;
	/** The sight range, or the command an OBJECTTYPE_COMMAND object runs. */
	sight: number | string;
	script: string;
	flag: string;
}

/** An object_event line, in each argument layout the porter writes. */
const OBJECT_EVENT: Record<Supported<"objectEvent">, (o: ObjectEventFields) => string> = {
	"13": (o) => `\tobject_event ${o.xy}, ${o.sprite}, ${o.movement}, ${o.rx}, ${o.ry}, -1, -1, ${o.palette}, ${o.type}, ${o.sight}, ${o.script}, ${o.flag}`,
	"12": (o) => `\tobject_event ${o.xy}, ${o.sprite}, ${o.movement}, ${o.rx}, ${o.ry}, -1, ${o.palette}, ${o.type}, ${o.sight}, ${o.script}, ${o.flag}`,
};

/** A shared script: CSE's and pokecrystal's std script name, and Polished Crystal's std. */
type Std = { script: string; std: string };
const STD = {
	mart: { script: "MartSignScript", std: "martsign" },
	pokecenter: { script: "PokecenterSignScript", std: "pokecentersign" },
	pc: { script: "PCScript", std: "pcscript" },
	bookshelf: { script: "DifficultBookshelfScript", std: "difficultbookshelf" },
	magazines: { script: "MagazineBookshelfScript", std: "magazinebookshelf" },
	trash: { script: "TrashCanScript", std: "trashcan" },
} as const satisfies Record<string, Std>;

/**
 * Signs, people, shared scripts, trainers and Strength boulders, in each way the porter writes them.
 * Each returns its event line and the scripts that go with it.
 */
const EVENT_STYLES: Record<Supported<"objectEvent">, {
	/** A sign showing the text at `text` (`script` names a script for it, where one is needed). */
	sign(xy: string, script: string, text: string): { bg: string; script: string[] };
	/** A person who faces the player and shows the text at `text`; `script()` names a script for it, where one is needed. */
	person(o: Omit<ObjectEventFields, "type" | "sight" | "script">, script: () => string, text: string): { object: string; script: string[] };
	/** A bg event running a shared script, read from `facing` (BGEVENT_READ or BGEVENT_UP). */
	std(xy: string, facing: string, label: string, std: Std): { bg: string; script: string[] };
	/**
	 * A trainer that battles on sight: its object (given the rest of its fields) and script. Its
	 * after-battle text follows the script, under `afterLabel` if it has one.
	 */
	trainer(o: Omit<ObjectEventFields, "type" | "script" | "flag">, label: string, cseClass: string, constName: string, flag: string): { object: string; script: string[]; afterLabel?: string };
	/** A Strength boulder; `needsScript` when it uses the map's one shared boulder script. */
	boulder(o: ObjectEventFields): { object: string; needsScript: boolean };
	boulderScript(label: string): string[];
}> = {
	"13": {
		sign: (xy, script, text) => ({ bg: `\tbg_event ${xy}, BGEVENT_READ, ${script}`, script: [`${script}:`, `\tjumptext ${text}`, ""] }),
		person: (o, script, text) => {
			const label = script();
			return { object: OBJECT_EVENT["13"]({ ...o, type: "OBJECTTYPE_SCRIPT", sight: 0, script: label }), script: [`${label}:`, `\tjumptextfaceplayer ${text}`, ""] };
		},
		std: (xy, facing, label, std) => ({ bg: `\tbg_event ${xy}, ${facing}, ${label}`, script: [`${label}:`, `\tjumpstd ${std.script}`, ""] }),
		trainer: (o, label, cseClass, constName, flag) => ({
			object: OBJECT_EVENT["13"]({ ...o, type: "OBJECTTYPE_TRAINER", script: label, flag: "-1" }),
			script: [
				`${label}:`,
				`\ttrainer ${cseClass}, ${constName}, ${flag}, ${label}SeenText, ${label}BeatenText, 0, .Script`,
				"",
				".Script:",
				"\tendifjustbattled",
				"\topentext",
				`\twritetext ${label}AfterBattleText`,
				"\twaitbutton",
				"\tclosetext",
				"\tend",
				"",
			],
			afterLabel: `${label}AfterBattleText`,
		}),
		boulder: (o) => ({ object: OBJECT_EVENT["13"](o), needsScript: true }),
		boulderScript: (label) => [`${label}:`, "\tjumpstd StrengthBoulderScript", ""],
	},
	// Polished Crystal: signs show their text with BGEVENT_JUMPTEXT, people with OBJECTTYPE_COMMAND's
	// jumptextfaceplayer, shared scripts are BGEVENT_JUMPSTD, a trainer's after-battle text follows its
	// generictrainer line, and boulders are strengthboulder_event.
	"12": {
		sign: (xy, _script, text) => ({ bg: `\tbg_event ${xy}, BGEVENT_JUMPTEXT, ${text}`, script: [] }),
		person: (o, _script, text) => ({ object: OBJECT_EVENT["12"]({ ...o, type: "OBJECTTYPE_COMMAND", sight: "jumptextfaceplayer", script: text }), script: [] }),
		std: (xy, _facing, _label, std) => ({ bg: `\tbg_event ${xy}, BGEVENT_JUMPSTD, ${std.std}`, script: [] }),
		trainer: (o, label, cseClass, constName, flag) => ({
			object: OBJECT_EVENT["12"]({ ...o, type: "OBJECTTYPE_GENERICTRAINER", script: label, flag: "-1" }),
			script: [`${label}:`, `\tgenerictrainer ${cseClass}, ${constName}, ${flag}, ${label}SeenText, ${label}BeatenText`, ""],
		}),
		boulder: (o) => ({ object: `\tstrengthboulder_event ${o.xy}${o.flag === "-1" ? "" : `, ${o.flag}`}`, needsScript: false }),
		boulderScript: () => [],
	},
};

/** Item balls and hidden items, in each way the porter writes them: the event line, and any script. */
const ITEM_EVENTS: Record<Supported<"itemEvents">, {
	ball(xy: string, item: string, label: string, flag: string, names: CseNames, objectEvent: (o: ObjectEventFields) => string): { object: string; script: string[] };
	/** A hidden item's bg event and script, or why it can't be one. */
	hidden(xy: string, item: string, label: string, flag: string, names: CseNames): { bg: string; script: string[] } | { problem: string };
}> = {
	scripts: {
		ball: (xy, item, label, flag, _names, objectEvent) => ({
			object: objectEvent({ xy, sprite: "SPRITE_POKE_BALL", movement: "SPRITEMOVEDATA_STILL", rx: 0, ry: 0, palette: "0", type: "OBJECTTYPE_ITEMBALL", sight: 0, script: label, flag }),
			script: [`${label}:`, `\titemball ${item}`, ""],
		}),
		hidden: (xy, item, label, flag) => ({ bg: `\tbg_event ${xy}, BGEVENT_ITEM, ${label}`, script: [`${label}:`, `\thiddenitem ${item}, ${flag}`, ""] }),
	},
	// Items, key items and TMs are separate spaces, each with its own ball. A hidden item is
	// BGEVENT_ITEM plus the item, so only ordinary items can be hidden.
	"event-macros": {
		ball: (xy, item, _label, flag, names) => ({
			object: names.tms?.has(item) ? `\ttmhmball_event ${xy}, ${item}, ${flag}`
				: names.keyItems?.has(item) ? `\tkeyitemball_event ${xy}, ${item}, ${flag}`
				: `\titemball_event ${xy}, ${item}, 1, ${flag}`,
			script: [],
		}),
		hidden: (xy, item, _label, flag, names) => (names.tms?.has(item) || names.keyItems?.has(item)
			? { problem: `${item} isn't an ordinary item, and only those can be hidden (BGEVENT_ITEM + item)` }
			: { bg: `\tbg_event ${xy}, BGEVENT_ITEM + ${item}, ${flag}`, script: [] }),
	},
};

/** A boulder that falls through the hole with warp number `warp`: its object, and the flag that shows the one below. */
interface BoulderFall {
	n: number;
	warp: number;
	object: string;
	shows: string;
}

/** The callback and scripts that let boulders fall through holes, in each mechanism the porter writes. */
const FALLING_BOULDERS: Record<Supported<"boulders">, (prefix: string, falls: BoulderFall[]) => { callbacks: string[]; scripts: string[] }> = {
	"stonetable-cmdqueue": (prefix, falls) => {
		const cb = `${prefix}StoneTableCallback`;
		return {
			callbacks: [`\tcallback MAPCALLBACK_CMDQUEUE, ${cb}`],
			scripts: [
				`${cb}:`, "\twritecmdqueue .CommandQueue", "\tendcallback", "",
				".CommandQueue:", "\tcmdqueue CMDQUEUE_STONETABLE, .StoneTable ; is a boulder sitting on a hole?", "",
				".StoneTable:", ...falls.map((f) => `\tstonetable ${f.warp}, ${f.object}+1, .Boulder${f.n}`), "\tdb -1 ; end", "",
				...falls.flatMap((f) => [`.Boulder${f.n}:`, `\tdisappear ${f.object}`, `\tclearevent ${f.shows}`, "\tsjump .Fall", ""]),
				".Fall:", "\tpause 30", "\tscall .FX", "\topentext", `\twritetext ${prefix}BoulderFellText`, "\twaitbutton", "\tclosetext", "\tend", "",
				".FX:", "\tplaysound SFX_STRENGTH", "\tearthquake 80", "\tend", "",
				`${prefix}BoulderFellText:`, "\ttext \"The boulder fell\"", "\tline \"through!\"", "\tdone", "",
			],
		};
	},
	// Polished Crystal's, as its Blackthorn Gym 2F does it: the object constants are the objects' ids.
	usestonetable: (prefix, falls) => {
		const cb = `${prefix}Boulders`;
		return {
			callbacks: [`\tcallback MAPCALLBACK_CMDQUEUE, ${cb}`],
			scripts: [
				`${cb}:`, "\tusestonetable .BoulderTable", "\tendcallback", "",
				".BoulderTable:", ...falls.map((f) => `\tstonetable ${f.warp}, ${f.object}, .Boulder${f.n}`), "\tdb -1 ; end", "",
				// .Fall is always just ahead, so sjumpfwd (Polished's sjump warns when that would do).
				...falls.flatMap((f) => [`.Boulder${f.n}:`, `\tdisappear ${f.object}`, `\tclearevent ${f.shows}`, "\tsjumpfwd .Fall", ""]),
				".Fall:", "\tpause 30", "\tplaysound SFX_STRENGTH", "\tearthquake 80", "\tjumpthistext", "",
				"\ttext \"The boulder fell\"", "\tline \"through!\"", "\tdone", "",
			],
		};
	},
};

const camel = (c: string) => c.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");

/** The Nth (1-based) party of each Gen 1 class: `db level, mon..., 0` or `db $FF, level, mon, ..., 0`. */
function gen1Parties(files: ProjectFiles): Map<string, { level: number; species: string }[][]> {
	const text = files.text("data/trainers/parties.asm");
	const classes = lines(files.text("constants/trainer_constants.asm")).flatMap((l) => l.match(/^trainer_const\s+(\w+)/)?.[1] ?? []);
	const pointers = lines(text).flatMap((l) => l.match(/^dw\s+(\w+Data)$/)?.[1] ?? []);
	const byLabel = new Map<string, { level: number; species: string }[][]>();
	let cur: { level: number; species: string }[][] | undefined;
	for (const line of lines(text)) {
		const l = line.match(/^(\w+Data):/);
		if (l) {
			cur = [];
			byLabel.set(l[1]!, cur);
			continue;
		}
		const d = cur && line.match(/^db\s+(.*)$/);
		if (!d) continue;
		const parts = d[1]!.split(",").map((s) => s.trim()).filter(Boolean);
		if (parts.at(-1) === "0") parts.pop();
		const party: { level: number; species: string }[] = [];
		if (parts[0] === "$FF") {
			for (let i = 1; i + 1 < parts.length; i += 2) party.push({ level: Number(parts[i]), species: parts[i + 1]! });
		} else {
			const level = Number(parts[0]);
			for (const s of parts.slice(1)) party.push({ level, species: s });
		}
		cur!.push(party);
	}
	const out = new Map<string, { level: number; species: string }[][]>();
	// trainer_const lists NOBODY first; TrainerDataPointers starts at class 1.
	pointers.forEach((label, i) => {
		const cls = classes[i + 1];
		if (cls && byLabel.has(label)) out.set(cls, byLabel.get(label)!);
	});
	return out;
}

/** Yellow's special moves: "CLASS id" -> [mon slot (1-based), move slot (1-based), move]. */
function gen1SpecialMoves(files: ProjectFiles): Map<string, [number, number, string][]> {
	const out = new Map<string, [number, number, string][]>();
	if (!files.exists("data/trainers/special_moves.asm")) return out;
	let cur: [number, number, string][] | undefined;
	for (const line of lines(files.text("data/trainers/special_moves.asm"))) {
		const d = line.match(/^db\s+(.*)$/);
		if (!d) continue;
		const parts = d[1]!.split(",").map((s) => s.trim());
		if (parts.length === 2 && !/^\d+$/.test(parts[0]!)) {
			cur = [];
			out.set(`${parts[0]} ${Number(parts[1])}`, cur);
		} else if (parts.length === 3 && cur) {
			cur.push([Number(parts[0]), Number(parts[1]), parts[2]!]);
		} else if (parts[0] === "0") {
			cur = undefined;
		}
	}
	return out;
}

/** The map's hidden events: [x, y, function, argument]. */
function gen1HiddenEvents(files: ProjectFiles, gen1Const: string): [number, number, string, string][] {
	const out: [number, number, string, string][] = [];
	let on = false;
	for (const line of lines(files.text("data/events/hidden_events.asm"))) {
		const m = line.match(/^hidden_events_for\s+(\w+)/);
		if (m) {
			on = m[1] === gen1Const;
			continue;
		}
		const e = on && line.match(/^hidden_event\s+(.*)$/);
		if (e) {
			const [x, y, fn, arg] = e[1]!.split(",").map((s) => s.trim());
			out.push([Number(x), Number(y), fn ?? "", arg ?? ""]);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------------------------

/** Every Gen 1 map's holes, by map constant (read once per Gen 1 tree). */
const holesCache = new WeakMap<ProjectFiles, Map<string, Gen1Hole[]>>();
function allHoles(files: ProjectFiles): Map<string, Gen1Hole[]> {
	let out = holesCache.get(files);
	if (!out) {
		out = new Map(gen1MapHeaders(files).map((h) => [h.constName, gen1Holes(files, h.name)] as const).filter(([, hs]) => hs.length));
		holesCache.set(files, out);
	}
	return out;
}

/**
 * `ported(gen1Const)` gives the CSE constant of a Gen 1 map that is in the CSE project (undefined if
 * not), for holes, landings and boulders that reach other maps.
 */
export function gen1MapEvents(gen1Files: ProjectFiles, gen1Name: string, gen1Const: string, entry: MapEntry, names: CseNames, tables: EventTables, formats: EventFormats, ported: (gen1Const: string) => string | undefined = () => undefined): MapEvents {
	const ev: MapEvents = { objectConsts: [], bgEvents: [], objectEvents: [], notes: [], scripts: [], flags: [], trainers: [], missing: [], report: [], marks: [], extraWarps: [], callbacks: [], initFlags: [], collisionSquares: [] };
	const objectEvent = OBJECT_EVENT[formats.objectEvent];
	const style = EVENT_STYLES[formats.objectEvent];
	// Where Mart and Poké Center signs and trash cans work by collision, they become collision on their square.
	const collisionSigns = COLLISION_NAMES[formats.collisionNames].signs;
	const signByCollision = (x: string | number | undefined, y: string | number | undefined, sign: CollisionSign, what: string) => {
		const coll = collisionSigns![sign];
		ev.collisionSquares.push({ x: Number(x), y: Number(y), coll });
		mark(x, y, "sign", `${what} (collision ${coll})`);
	};
	const objectsPath = `data/maps/objects/${gen1Name}.asm`;
	if (!gen1Files.exists(objectsPath)) return ev;
	const objText = gen1Files.text(objectsPath);
	const { bodies, textIds, headers } = gen1Script(gen1Files, gen1Name);
	const texts = gen1TextLabels(gen1Files);
	const prefix = entry.name; // every new label starts with the CSE map's name
	const constPrefix = entry.name.toUpperCase();
	const flagPrefix = `EVENT_${entry.const}`;
	const used = new Set<string>();
	// A name already used gets a number: labels as Potion2, constants (all capitals) as POTION_2.
	const unique = (s: string) => {
		let out = s, n = 2;
		while (used.has(out)) out = `${s}${/^[A-Z0-9_]+$/.test(s) || /\d$/.test(s) ? "_" : ""}${n++}`;
		used.add(out);
		return out;
	};
	const missing = (kind: MissingKind, gen1: string, suggestion?: string) => {
		if (!ev.missing.some((m) => m.kind === kind && m.gen1 === gen1)) ev.missing.push({ kind, gen1, suggestion });
	};
	const item = (gen1: string) => {
		const name = gen1.replace(/;.*/, "").trim();
		const cse = tables.items[name] ?? (names.items.has(name) ? name : undefined);
		if (!cse) missing("item", name);
		return cse ?? name;
	};
	const sprite = (gen1: string) => {
		const t = tables.sprites[gen1];
		const cse = t?.cse ?? (names.sprites.has(gen1) ? gen1 : undefined);
		if (!cse) missing("sprite", gen1, tables.defaults.spriteSuggestions[gen1]);
		if (gen1 !== "SPRITE_POKE_BALL" && gen1 !== "SPRITE_BOULDER" && t?.palette === undefined) missing("palette", gen1, names.npcPalettes[0]);
		return { cse: cse ?? gen1, palette: t?.palette ?? "0" };
	};
	const species = (gen1: string) => {
		const cse = tables.species[gen1] ?? tables.defaults.species[gen1] ?? (names.species.has(gen1) ? gen1 : undefined);
		if (!cse) missing("species", gen1);
		return cse ?? gen1;
	};
	const trainerClass = (gen1: string) => {
		const cse = tables.classes[gen1] ?? (names.classes.has(gen1) ? gen1 : tables.defaults.classes[gen1]);
		if (!cse || !names.classes.has(cse)) missing("class", gen1, tables.defaults.classes[gen1]);
		return cse ?? gen1;
	};
	/**
	 * Copy a text under a new label (or with none, right after the script before it); a non-plain
	 * one becomes "…" and a report line. Returns a few words of it, or "stub", for the preview's hover label.
	 */
	const writeText = (label: string | undefined, t: Gen1Text, what: string): string => {
		if (label) ev.scripts.push(`${label}:`);
		const gist = t.body ? `"${t.body.map((l) => l.match(/"(.*)"/)?.[1] ?? "").filter(Boolean).join(" ").slice(0, 40)}…"${t.copiedFromCode ? " (words only; its code wasn't ported)" : ""}` : `stub (${t.why})`;
		if (t.body) {
			ev.scripts.push(...t.body);
			if (t.copiedFromCode) ev.report.push(`${what}: ${t.copiedFromCode}`);
			for (const l of t.body) {
				const s = l.match(/"(.*)"/)?.[1];
				if (s !== undefined && textTiles(s) > 18) ev.report.push(`${label ?? what}: "${s}" is ${textTiles(s)} tiles (18 fit)`);
				if (s?.includes("<RIVAL>")) ev.report.push(`${label ?? what}: <RIVAL> prints your Johto rival's name, not Blue's`);
			}
		} else {
			ev.scripts.push("\ttext \"…\"", "\tdone");
			ev.report.push(`${what}: a stub (${t.why}); write it by hand`);
		}
		ev.scripts.push("");
		return gist;
	};
	const mark = (x: string | number | undefined, y: string | number | undefined, kind: EventMark["kind"], label: string) =>
		ev.marks.push({ x: Number(x), y: Number(y), kind, label });
	// A Gen 1 label under the CSE map's name, always ending in Text (it labels the words).
	const renameLabel = (gen1Label: string) => (prefix + gen1Label.replace(new RegExp(`^${gen1Name}`), "")).replace(/(?<!Text)$/, "Text");

	// Signs
	for (const [x, y, id] of macroCalls(objText, "bg_event")) {
		const gen1Label = textIds.get(id ?? "");
		if (gen1Label === "MartSignText" || gen1Label === "PokeCenterSignText") {
			const mart = gen1Label === "MartSignText";
			if (collisionSigns) {
				signByCollision(x, y, mart ? "mart" : "pokecenter", mart ? "Mart sign" : "Poké Center sign");
				continue;
			}
			const script = unique(`${prefix}${mart ? "Mart" : "Pokecenter"}Sign`);
			const made = style.std(`${x}, ${y}`, "BGEVENT_READ", script, mart ? STD.mart : STD.pokecenter);
			ev.bgEvents.push(made.bg);
			ev.scripts.push(...made.script);
			mark(x, y, "sign", mart ? "Mart sign" : "Poké Center sign");
			continue;
		}
		const textLabel = unique(renameLabel(gen1Label ?? `${id}Text`));
		const script = unique(textLabel.replace(/Text$/, "") + "Script");
		const made = style.sign(`${x}, ${y}`, script, textLabel);
		ev.bgEvents.push(made.bg);
		ev.scripts.push(...made.script);
		mark(x, y, "sign", `Sign: ${writeText(textLabel, resolveText(gen1Label, bodies, texts), `sign at ${x},${y}`)}`);
	}

	// Hidden events
	for (const [x, y, fn, arg] of gen1HiddenEvents(gen1Files, gen1Const)) {
		if (fn === "HiddenItems") {
			const cseItem = item(arg);
			const label = unique(`${prefix}Hidden${camel(cseItem)}`);
			const flag = unique(`${flagPrefix}_HIDDEN_${cseItem}`);
			ev.flags.push(flag);
			const hidden = ITEM_EVENTS[formats.itemEvents].hidden(`${String(x).padStart(2)}, ${String(y).padStart(2)}`, cseItem, label, flag, names);
			if ("problem" in hidden) {
				ev.flags.pop();
				ev.notes.push(`\t; Gen 1 hidden item at ${x}, ${y}: ${cseItem} (not placed: ${hidden.problem})`);
				ev.report.push(`hidden item at ${x},${y}: ${hidden.problem}, so it isn't placed`);
				mark(x, y, "unplaced", `Hidden item ${cseItem} (not placed)`);
				continue;
			}
			ev.bgEvents.push(hidden.bg);
			ev.scripts.push(...hidden.script);
			mark(x, y, "hidden", `Hidden item: ${cseItem}`);
			continue;
		}
		const std: Record<string, [string, Std, CollisionSign?]> = {
			OpenPokemonCenterPC: ["BGEVENT_UP", STD.pc],
			PrintBookcaseText: ["BGEVENT_READ", STD.bookshelf],
			PrintMagazinesText: ["BGEVENT_READ", STD.magazines],
			PrintTrashText: ["BGEVENT_READ", STD.trash, "trash"],
			GymTrashScript: ["BGEVENT_READ", STD.trash, "trash"],
		};
		const s = std[fn];
		if (s?.[2] && collisionSigns) {
			signByCollision(x, y, s[2], fn);
		} else if (s) {
			const label = unique(`${prefix}${fn.replace(/^Print|Text$|Script$/g, "")}`);
			const made = style.std(`${String(x).padStart(2)}, ${String(y).padStart(2)}`, s[0], label, s[1]);
			ev.bgEvents.push(made.bg);
			ev.scripts.push(...made.script);
			mark(x, y, "sign", `${fn} → ${made.script.length ? `jumpstd ${s[1].script}` : s[1].std}`);
		} else if (fn === "GymStatues") {
			const label = unique(`${prefix}GymStatue`);
			const made = style.sign(`${String(x).padStart(2)}, ${String(y).padStart(2)}`, label, `${label}Text`);
			ev.bgEvents.push(made.bg);
			ev.scripts.push(...made.script, `${label}Text:`, "\ttext \"…\"", "\tdone", "");
			ev.report.push(`gym statue at ${x},${y}: a stub; the project's GymStatue scripts need the gym's own setup`);
			mark(x, y, "sign", "Gym statue (stub)");
		} else {
			ev.notes.push(`\t; Gen 1 hidden event at ${x}, ${y}: ${fn}${arg ? ` ${arg}` : ""} (not ported)`);
			ev.report.push(`hidden event at ${x},${y} (${fn}) isn't ported`);
			mark(x, y, "unplaced", `Hidden event ${fn} (not ported)`);
		}
	}

	// Objects, in order, with Gen 1's object constants
	const gen1Consts = lines(objText).flatMap((l) => l.match(/^const_export\s+(\w+)/)?.[1] ?? []);
	const gen1ConstPrefix = gen1Name.toUpperCase();
	const cseObjConst = (gen1Obj: string) => gen1Obj.replace(new RegExp(`^${gen1ConstPrefix}`), constPrefix);

	// Holes and landings. Warp numbers follow Gen 1's: after a map's own warps come the landings from
	// holes above (in hole order), then its holes. A hole or landing whose other map isn't ported
	// yet points back at itself until it is.
	const nameOf = new Map(gen1MapHeaders(gen1Files).map((h) => [h.constName, h.name]));
	const warpCount = (map: string) => {
		const path = `data/maps/objects/${nameOf.get(map)}.asm`;
		return gen1Files.exists(path) ? macroCalls(gen1Files.text(path), "warp_event").length : 0;
	};
	const holesMap = allHoles(gen1Files);
	const landingsOnto = (dest: string) =>
		[...holesMap].flatMap(([src, hs]) => hs.map((h, i) => ({ src, i, h })).filter((o) => o.h.dest === dest)).sort((a, b) => a.i - b.i);
	const holeWarpNo = (src: string, i: number) => warpCount(src) + landingsOnto(src).length + i + 1;
	const landingWarpNo = (dest: string, src: string, i: number) => warpCount(dest) + 1 + landingsOnto(dest).findIndex((o) => o.src === src && o.i === i);
	const sq = (x: number, y: number) => `${String(x).padStart(2)}, ${String(y).padStart(2)}`;
	landingsOnto(gen1Const).forEach((o, j) => {
		const src = ported(o.src);
		const land = o.h.land!;
		ev.extraWarps.push(src
			? `\twarp_event ${sq(land.x, land.y)}, ${src}, ${holeWarpNo(o.src, o.i)} ; landing from a hole on ${src}`
			: `\twarp_event ${sq(land.x, land.y)}, ${entry.const}, ${warpCount(gen1Const) + 1 + j} ; landing from a hole on ${o.src} (not ported yet)`);
	});
	const holes = holesMap.get(gen1Const) ?? [];
	holes.forEach((h, k) => {
		const dest = ported(h.dest);
		ev.extraWarps.push(dest
			? `\twarp_event ${sq(h.x, h.y)}, ${dest}, ${landingWarpNo(h.dest, gen1Const, k)} ; hole`
			: `\twarp_event ${sq(h.x, h.y)}, ${entry.const}, ${holeWarpNo(gen1Const, k)} ; hole to ${h.dest} (not ported yet)`);
		mark(h.x, h.y, "hole", dest ? `Hole to ${dest}` : `Hole to ${h.dest} (a pit for now; it leads nowhere until that map is ported)`);
		if (!dest) ev.report.push(`hole at ${h.x},${h.y}: ${h.dest} isn't ported yet, so it's a pit that leads nowhere; port it, then port this map again`);
	});

	// Falling boulders: each boulder in a chain has a "gone" flag as its object flag. Boulder i falls
	// into hole i, disappearing here and showing the matching boulder below; boulders below a hole
	// start gone (set at game start).
	const goneFlag = (cseMap: string, gen1Obj: string) => `EVENT_${cseMap}_BOULDER${gen1Obj.match(/BOULDER(\d+)$/)?.[1] ?? "1"}_GONE`;
	const toggles = gen1BoulderToggles(gen1Files, gen1Name);
	const fallsHere = new Map(toggles.map((t, k) => [toggleObject(t.hide)?.object ?? "", k]));
	const landsHere = new Set<string>();
	for (const [src] of holesMap) {
		for (const t of gen1BoulderToggles(gen1Files, nameOf.get(src) ?? "")) {
			const shown = toggleObject(t.show);
			if (shown?.map === gen1Const) landsHere.add(shown.object);
		}
	}
	const falls: BoulderFall[] = [];
	toggles.forEach((t, k) => {
		const hide = toggleObject(t.hide), show = toggleObject(t.show);
		const dest = show && ported(show.map);
		if (!hide || !show || !holes[k] || !dest) return;
		falls.push({ n: k + 1, warp: holeWarpNo(gen1Const, k), object: cseObjConst(hide.object), shows: goneFlag(dest, show.object) });
	});
	if (falls.length) {
		const made = FALLING_BOULDERS[formats.boulders](prefix, falls);
		ev.callbacks.push(...made.callbacks);
		ev.scripts.push(...made.scripts);
	}
	const parties = gen1Parties(gen1Files);
	const special = gen1SpecialMoves(gen1Files);
	let trainerNumber = 0;
	macroCalls(objText, "object_event").forEach((o, i) => {
		const [x, y, spr, kind, arg, textId, a7, a8] = o;
		const xy = `${String(x).padStart(2)}, ${String(y).padStart(2)}`;
		const objConst = (gen1Consts[i] ?? `${gen1ConstPrefix}_OBJECT_${i + 1}`).replace(new RegExp(`^${gen1ConstPrefix}`), constPrefix);
		const gen1Label = textIds.get(textId ?? "");
		// Static Pokémon: a species and a level (D65)
		if (a7 && a8 && !a7.startsWith("OPP_")) {
			ev.notes.push(`\t; Gen 1 static Pokémon at ${xy}: ${a7}, level ${a8} (not placed)`);
			ev.report.push(`static Pokémon ${a7} (level ${a8}) at ${x},${y} isn't placed`);
			mark(x, y, "unplaced", `Static Pokémon ${a7}, level ${a8} (not placed)`);
			return;
		}
		// Item balls
		if (a7 && !a8) {
			const cseItem = item(a7);
			const label = unique(`${prefix}${camel(cseItem)}`);
			const flag = unique(`${flagPrefix}_${cseItem}`);
			ev.flags.push(flag);
			ev.objectConsts.push(`\tconst ${objConst}`);
			const ball = ITEM_EVENTS[formats.itemEvents].ball(xy, cseItem, label, flag, names, objectEvent);
			ev.objectEvents.push(ball.object);
			ev.scripts.push(...ball.script);
			mark(x, y, "item", `Item ball: ${cseItem}`);
			return;
		}
		// Boulders: a Strength boulder, with one shared script per map where the project needs one.
		// Gen 1's boulder puzzles (holes, currents) are map scripts; holes are handled above.
		if (spr === "SPRITE_BOULDER") {
			ev.objectConsts.push(`\tconst ${objConst}`);
			const script = `${prefix}Boulder`;
			const gen1Obj = gen1Consts[i] ?? "";
			const falls = fallsHere.has(gen1Obj), lands = landsHere.has(gen1Obj);
			let flag = "-1";
			if (falls || lands) {
				flag = goneFlag(entry.const, gen1Obj);
				ev.flags.push(flag);
				if (lands) ev.initFlags.push(flag);
			}
			const fields = { xy, sprite: "", movement: "SPRITEMOVEDATA_STRENGTH_BOULDER", rx: 0, ry: 0, palette: "0", type: "OBJECTTYPE_SCRIPT", sight: 0, script, flag };
			// Only a boulder written as an object_event names its sprite.
			if (style.boulder(fields).needsScript) fields.sprite = sprite(spr).cse;
			const made = style.boulder(fields);
			if (!used.has(script)) {
				used.add(script);
				if (made.needsScript) ev.scripts.push(...style.boulderScript(script));
				if (gen1Name.startsWith("SeafoamIslandsB3") || gen1Name.startsWith("SeafoamIslandsB4")) ev.report.push("Seafoam's water currents (which stop once both B2F boulders fell) are code and aren't ported");
			}
			ev.objectEvents.push(made.object);
			mark(x, y, "boulder", `Strength boulder${falls ? " (falls into the hole below)" : ""}${lands ? " (appears once the boulder above falls)" : ""}`);
			return;
		}
		const { cse: cseSprite, palette } = sprite(spr ?? "");
		const mv = movement(kind ?? "", arg ?? "");
		ev.objectConsts.push(`\tconst ${objConst}`);
		// Trainers (P28-P33)
		if (a7?.startsWith("OPP_") && a8) {
			trainerNumber++;
			const gen1Class = a7.slice(4);
			const cseClass = trainerClass(gen1Class);
			const partyNo = Number(a8);
			const gen1Party = parties.get(gen1Class)?.[partyNo - 1];
			const num = String(trainerNumber);
			const name = `${entry.name.toUpperCase().slice(0, 10 - 1 - num.length)} ${num}`;
			const constName = `${entry.const}_TRAINER_${num}`;
			const changes = special.get(`${gen1Class} ${partyNo}`);
			const mons = (gen1Party ?? []).map((m, k) => {
				const s = species(m.species);
				let moves: string[] | undefined, dropped: string[] | undefined;
				if (changes) {
					moves = defaultMoves(names.learnsets.get(s) ?? [], m.level);
					for (const [mon, slot, move] of changes) if (mon === k + 1) moves[slot - 1] = move;
					// A move the project doesn't have is dropped; the moves after it move up.
					const unknown = moves.filter((mv) => mv !== "NO_MOVE" && !names.moves.has(mv));
					if (unknown.length) {
						dropped = unknown;
						moves = moves.filter((mv) => !unknown.includes(mv));
						while (moves.length < 4) moves.push("NO_MOVE");
						ev.report.push(`trainer ${num} (${gen1Class} ${partyNo}): ${s} drops ${unknown.join(" and ")}, which the project doesn't have`);
					}
				}
				return { level: m.level, species: s, moves, ...(dropped && { dropped }) };
			});
			if (!gen1Party) ev.report.push(`trainer at ${x},${y}: ${gen1Class} party ${partyNo} not found in Gen 1's parties`);
			ev.trainers.push({ cseClass, constName, name, moves: !!changes, mons, source: `${gen1Class} ${partyNo}` });
			// The object's text either points at a trainer header (a normal trainer) or is its own code.
			const headerLabel = (bodies.get(gen1Label ?? "") ?? []).map((l) => l.match(/^ld\s+hl,\s*(\w+TrainerHeader\w*)/)?.[1]).find(Boolean);
			const header = headerLabel ? headers.get(headerLabel) : undefined;
			const flag = unique(`EVENT_BEAT_${cseClass}_${constName}`);
			ev.flags.push(flag);
			const label = unique(`${prefix}Trainer${num}`);
			if (header) {
				const [, sight, battle, endBattle, after] = header;
				const made = style.trainer({ xy, sprite: cseSprite, movement: mv.data, rx: mv.rx, ry: mv.ry, palette, sight: parseNumber(sight ?? "") ?? 3 }, label, cseClass, constName, flag);
				ev.objectEvents.push(made.object);
				ev.scripts.push(...made.script);
				// Where the after-battle text has no label, it follows the trainer's script directly.
				if (!made.afterLabel) writeText(undefined, resolveText(after, bodies, texts), `trainer ${num} after-battle text`);
				writeText(`${label}SeenText`, resolveText(battle, bodies, texts), `trainer ${num} battle text`);
				writeText(`${label}BeatenText`, resolveText(endBattle, bodies, texts), `trainer ${num} end-battle text`);
				if (made.afterLabel) writeText(made.afterLabel, resolveText(after, bodies, texts), `trainer ${num} after-battle text`);
				mark(x, y, "trainer", `Trainer ${num}: ${gen1Class} party ${partyNo} → ${cseClass} "${name}", sight ${parseNumber(sight ?? "") ?? 3}`);
			} else {
				// Scripted (gym leaders, rivals, Giovanni...): the party is ported; the battle is a stub (P33).
				ev.objectEvents.push(objectEvent({ xy, sprite: cseSprite, movement: mv.data, rx: mv.rx, ry: mv.ry, palette, type: "OBJECTTYPE_SCRIPT", sight: 0, script: label, flag: "-1" }));
				ev.scripts.push(`${label}:`, `\t; Gen 1's ${gen1Label ?? textId} is a scripted battle: ${cseClass}, ${constName}`, `\tjumptextfaceplayer ${label}Text`, "");
				mark(x, y, "trainer", `Trainer ${num}: ${gen1Class} party ${partyNo} → ${cseClass} "${name}", a scripted battle (stub)`);
				writeText(`${label}Text`, { why: `${gen1Label ?? textId} is a scripted battle`, code: [] }, `trainer ${num} (${gen1Class})`);
			}
			return;
		}
		// People (P22)
		const textLabel = unique(renameLabel(gen1Label ?? `${objConst}Text`));
		const made = style.person({ xy, sprite: cseSprite, movement: mv.data, rx: mv.rx, ry: mv.ry, palette, flag: "-1" }, () => unique(textLabel.replace(/Text$/, "") + "Script"), textLabel);
		ev.objectEvents.push(made.object);
		ev.scripts.push(...made.script);
		mark(x, y, "person", `Person (${cseSprite}): ${writeText(textLabel, resolveText(gen1Label, bodies, texts), `person at ${x},${y}`)}`);
	});
	return ev;
}
