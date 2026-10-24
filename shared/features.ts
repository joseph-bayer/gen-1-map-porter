// A project is described by what it supports, not by an engine name: one entry per feature, each
// with the variants the porter knows. The probes (shared/node/features.ts) read the project's own
// definitions to find each feature's variant. Code that reads or writes a project's formats asks
// for the features it needs; a variant it can't handle yet is refused, naming the feature.

interface VariantInfo {
	label: string;
	/** The porter reads and writes this variant. */
	supported: boolean;
}

export const FEATURES = {
	tileColors: {
		label: "Tile colors",
		variants: {
			"block-attributes": { label: "per block (*_attributes.bin)", supported: true },
			"palette-map": { label: "per tile (a palette map)", supported: true },
		},
	},
	tilesetSize: {
		label: "Tileset size",
		variants: {
			"384": { label: "384 tiles (vTiles2, vTiles4, vTiles5)", supported: true },
			"192": { label: "192 tiles (one sheet)", supported: true },
			"3x128": { label: "3 × 128 tiles (GFX0, GFX1, GFX2)", supported: true },
		},
	},
	blockFiles: {
		label: "Map block files",
		variants: {
			ablk: { label: ".ablk", supported: true },
			blk: { label: ".blk", supported: true },
			"ablk-lzp": { label: ".ablk, compressed (.ablk.lzp)", supported: true },
		},
	},
	mapGroups: {
		label: "Map groups",
		variants: {
			named: { label: "newgroup NAME … endgroup", supported: true },
			unnamed: { label: "newgroup without a name (groups by number)", supported: true },
		},
	},
	mapHeader: {
		label: "Map header row (map)",
		variants: {
			"fish-group": { label: "8 arguments, ending in a fish group", supported: true },
			sign: { label: "8 arguments, with a sign column and no fish group", supported: true },
		},
	},
	mapAttributes: {
		label: "Map attributes (map_attributes)",
		variants: {
			"connection-mask": { label: "4 arguments, with a connections mask; _MapScripts and _MapEvents", supported: true },
			"connection-lines": { label: "3 arguments, connections set by the connection lines; _MapScripts and _MapEvents", supported: true },
			"script-header": { label: "3 arguments; _MapScriptHeader", supported: true },
		},
	},
	objectEvent: {
		label: "object_event",
		variants: {
			"13": { label: "13 arguments (two hour fields)", supported: true },
			"12": { label: "12 arguments (one time-of-day field), with generictrainer, strengthboulder_event and BGEVENT_JUMPTEXT", supported: true },
		},
	},
	itemEvents: {
		label: "Item balls and hidden items",
		variants: {
			scripts: { label: "itemball and hiddenitem scripts", supported: true },
			"event-macros": { label: "itemball_event and BGEVENT_ITEM", supported: true },
		},
	},
	indexWidth: {
		label: "Species, item and move width",
		variants: {
			"16-bit": { label: "16-bit (dw)", supported: true },
			"8-bit": { label: "8-bit (db)", supported: true },
			"9-bit-forms": { label: "9-bit species with forms", supported: true },
		},
	},
	collisionNames: {
		label: "Collision names",
		variants: {
			"pit-hop": { label: "PIT, HOP_*", supported: true },
			"hole-ledge": { label: "HOLE, LEDGE_*, with MART_SIGN, POKECENTER_SIGN and TRASH_CAN", supported: true },
		},
	},
	eventFlags: {
		label: "Event flags",
		variants: {
			padded: { label: "a fixed-size list, padded by const_next", supported: true },
		},
	},
	startingFlags: {
		label: "Starting flags",
		variants: {
			"initialize-events-script": { label: "setevent in InitializeEventsScript", supported: true },
			"initial-events-list": { label: "the InitialEvents: list", supported: true },
		},
	},
	trainerParties: {
		label: "Trainer parties",
		variants: {
			"list-items": { label: "next_list_item, TRAINERTYPE_* flags, one field a line", supported: true },
			rows: { label: "one db row per Pokémon", supported: true },
			"def-trainer": { label: "def_trainer and tr_mon", supported: true },
		},
	},
	boulders: {
		label: "Falling boulders",
		variants: {
			"stonetable-cmdqueue": { label: "stonetable in a cmdqueue callback", supported: true },
			usestonetable: { label: "usestonetable", supported: true },
		},
	},
} as const satisfies Record<string, { label: string; variants: Record<string, VariantInfo> }>;

export type FeatureId = keyof typeof FEATURES;
export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

type Variants<F extends FeatureId> = (typeof FEATURES)[F]["variants"];
export type Variant<F extends FeatureId> = keyof Variants<F> & string;
/** The variants of a feature the porter handles. */
export type Supported<F extends FeatureId> = { [V in Variant<F>]: Variants<F>[V] extends { supported: true } ? V : never }[Variant<F>];
/** The variant in effect for each of some features, as code that handles them receives it. */
export type Formats<F extends FeatureId> = { [K in F]: Supported<K> };

/** What a probe read from the project for one feature. */
export interface Detected {
	/** The variant it matches; undefined when it matches none the porter knows. */
	variant?: string;
	/** What was read, as a clause after "this project's": "object_event takes 13 arguments". */
	detail: string;
	/** Where it was read from, relative to the project. */
	source: string;
}

/** One feature of a project: what was detected, any override, and the variant in effect. */
export interface FeatureState {
	id: FeatureId;
	label: string;
	detected: Detected;
	override?: string;
	/** The override if there is one, else the detected variant. */
	variant?: string;
	supported: boolean;
}

export interface ProjectFeatures {
	features: FeatureState[];
	/** The known base whose features all match, if any (a label only: it picks the default names). */
	looksLike?: string;
	/** The tool's shipped default names for that base (a folder of the tool's tables/), if it has any. */
	defaults?: string;
	/** What to raise by hand when the event flags run out, finishing "To make room, …". */
	moreFlags: string;
}

/** What to raise by hand for more event flags, in a project that looks like no known base. */
const MORE_FLAGS = "raise the const_next cap above NUM_EVENTS in constants/event_flags.asm, and make room for the larger flag array (wEventFlags, a byte per 8 flags) wherever the project keeps it.";

/** What to raise by hand for more event flags, where the flag array is in an almost full WRAM bank 1. */
const FLAGS_IN_WRAM_1 = "raise the const_next cap above NUM_EVENTS in constants/event_flags.asm. The flag array (wEventFlags in ram/wram.asm, a byte per 8 flags) is in WRAM bank 1, which has only a few bytes free, so free room there first, or the build won't link.";

/**
 * The known bases, by their features. The code never branches on these; they label and set
 * defaults (names, and what the out-of-flags message tells you to raise).
 */
export const BASES: { label: string; defaults?: string; moreFlags: string; features: { [F in FeatureId]: Variant<F> } }[] = [
	{
		label: "CSE",
		defaults: "cse",
		moreFlags: FLAGS_IN_WRAM_1,
		features: {
			tileColors: "block-attributes", tilesetSize: "384", blockFiles: "ablk", mapGroups: "named", mapHeader: "fish-group",
			mapAttributes: "connection-mask", objectEvent: "13", itemEvents: "scripts", indexWidth: "16-bit", collisionNames: "pit-hop",
			eventFlags: "padded", startingFlags: "initialize-events-script", trainerParties: "list-items", boulders: "stonetable-cmdqueue",
		},
	},
	{
		label: "pokecrystal",
		defaults: "pokecrystal",
		moreFlags: FLAGS_IN_WRAM_1,
		features: {
			tileColors: "palette-map", tilesetSize: "192", blockFiles: "blk", mapGroups: "named", mapHeader: "fish-group",
			mapAttributes: "connection-lines", objectEvent: "13", itemEvents: "scripts", indexWidth: "8-bit", collisionNames: "pit-hop",
			eventFlags: "padded", startingFlags: "initialize-events-script", trainerParties: "rows", boulders: "stonetable-cmdqueue",
		},
	},
	{
		label: "Polished Crystal",
		defaults: "polishedcrystal",
		// The save's checksums are asserted at fixed addresses, so the paddings after the game data shrink as it grows.
		moreFlags: "raise the const_next cap above NUM_EVENTS in constants/event_flags.asm, and shrink both save paddings in ram/sram.asm (the `ds … ; unused` after sOptions3 and after sBackupOptions3) by the bytes the flag array grows (a byte per 8 flags), so the checksums stay where the asserts want them.",
		features: {
			tileColors: "block-attributes", tilesetSize: "3x128", blockFiles: "ablk-lzp", mapGroups: "unnamed", mapHeader: "sign",
			mapAttributes: "script-header", objectEvent: "12", itemEvents: "event-macros", indexWidth: "9-bit-forms", collisionNames: "hole-ledge",
			eventFlags: "padded", startingFlags: "initial-events-list", trainerParties: "def-trainer", boulders: "usestonetable",
		},
	},
];

export function variantLabel(id: FeatureId, variant: string | undefined): string | undefined {
	return variant === undefined ? undefined : (FEATURES[id].variants as Record<string, VariantInfo>)[variant]?.label;
}

export function isSupported(id: FeatureId, variant: string | undefined): boolean {
	return variant !== undefined && !!(FEATURES[id].variants as Record<string, VariantInfo>)[variant]?.supported;
}

/** The variants an override can pick: the ones the porter handles. */
export function overrideChoices(id: FeatureId): string[] {
	return Object.entries(FEATURES[id].variants as Record<string, VariantInfo>).filter(([, v]) => v.supported).map(([k]) => k);
}

/** Each feature's state, the base it looks like, and that base's defaults. */
export function describeFeatures(detected: Record<FeatureId, Detected>, overrides: Partial<Record<FeatureId, string>>): ProjectFeatures {
	const features = FEATURE_IDS.map((id): FeatureState => {
		const override = overrides[id];
		const variant = override ?? detected[id].variant;
		return { id, label: FEATURES[id].label, detected: detected[id], ...(override !== undefined && { override }), variant, supported: isSupported(id, variant) };
	});
	const base = BASES.find((b) => features.every((f) => f.variant === b.features[f.id]));
	return { features, looksLike: base?.label, defaults: base?.defaults, moreFlags: base?.moreFlags ?? MORE_FLAGS };
}

/** Why the project can't be handled for this feature, naming it, or undefined. */
export function refusal(state: FeatureState): string | undefined {
	if (state.supported) return undefined;
	if (state.variant === undefined) return `${state.label}: this project's ${state.detected.detail}, which the porter doesn't know`;
	return `${state.label}: this project's ${state.detected.detail}, which the porter can't handle yet`;
}

/**
 * The variant in effect for each feature asked for, or an error naming every one the porter can't
 * handle. Code that reads or writes a project's formats calls this with the features it needs.
 */
export function need<F extends FeatureId>(project: ProjectFeatures, ids: readonly F[]): Formats<F> {
	const out = {} as Formats<F>;
	const problems: string[] = [];
	for (const id of ids) {
		const state = project.features.find((f) => f.id === id)!;
		const why = refusal(state);
		if (why) problems.push(why);
		else out[id] = state.variant as Supported<typeof id>;
	}
	if (problems.length) throw new Error(problems.join("; "));
	return out;
}
