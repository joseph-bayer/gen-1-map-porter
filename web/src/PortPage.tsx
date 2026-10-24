// Route B: pair a Gen 1 map's blocks with CSE blocks (or build them from CSE tiles), check the
// collision against Gen 1's, preview the result, and port it into the configured CSE tree.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
	AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { cseKind, gen1BlockKinds, isWalkable, wallSides, type CollKind } from "../../shared/coll";
import {
	defaultCollName, resolveMapping, walkabilityDiff, withAppended,
	type BlockPairing, type Mapping, type TilePick,
} from "../../shared/mapping";
import { idAttrToPick, picksColors, sheetTilePalette } from "../../shared/tile-layout";
import { suggestBlocks } from "../../shared/suggest";
import { finalGrid } from "../../shared/warps";
import { reconcile, stamp } from "../../shared/fingerprint";
import { TIMES, type Game, type TimeOfDay } from "../../shared/types";
import type { Gen1MapRow } from "../../shared/setup";
import { listGen1Maps, loadPlace, loadPortContext, savePlace, portVersion, runPort, saveMapping, type EventKind, type EventMark, type PortContext, type PortReport } from "./api";
import { BlockCanvas, MapCanvas, TileSheet, viewOf } from "./canvas";
import { SetupDialog } from "./SetupDialog";
import { MatchPanel } from "./MatchPanel";
import { Combobox } from "@/components/Combobox";

const hex = (n: number) => `$${n.toString(16).padStart(2, "0")}`;
/** CSE's `PAL_BG_*` names, as Polished Map++ shows them. */
const PAL_NAMES = ["GRAY", "RED", "GREEN", "WATER", "YELLOW", "BROWN", "ROOF", "TEXT"];
type PreviewScale = 1 | 2 | 3 | 4 | "fit";
const PREVIEW_SCALES: PreviewScale[] = ["fit", 1, 2, 3, 4];
/** The gap between the two preview maps, in px (gap-4). */
const PREVIEW_GAP = 16;
/** The header's slots (App) for the map picker and stats, and for the action buttons. */
export const TOOLBAR_MAP_ID = "port-toolbar-map";
export const TOOLBAR_ACTIONS_ID = "port-toolbar-actions";
const SOURCE_GAMES: { value: Game; label: string }[] = [{ value: "yellow", label: "Yellow" }, { value: "red", label: "Red" }, { value: "blue", label: "Blue" }];
const QUAD = ["TL", "TR", "BL", "BR"];
const QUAD_CHIP = ["bg-red-100 text-red-800", "bg-blue-100 text-blue-800", "bg-green-100 text-green-800", "bg-purple-100 text-purple-800"];
/** The Gen 1 blocks and tabs cards: as tall as the block form beside them (h-0 keeps them from
 * growing the row), scrolling inside; a fixed height when the columns stack. */
const SIDE_CARD = "h-[420px] lg:h-0 lg:min-h-full";

/** Which quadrant a collision menu is for, kept visibly apart from the collision name. */
function QuadChip({ q }: { q: number }) {
	return <span className={`inline-block rounded px-1 align-middle font-mono leading-4 text-[10px] font-semibold ${QUAD_CHIP[q]}`}>{QUAD[q]}</span>;
}

/** A tooltip around a control. The span takes the hover, since a disabled button gets no mouse events. */
function Tip({ text, why, children }: { text: string; why?: string; children: React.ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span tabIndex={0} className="inline-flex">{children}</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">
				<p>{text}</p>
				{why && <p className="mt-1 font-medium">{why}</p>}
			</TooltipContent>
		</Tooltip>
	);
}


/** The Gen 1 map and the CSE result side by side. Hovering one lightens the same block on both;
 * the hover lives here so moving the mouse doesn't redraw the maps. */
function PreviewMaps({ gen1, cse }: { gen1: React.ComponentProps<typeof MapCanvas>; cse: React.ComponentProps<typeof MapCanvas> }) {
	const [hover, setHover] = useState<number | null>(null);
	return (
		<>
			<MapCanvas {...gen1} hover={hover} onHover={setHover} />
			<MapCanvas {...cse} hover={hover} onHover={setHover} />
		</>
	);
}

/** Preview overlay colors, shared by the canvas and the legend. */
const LEGEND = {
	lost: { fill: "rgba(255,0,0,0.45)", label: "Walkable in Gen 1, blocked here" },
	gained: { fill: "rgba(0,120,255,0.45)", label: "Blocked in Gen 1, walkable here" },
	kept: { line: "#ffd000", label: "Gen 1 elevation edge, still blocked here" },
	crossable: { line: "#ff2020", label: "Gen 1 elevation edge the player can cross here" },
	warp: { line: "#00e5ff", label: "Warp square: the port gives it collision that fires (arrow = carpet, press that way)" },
	warpStuck: { line: "#ff9900", label: "Warp square the port can't work out (see the report)" },
	edited: { line: "#c026d3", label: "Block changed outside the tool; porting overwrites it" },
} as const;

/** Event squares on both preview maps, by kind (inset, so walkability fills still show around them). */
const EVENT_KINDS: Record<EventKind, { fill: string; label: string }> = {
	item: { fill: "rgba(255,200,0,0.75)", label: "Item ball" },
	hidden: { fill: "rgba(255,120,0,0.7)", label: "Hidden item" },
	sign: { fill: "rgba(150,95,40,0.75)", label: "Sign or other bg event" },
	boulder: { fill: "rgba(70,110,160,0.75)", label: "Strength boulder" },
	hole: { fill: "rgba(20,20,20,0.8)", label: "Hole to the floor below" },
	person: { fill: "rgba(0,170,90,0.7)", label: "Person" },
	trainer: { fill: "rgba(160,60,230,0.7)", label: "Trainer" },
	unplaced: { fill: "rgba(110,110,110,0.7)", label: "Not ported (static Pokémon, other hidden events)" },
};

function drawEvents(ctx2d: CanvasRenderingContext2D, marks: EventMark[]) {
	for (const m of marks) {
		ctx2d.fillStyle = EVENT_KINDS[m.kind].fill;
		ctx2d.fillRect(m.x * 16 + 3, m.y * 16 + 3, 10, 10);
		ctx2d.strokeStyle = "rgba(0,0,0,0.6)";
		ctx2d.lineWidth = 1;
		ctx2d.strokeRect(m.x * 16 + 3.5, m.y * 16 + 3.5, 9, 9);
	}
}

function EventLegend({ marks }: { marks: EventMark[] }) {
	const kinds = (Object.keys(EVENT_KINDS) as EventKind[]).filter((k) => marks.some((m) => m.kind === k));
	if (!kinds.length) return null;
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
			{kinds.map((k) => (
				<span key={k} className="flex items-center gap-1.5">
					<span className="inline-block size-2.5 border border-black/60" style={{ background: EVENT_KINDS[k].fill }} />
					{EVENT_KINDS[k].label}
					<span className="text-muted-foreground">({marks.filter((m) => m.kind === k).length})</span>
				</span>
			))}
		</div>
	);
}

function Legend({ lost, gained, kept, crossable, warps, stuck, edited }: { lost: number; gained: number; kept: number; crossable: number; warps: number; stuck: number; edited: number }) {
	const square = (fill: string) => <span className="inline-block size-3.5 rounded-[2px] border border-black/20" style={{ background: fill }} />;
	const line = (color: string) => <span className="inline-block h-0.5 w-4" style={{ background: color }} />;
	const item = (mark: React.ReactNode, label: string, n?: number) => (
		<span className="flex items-center gap-1.5">{mark}{label}{n !== undefined && <span className="text-muted-foreground">({n})</span>}</span>
	);
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
			{item(square("repeating-linear-gradient(45deg,#ff00ff 0 3px,#3c003c 3px 6px)"), "Unpaired block")}
			{item(square(LEGEND.lost.fill), LEGEND.lost.label, lost)}
			{item(square(LEGEND.gained.fill), LEGEND.gained.label, gained)}
			{item(line(LEGEND.kept.line), LEGEND.kept.label, kept)}
			{item(line(LEGEND.crossable.line), LEGEND.crossable.label, crossable)}
			{item(<span className="inline-block size-3.5 rounded-[2px] border-2" style={{ borderColor: LEGEND.warp.line }} />, LEGEND.warp.label, warps)}
			{edited > 0 && item(<span className="inline-block size-3.5 rounded-[2px] border-2 border-dashed" style={{ borderColor: LEGEND.edited.line }} />, LEGEND.edited.label, edited)}
			{stuck > 0 && item(<span className="inline-block size-3.5 rounded-[2px] border-2 border-dashed" style={{ borderColor: LEGEND.warpStuck.line }} />, LEGEND.warpStuck.label, stuck)}
		</div>
	);
}

/** The collision dropdown's sections, in order; each name goes in the first that takes it. */
const COLL_SECTIONS: { label: string; takes: (name: string) => boolean }[] = [
	{ label: "Edge walls", takes: (n) => wallSides(n).length > 0 },
	{ label: "Floor", takes: (n) => cseKind(n) === "floor" },
	{ label: "Wall", takes: (n) => cseKind(n) === "wall" },
	{ label: "Water", takes: (n) => cseKind(n) === "water" },
	{ label: "Grass", takes: (n) => cseKind(n) === "grass" },
	{ label: "Ledges", takes: (n) => n.startsWith("HOP_") || n.startsWith("LEDGE_") },
	{ label: "Warps", takes: (n) => cseKind(n) === "warp" },
	{ label: "Other", takes: () => true },
];
const SECTION_ORDER = ["Floor", "Wall", "Edge walls", "Water", "Grass", "Ledges", "Warps", "Other"];

// TOP and BOTTOM are Polished Crystal's UP and DOWN in edge wall names, and sort with them.
const DIRS = new Set(["UP", "DOWN", "LEFT", "RIGHT", "TOP", "BOTTOM"]);
const DIR_ORDER = ["", "UP", "TOP", "DOWN", "BOTTOM", "LEFT", "RIGHT", "UP_LEFT", "TOP_LEFT", "UP_RIGHT", "TOP_RIGHT", "DOWN_LEFT", "BOTTOM_LEFT", "DOWN_RIGHT", "BOTTOM_RIGHT"];

/** A collision name's family, direction and variant: UP_LEFT_BUOY is BUOY / UP_LEFT, WATER_21 is
 * WATER / variant 21, WALK_DOWN_ALT is WALK / DOWN / variant ALT. */
function collParts(name: string): { family: string; dir: string; variant: string } {
	const t = name.split("_");
	let variant = "";
	if (t.length > 1 && (/^[0-9A-F]{2}$/.test(t.at(-1)!) || t.at(-1) === "ALT")) variant = t.pop()!;
	let lead = 0;
	while (lead < t.length - 1 && DIRS.has(t[lead]!)) lead++;
	let trail = t.length;
	if (!lead) while (trail > 1 && DIRS.has(t[trail - 1]!)) trail--;
	const dir = lead ? t.slice(0, lead) : t.slice(trail);
	return { family: t.slice(lead, trail).join("_"), dir: dir.join("_"), variant };
}

/** Sections in order; inside each, families in the order the constants file first defines them, and
 * inside a family the plain name, then directions, then numbered variants. */
function collSections(names: string[]): { label: string; names: string[] }[] {
	const firstSeen = new Map<string, number>();
	names.forEach((n, i) => firstSeen.has(collParts(n).family) || firstSeen.set(collParts(n).family, i));
	const key = (n: string) => {
		const p = collParts(n);
		const dir = DIR_ORDER.indexOf(p.dir);
		return [firstSeen.get(p.family)!, dir < 0 ? DIR_ORDER.length : dir, p.variant] as const;
	};
	const byKey = (a: string, b: string) => {
		const [fa, da, va] = key(a), [fb, db, vb] = key(b);
		return fa - fb || da - db || va.localeCompare(vb) || a.localeCompare(b);
	};
	const out = new Map<string, string[]>(SECTION_ORDER.map((label) => [label, []]));
	for (const n of names) out.get(COLL_SECTIONS.find((s) => s.takes(n))!.label)!.push(n);
	return [...out].filter(([, list]) => list.length).map(([label, list]) => ({ label, names: list.sort(byKey) }));
}

function kindColor(kind: CollKind | string): string {
	switch (kind) {
		case "floor": return "bg-emerald-100 text-emerald-900";
		case "wall": return "bg-stone-200 text-stone-800";
		case "water": return "bg-sky-100 text-sky-900";
		case "warp": return "bg-violet-100 text-violet-900";
		default: return "bg-amber-100 text-amber-900";
	}
}

export function PortPage() {
	const [game, setGame] = useState<Game>("yellow");
	const [maps, setMaps] = useState<Gen1MapRow[]>([]);
	const [mapsError, setMapsError] = useState<string | null>(null);
	/** The map the Set up / Map settings dialog is for, or null when it's closed. */
	const [setup, setSetup] = useState<{ game: Game; gen1Const: string } | null>(null);
	const [port, setPort] = useState<string>("");
	const [ctx, setCtx] = useState<PortContext | null>(null);
	const [mapping, setMapping] = useState<Mapping | null>(null);
	const [dirty, setDirty] = useState(false);
	const [time, setTime] = useState<TimeOfDay>("day");
	// The header's toolbar slot (App), where the map picker and actions render.
	const [toolbarSlots, setToolbarSlots] = useState<{ map: HTMLElement; actions: HTMLElement } | null>(null);
	useEffect(() => {
		const map = document.getElementById(TOOLBAR_MAP_ID), actions = document.getElementById(TOOLBAR_ACTIONS_ID);
		if (map && actions) setToolbarSlots({ map, actions });
	}, []);
	const [previewScale, setPreviewScale] = useState<PreviewScale>(() => {
		try {
			const saved = localStorage.getItem("gen1-map-porter:preview-scale");
			if (saved === "fit") return "fit";
			return PREVIEW_SCALES.includes(Number(saved) as PreviewScale) ? Number(saved) as PreviewScale : 2;
		} catch {
			return 2;
		}
	});
	// For the Fit scale: the preview area's width, kept up to date as the window resizes.
	const [previewArea, setPreviewArea] = useState<HTMLDivElement | null>(null);
	const [previewWidth, setPreviewWidth] = useState(0);
	useEffect(() => {
		if (!previewArea) return;
		const watch = new ResizeObserver(([e]) => setPreviewWidth(e!.contentRect.width));
		watch.observe(previewArea);
		return () => watch.disconnect();
	}, [previewArea]);
	const choosePreviewScale = (scale: PreviewScale) => {
		setPreviewScale(scale);
		try {
			localStorage.setItem("gen1-map-porter:preview-scale", String(scale));
		} catch {
			// not saved; the next visit starts at 2x
		}
	};
	const [selected, setSelected] = useState<number | null>(null);
	/** The tile, palette and flips painted onto a tile-built block's cells. */
	const [brush, setBrush] = useState<TilePick>({ tile: 0, pal: 0 });
	const [tab, setTab] = useState("suggest");
	const [showWalk, setShowWalk] = useState(true);
	const [showEdges, setShowEdges] = useState(true);
	const [showWarps, setShowWarps] = useState(true);
	const [showEvents, setShowEvents] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [report, setReport] = useState<PortReport | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Where this project was left last time (game, map, selected block), restored before anything loads.
	const [placeReady, setPlaceReady] = useState(false);
	const restoreBlock = useRef<number | undefined>(undefined);
	useEffect(() => {
		loadPlace().then((p) => {
			if (p) {
				setGame(p.game);
				setPort(p.map);
				restoreBlock.current = p.block;
			}
		}, () => {}).finally(() => setPlaceReady(true));
	}, []);

	// Every map in the chosen Gen 1 game, with its status; start on the first one that's set up.
	const refreshMaps = useCallback(() => {
		if (!placeReady) return;
		setMapsError(null);
		listGen1Maps(game).then((rows) => {
			setMaps(rows);
			setPort((p) => p || (rows.find((r) => r.status !== "new")?.gen1Const ?? ""));
		}, (e: Error) => {
			setMaps([]);
			setMapsError(e.message);
		});
	}, [game, placeReady]);
	useEffect(refreshMaps, [refreshMaps]);
	const pickMap = (gen1Const: string) => {
		const row = maps.find((r) => r.gen1Const === gen1Const);
		if (row?.status === "new") setSetup({ game, gen1Const });
		else setPort(gen1Const);
	};

	const [moves, setMoves] = useState<{ gen1: number; what: string }[]>([]);
	/** True while a new tileset pair shows its pre-filled (unsaved) starting mapping. */
	const [prefilled, setPrefilled] = useState(false);
	/** A port that stopped because the map's .ablk was edited outside the tool, awaiting Yes/No. */
	const [confirmOverwrite, setConfirmOverwrite] = useState<PortReport | null>(null);
	// The latest mapping and dirty flag, for reloads triggered from the poll below.
	const latest = useRef({ mapping, dirty });
	const blockForm = useRef<HTMLDivElement>(null);
	latest.current = { mapping, dirty };

	/** Load the port's context. `keepEdits`: keep unsaved pairings, re-checked against the new tileset. */
	const reload = useCallback((keepEdits = false) => {
		if (!port) return;
		setError(null);
		loadPortContext(port).then((c) => {
			const local = latest.current;
			setCtx(c);
			// The first block, or the one selected when the tool was last left (if the map still uses it).
			const want = restoreBlock.current;
			restoreBlock.current = undefined;
			const firstSelected = want !== undefined && c.used.includes(want) ? want : (c.used[0] ?? null);
			if (keepEdits && local.dirty && local.mapping) {
				const rec = reconcile(local.mapping, c.cse);
				setMapping(rec.mapping);
				if (rec.moved.length) setMoves((m) => [...m, ...rec.moved]);
			} else if (!c.mappingSaved && Object.keys(c.mapping.blocks).length === 0) {
				// A tileset pair with no saved mapping starts from each block's top suggestion.
				const blocks: Mapping["blocks"] = {};
				for (const g of c.used) {
					const kinds = gen1BlockKinds(c.gen1Coll, c.gen1Map.tileset.blocks, g);
					const top = suggestBlocks(c.gen1Map.tileset, g, kinds, c.cse, 1)[0];
					if (top) blocks[String(g)] = stamp({ cse: top.cse }, c.cse);
				}
				setMapping({ ...c.mapping, blocks });
				setDirty(true);
				setPrefilled(true);
				setMoves([]);
				if (!keepEdits) setSelected(firstSelected);
			} else {
				setMapping(c.mapping);
				setDirty(c.reconciled.moved.length > 0);
				setPrefilled(false);
				setMoves(c.reconciled.moved);
				if (!keepEdits) setSelected(firstSelected);
			}
		}, (e: Error) => setError(e.message));
	}, [port]);
	useEffect(() => reload(false), [reload]);

	// Remember where this project was left, a moment after the game, map or block last changed, or at
	// once if the page closes before then.
	useEffect(() => {
		if (!placeReady || !port || !ctx) return;
		const place = { game, map: port, ...(selected !== null && { block: selected }) };
		let saved = false;
		const save = (leaving: boolean) => {
			if (saved) return;
			saved = true;
			savePlace(place, leaving).catch(() => {});
		};
		const timer = setTimeout(() => save(false), 500);
		const onHide = () => save(true);
		window.addEventListener("pagehide", onHide);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("pagehide", onHide);
		};
	}, [placeReady, game, port, selected, ctx]);

	// Outside changes (Polished Map++, the PNG, the mapping file): reload within about a second.
	const version = ctx?.version;
	useEffect(() => {
		if (!port || version === undefined) return;
		const timer = setInterval(() => {
			portVersion(port).then((v) => v.version !== version && reload(true), () => {});
		}, 1000);
		return () => clearInterval(timer);
	}, [port, version, reload]);
	const changed = useMemo(() => new Set(ctx && mapping ? reconcile(mapping, ctx.cse).changed : []), [ctx, mapping]);

	const palettes = ctx ? ctx.palettes[ctx.pinnedTime ?? time] : undefined;
	const result = useMemo(() => ctx && mapping
		? resolveMapping(mapping, ctx.gen1Map.tileset, ctx.gen1Coll, ctx.cse, ctx.used, { warp: ctx.warpColl, names: ctx.collisionSet })
		: null, [ctx, mapping]);
	const final = useMemo(() => ctx && result ? finalGrid(ctx.gen1Map, ctx.gen1Coll, result, ctx.cse, ctx.warpColl, ctx.collisionSet, ctx.collisionSquares) : null, [ctx, result]);
	const cseResult = useMemo(() => ctx && final ? withAppended(ctx.cse, final.appended) : null, [ctx, final]);
	const gen1View = useMemo(() => ctx ? viewOf("yellow", ctx.gen1Map.tileset) : null, [ctx]);
	const cseView = useMemo(() => cseResult ? viewOf("cse", cseResult) : null, [cseResult]);
	const diff = useMemo(() => ctx && final && cseResult ? walkabilityDiff(ctx.gen1Map, ctx.gen1Coll, final.grid, cseResult) : null, [ctx, final, cseResult]);
	const counts = useMemo(() => {
		const m = new Map<number, number>();
		for (const b of ctx?.gen1Map.blocks ?? []) m.set(b, (m.get(b) ?? 0) + 1);
		return m;
	}, [ctx]);
	const sel = selected !== null ? result?.blocks.get(selected) : undefined;
	const pairing: BlockPairing | undefined = selected !== null ? mapping?.blocks[String(selected)] : undefined;
	const suggestions = useMemo(() => ctx && sel ? suggestBlocks(ctx.gen1Map.tileset, sel.gen1, sel.gen1Kinds, ctx.cse) : [], [ctx, sel]);

	const update = (g: number, next: BlockPairing | undefined) => {
		if (!mapping) return;
		const blocks = { ...mapping.blocks };
		if (next) blocks[String(g)] = next;
		else delete blocks[String(g)];
		setMapping({ ...mapping, blocks });
		setDirty(true);
	};

	// The game and map pickers, and the setup dialog: there even before a map loads (or when none is set up).
	const statusLabel = (r: Gen1MapRow) =>
		r.status === "new" ? (r.nameTaken ? "new · name taken" : "new") : r.entryGame && r.entryGame !== game ? `${r.status} (${r.entryGame})` : r.status;
	const picker = toolbarSlots && createPortal(
		<>
			<Select value={game} onValueChange={(v) => setGame(v as Game)}>
				<SelectTrigger size="sm" className="w-24"><SelectValue /></SelectTrigger>
				<SelectContent>{SOURCE_GAMES.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
			</Select>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex">
						<Combobox className="w-72" value={port || undefined} onChange={pickMap}
							placeholder={mapsError ? "No maps" : "Choose a map…"} searchPlaceholder="Type to filter (e.g. sea, route 3, new)…"
							options={maps.map((r) => ({
								value: r.gen1Const,
								label: r.gen1Const,
								detail: statusLabel(r),
								detailClassName: r.status === "new" ? "text-muted-foreground" : "font-medium text-primary",
							}))} />
					</span>
				</TooltipTrigger>
				<TooltipContent className="max-w-xs">
					{mapsError ?? (mapping ? `${mapping.gen1Tileset} → ${mapping.cseTileset}. Picking a new map opens Set up first.` : "Picking a new map opens Set up first.")}
				</TooltipContent>
			</Tooltip>
			{ctx && (
				<Tip text="Change this map's name, tileset, group or header in the project. The name and constant are fixed once it's ported; a new group moves it on the next Port.">
					<Button variant="outline" size="sm" onClick={() => setSetup({ game: String(ctx.entry.game) as Game, gen1Const: port })}>Map settings</Button>
				</Tip>
			)}
			<SetupDialog target={setup} onClose={() => setSetup(null)} onSaved={(g) => {
				setSetup(null);
				refreshMaps();
				if (g === port) reload(false);
				else setPort(g);
			}} />
		</>,
		toolbarSlots.map,
	);

	if (error) return <>{picker}<p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p></>;
	if (!port) return <>{picker}<p className="text-sm text-muted-foreground">{mapsError ?? "No map is set up yet. Pick one from the list above to set it up."}</p></>;
	if (!ctx || !mapping || !result || !cseResult || !gen1View || !cseView || !diff) return <>{picker}<p className="text-sm text-muted-foreground">Loading…</p></>;

	const g1 = ctx.gen1Map;
	/** The Gen 1 block whose own pairing makes new block `b` (not a link), if any. */
	const ownerOf = (b: number) =>
		[...result.blocks.values()].find((r) => r.cse === b && r.linkedTo === undefined && mapping.blocks[String(r.gen1)] !== undefined)?.gen1;
	const pairBlock = (g: number, cse: number) => {
		if (cse < ctx.cse.blockCount) return update(g, stamp({ cse }, ctx.cse));
		// A new block has no fixed number until it's ported, so pair by following the block that makes it.
		const owner = ownerOf(cse);
		if (owner !== undefined && owner !== g) update(g, { sameAs: owner });
	};
	const setColl = (g: number, q: number, name: string) => {
		const base = pairing?.coll ?? sel?.cseColl ?? sel?.gen1Kinds.map((k) => defaultCollName(k, { warp: ctx.warpColl, names: ctx.collisionSet })) ?? [];
		const coll = [...base];
		coll[q] = name;
		update(g, { ...pairing, coll });
	};
	const toTiles = (g: number) => {
		const from = sel?.cse;
		const tiles: TilePick[] = from !== undefined
			? [...Array(16).keys()].map((i) => idAttrToPick(cseResult.blocks[from * 16 + i]!, cseResult.attrs![from * 16 + i]!, cseResult))
			: [...Array(16)].map(() => ({ tile: 0, pal: 0 }));
		update(g, stamp({ tiles, coll: pairing?.coll ?? sel?.cseColl }, ctx.cse));
		setTab("tiles");
	};
	const setPick = (g: number, i: number, change: Partial<TilePick>) => {
		if (!pairing?.tiles) return;
		const tiles = pairing.tiles.map((t, k) => (k === i ? { ...t, ...change } : t));
		update(g, stamp({ ...pairing, tiles }, ctx.cse));
	};
	const confirmChange = (g: number) => {
		const p = mapping.blocks[String(g)];
		if (p) update(g, stamp(p, ctx.cse));
	};
	const acceptAll = () => {
		const blocks = { ...mapping.blocks };
		for (const g of result.unpaired) {
			const r = result.blocks.get(g)!;
			const top = suggestBlocks(g1.tileset, g, r.gen1Kinds, ctx.cse, 1)[0];
			if (top) blocks[String(g)] = { cse: top.cse };
		}
		setMapping({ ...mapping, blocks });
		setDirty(true);
	};
	const act = async (label: string, fn: () => Promise<void>) => {
		setBusy(label);
		setError(null);
		try {
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	};
	const save = () => act("save", async () => {
		await saveMapping(mapping);
		setDirty(false);
	});
	const port_ = (dry: boolean, force = false) => act(dry ? "dry" : "port", async () => {
		if (dirty) {
			await saveMapping(mapping);
			setDirty(false);
		}
		const r = await runPort(port, dry, force);
		setReport(r);
		if (r.needsConfirm) setConfirmOverwrite(r);
		else if (!dry) reload();
	});

	const marks = ctx.events.marks ?? [];
	const overlay = (ctx2d: CanvasRenderingContext2D) => {
		if (showWalk) {
			for (const i of diff.issues) {
				if (i.cse === "unpaired") continue; // already striped magenta
				ctx2d.fillStyle = isWalkable(i.gen1) ? LEGEND.lost.fill : LEGEND.gained.fill;
				ctx2d.fillRect(i.x * 16, i.y * 16, 16, 16);
			}
		}
		if (showEdges) {
			ctx2d.lineWidth = 2;
			for (const e of diff.edges) {
				ctx2d.strokeStyle = e.crossable ? LEGEND.crossable.line : LEGEND.kept.line;
				ctx2d.beginPath();
				if (e.dir === "right") {
					ctx2d.moveTo((e.x + 1) * 16, e.y * 16);
					ctx2d.lineTo((e.x + 1) * 16, (e.y + 1) * 16);
				} else {
					ctx2d.moveTo(e.x * 16, (e.y + 1) * 16);
					ctx2d.lineTo((e.x + 1) * 16, (e.y + 1) * 16);
				}
				ctx2d.stroke();
			}
		}
		const edited = (confirmOverwrite ?? report)?.outsideEdits?.blocks ?? [];
		if (edited.length) {
			// blocks your outside edits changed, which a port would overwrite
			ctx2d.lineWidth = 2;
			ctx2d.strokeStyle = LEGEND.edited.line;
			ctx2d.setLineDash([4, 2]);
			for (const b of edited) ctx2d.strokeRect(b.x * 32 + 1, b.y * 32 + 1, 30, 30);
			ctx2d.setLineDash([]);
		}
		if (showWarps) {
			for (const w of final!.warps) {
				const x = w.x * 16, y = w.y * 16;
				ctx2d.lineWidth = 2;
				ctx2d.setLineDash(w.want ? [] : [3, 2]);
				ctx2d.strokeStyle = w.want ? LEGEND.warp.line : LEGEND.warpStuck.line;
				ctx2d.strokeRect(x + 1, y + 1, 14, 14);
				ctx2d.setLineDash([]);
				const dir = w.want?.match(/^WARP_CARPET_(\w+)$/)?.[1];
				if (dir) {
					// an arrow toward the direction the player presses
					const [ax, ay] = ({ DOWN: [0, 1], UP: [0, -1], LEFT: [-1, 0], RIGHT: [1, 0] } as Record<string, [number, number]>)[dir] ?? [0, 0];
					const cx = x + 8, cy = y + 8;
					ctx2d.fillStyle = LEGEND.warp.line;
					ctx2d.beginPath();
					ctx2d.moveTo(cx + ax * 5, cy + ay * 5);
					ctx2d.lineTo(cx - ay * 4 - ax * 2, cy + ax * 4 - ay * 2);
					ctx2d.lineTo(cx + ay * 4 - ax * 2, cy - ax * 4 - ay * 2);
					ctx2d.closePath();
					ctx2d.fill();
				}
			}
		}
		if (showEvents) drawEvents(ctx2d, marks);
	};
	const gen1Overlay = showEvents ? (ctx2d: CanvasRenderingContext2D) => drawEvents(ctx2d, marks) : undefined;
	const eventAt = (sx: number, sy: number) => (showEvents ? marks.filter((m) => m.x === sx && m.y === sy).map((m) => m.label).join("\n") || undefined : undefined);
	// Fit: both maps side by side across the preview area (1px spare so rounding never wraps them).
	const mapScale = previewScale === "fit"
		? Math.max(0.25, (previewWidth - PREVIEW_GAP - 1) / (2 * g1.width * 32))
		: previewScale;
	const pickAt = (i: number) => {
		setSelected(g1.blocks[i] ?? null);
		blockForm.current?.scrollIntoView({ behavior: "smooth", block: "start" });
	};
	const status = (g: number) => {
		const r = result.blocks.get(g);
		if (!r || r.cse === undefined) return <Badge variant="destructive" className="transition-none">unpaired</Badge>;
		if (changed.has(g)) return <Badge className="transition-none bg-orange-500" title="Its project block or tiles changed outside the tool since you paired it">changed</Badge>;
		if (r.conflicts.length) return <Badge className="transition-none bg-amber-500">coll</Badge>;
		if (r.isNew) return <Badge className="transition-none bg-sky-600">new</Badge>;
		// The selected row's background is the same gray as this chip.
		return <Badge variant="secondary" className={`transition-none ${g === selected ? "bg-background ring-1 ring-border" : "group-hover:bg-background group-hover:ring-1 group-hover:ring-border"}`}>ok</Badge>;
	};
	const collOptions = collSections(ctx.collisionNames);
	/** Whether a block built from tiles picks each tile's palette and flips (else the palette map gives them). */
	const colorPicks = picksColors(ctx.cse);
	const paint = (i: number) => {
		const cur = pairing?.tiles?.[i];
		if (selected === null || !cur) return;
		if (cur.tile === brush.tile && cur.pal === brush.pal && !!cur.xflip === !!brush.xflip && !!cur.yflip === !!brush.yflip) return;
		setPick(selected, i, { tile: brush.tile, pal: brush.pal, xflip: !!brush.xflip, yflip: !!brush.yflip });
	};
	const eyedrop = (i: number) => {
		const cur = pairing?.tiles?.[i];
		if (cur) setBrush({ tile: cur.tile, pal: cur.pal, xflip: !!cur.xflip, yflip: !!cur.yflip });
	};

	return (
		<div className="flex flex-col gap-4">
			{moves.length > 0 && (
				<div className="flex flex-wrap items-start gap-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-xs text-sky-900">
					<div className="flex-1">
						<p className="font-medium">The tileset changed outside the tool, and these pairings followed their content to new numbers (save the mapping to keep them):</p>
						<ul className="mt-1 list-disc pl-5">{moves.map((m, i) => <li key={i}>Gen 1 {hex(m.gen1)}: {m.what}</li>)}</ul>
					</div>
					<Button variant="ghost" size="xs" onClick={() => setMoves([])}>Dismiss</Button>
				</div>
			)}
			{prefilled && dirty && (
				<p className="rounded-md border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
					This is the first port on {mapping.gen1Tileset} → {mapping.cseTileset}, so every block starts paired with its top suggestion. Nothing is saved until you save.
				</p>
			)}
			{ctx.missing.length > 0 && <MatchPanel missing={ctx.missing} onSaved={() => reload(true)} />}
			{changed.size > 0 && (
				<p className="rounded-md border border-orange-300 bg-orange-50 p-2 text-xs text-orange-900">
					{changed.size} pairing(s) changed outside the tool since you made them ({[...changed].map(hex).join(" ")}). They still use the same block or tile numbers; select each and press Confirm once it looks right.
				</p>
			)}
			{picker}
			{toolbarSlots && createPortal(
				<>
					<Select value={ctx.pinnedTime ?? time} onValueChange={(v) => setTime(v as TimeOfDay)} disabled={!!ctx.pinnedTime}>
						<SelectTrigger size="sm" className="w-24"><SelectValue /></SelectTrigger>
						<SelectContent>{TIMES.map((t) => <SelectItem key={t} value={t}>{ctx.timeNames[t]}</SelectItem>)}</SelectContent>
					</Select>
					<div className="flex flex-wrap gap-1">
						<Badge variant="secondary">{ctx.used.length} blocks</Badge>
						<Badge variant={result.unpaired.length ? "destructive" : "secondary"}>{result.unpaired.length} unpaired</Badge>
						<Tip text={`The next Port appends ${final!.appended.length} block(s) to ${mapping.cseTileset}: ${result.appended.length} from pairings, ${final!.appended.length - result.appended.length} warp variant(s) (a copy of a block with a warp collision on one square).`}>
							<Badge variant="secondary">{final!.appended.length} to add</Badge>
						</Tip>
						<Badge variant="secondary" title="Squares where walkability differs from Gen 1">{diff.issues.length} walk diffs</Badge>
						<Tip text={`From Gen 1: ${ctx.events.items} item(s), ${ctx.events.hiddenItems} hidden item(s), ${ctx.events.signs} sign(s) and other bg events, ${ctx.events.people} person(s), ${ctx.events.trainers} trainer(s).${ctx.events.notes.length ? ` ${ctx.events.notes.length} note(s) (stubs, unplaced events) in the Dry run report.` : ""}`}>
							<Badge variant={ctx.missing.length ? "destructive" : "secondary"}>{ctx.events.items + ctx.events.hiddenItems + ctx.events.signs + ctx.events.people + ctx.events.trainers} events{ctx.missing.length ? `, ${ctx.missing.length} to match` : ""}</Badge>
						</Tip>
					</div>
				</>,
				toolbarSlots.map,
			)}
			{toolbarSlots && createPortal(
				<>
						<Tip text="Pair every unpaired Gen 1 block with its top suggestion: the project block whose collision matches best, then whose shades look closest. Check the art afterwards. Only changes the page until you save."
							why={!result.unpaired.length ? "Every block is already paired." : undefined}>
							<Button variant="outline" size="sm" onClick={acceptAll} disabled={!result.unpaired.length}>Accept top suggestions</Button>
						</Tip>
						<Tip text={`Write the pairings to tools/gen1-map-porter/mappings/${mapping.gen1Tileset}__${mapping.cseTileset}.json in the project. Every map on this tileset pair shares them. Nothing the ROM is built from changes.`}
							why={!dirty ? "No unsaved changes." : undefined}>
							<Button variant="outline" size="sm" onClick={save} disabled={!dirty || !!busy}>{dirty ? "Save mapping" : "Saved"}</Button>
						</Tip>
						<Tip text="Save, then work out the whole port and show the report (new blocks, collision differences, warps, errors) without writing anything to the project.">
							<Button variant="outline" size="sm" onClick={() => port_(true)} disabled={!!busy}>Dry run</Button>
						</Tip>
						<Tip text={`Save, then write the map into the project: new blocks appended to ${mapping.cseTileset}, the map's block file, its registration, and its script file. Reruns only update what changed.`}
							why={result.unpaired.length > 0 ? `${result.unpaired.length} block(s) still unpaired.` : ctx.missing.length > 0 ? `${ctx.missing.length} Gen 1 name(s) need a match in the project (above).` : undefined}>
							<Button size="sm" onClick={() => port_(false)} disabled={!!busy || result.unpaired.length > 0 || ctx.missing.length > 0}>Port</Button>
						</Tip>
				</>,
				toolbarSlots.actions,
			)}

			{/* The block form's height sets the row's; the two side cards scroll inside it. */}
			<div className="grid gap-4 lg:grid-cols-[300px_1fr_360px]">
				<Card className={SIDE_CARD}>
					<CardHeader><CardTitle className="text-sm">Gen 1 blocks</CardTitle></CardHeader>
					<CardContent className="min-h-0 flex-1 overflow-y-auto">
							<div className="flex flex-col gap-1">
								{ctx.used.map((g) => {
									const r = result.blocks.get(g);
									return (
										<button key={g} onClick={() => setSelected(g)}
											className={`group flex flex-wrap items-center gap-2 rounded-md p-1 text-left text-xs hover:bg-muted ${selected === g ? "bg-muted ring-1 ring-ring ring-inset" : ""}`}>
											<BlockCanvas view={gen1View} block={g} scale={1.25} />
											<span className="text-muted-foreground">→</span>
											{r?.cse !== undefined ? <BlockCanvas view={cseView} block={r.cse} palettes={palettes} scale={1.25} /> : <span className="inline-block size-10 rounded bg-muted" />}
											<span className="flex flex-col gap-0.5">
												<span className="font-mono">{hex(g)}{g === g1.borderBlock ? " border" : ""}</span>
												<span className="text-muted-foreground">×{counts.get(g) ?? 0}</span>
											</span>
											<span className="ml-auto">{status(g)}</span>
										</button>
									);
								})}
							</div>
					</CardContent>
				</Card>

				<Card ref={blockForm} className="scroll-mt-4">
					<CardHeader><CardTitle className="text-sm">{selected !== null ? `Gen 1 block ${hex(selected)}` : "Pick a block"}</CardTitle></CardHeader>
					{selected !== null && sel && (
						<CardContent className="flex flex-col gap-4">
							<div className="flex flex-wrap items-start gap-6">
								<div className="flex flex-col items-center gap-2">
									<BlockCanvas view={gen1View} block={selected} scale={4} />
									<div className="grid grid-cols-2 gap-1 text-xs">
										{sel.gen1Kinds.map((k, q) => <span key={q} className={`rounded px-1.5 py-0.5 ${kindColor(k)}`}>{QUAD[q]} {k}</span>)}
									</div>
									<span className="text-xs text-muted-foreground">Gen 1</span>
								</div>
								<div className="flex flex-col items-center gap-2">
									<div className="relative">
										{sel.cse !== undefined
											? <BlockCanvas view={cseView} block={sel.cse} palettes={palettes} scale={4} />
											: <div className="size-32 rounded bg-muted" />}
										{pairing?.tiles && (
											<div className="absolute inset-0 grid cursor-crosshair grid-cols-4 select-none" onContextMenu={(e) => e.preventDefault()}>
												{[...Array(16).keys()].map((i) => (
													<div key={i} className="border border-white/20 hover:bg-white/25"
														onMouseDown={(e) => (e.button === 2 ? eyedrop(i) : e.button === 0 && paint(i))}
														onMouseEnter={(e) => e.buttons === 1 && paint(i)} />
												))}
											</div>
										)}
									</div>
									<div className="grid grid-cols-2 gap-1">
										{[0, 1, 2, 3].map((q) => {
											const name = sel.cseColl?.[q] ?? "";
											const bad = sel.conflicts.includes(q);
											return (
												<Select key={q} value={name || undefined} onValueChange={(v) => setColl(selected, q, v)} disabled={sel.cse === undefined || sel.linkedTo !== undefined}>
													<Tooltip>
														<TooltipTrigger asChild>
															<SelectTrigger size="sm" className={`w-36 text-xs ${bad ? "border-amber-500 bg-amber-50" : ""}`}>
																<SelectValue placeholder={QUAD[q]} />
															</SelectTrigger>
														</TooltipTrigger>
														{name && <TooltipContent>{QUAD[q]} {name}</TooltipContent>}
													</Tooltip>
													<SelectContent className="max-h-72">
														{collOptions.map((s, k) => (
															<SelectGroup key={s.label}>
																{k > 0 && <SelectSeparator />}
																<SelectLabel>{s.label}</SelectLabel>
																{s.names.map((n) => <SelectItem key={n} value={n}><QuadChip q={q} /> <span className="align-middle">{n}</span></SelectItem>)}
															</SelectGroup>
														))}
													</SelectContent>
												</Select>
											);
										})}
									</div>
									<span className="max-w-72 text-center text-xs text-muted-foreground">
										{sel.brokenLink
											? `Linked to Gen 1 ${hex(sel.linkedTo!)}, which has no block of its own now. Pair this one again.`
											: sel.linkedTo !== undefined
												? `Project block ${hex(sel.cse!)}${sel.isNew ? " (new)" : ""}, linked to Gen 1 ${hex(sel.linkedTo)}: edit that block to change both.`
												: sel.cse !== undefined ? `Project block ${hex(sel.cse)}${sel.isNew ? " (new)" : ""}` : "unpaired"}
									</span>
								</div>
							</div>
							{pairing?.tiles && (
								<p className="text-xs text-muted-foreground">
									{colorPicks
										? <>Painting with tile {hex(brush.tile)}, palette {PAL_NAMES[brush.pal]}{brush.xflip ? ", flip X" : ""}{brush.yflip ? ", flip Y" : ""}: click or drag on the block. Right-click a cell to pick up its tile.</>
										: <>Painting with tile {hex(brush.tile)}, in the palette the tileset's palette map gives it ({PAL_NAMES[sheetTilePalette(ctx.cse, brush.tile)]}): click or drag on the block. Right-click a cell to pick up its tile.</>}
								</p>
							)}
							<div className="flex flex-wrap gap-2">
								<Button variant="outline" size="sm" onClick={() => update(selected, { ...pairing, coll: sel.gen1Kinds.map((k) => defaultCollName(k, { warp: ctx.warpColl, names: ctx.collisionSet })) })} disabled={sel.cse === undefined || sel.linkedTo !== undefined}>
									Use Gen 1 collision
								</Button>
								<Button variant="outline" size="sm" onClick={() => update(selected, pairing?.cse !== undefined ? { cse: pairing.cse } : pairing && { ...pairing, coll: undefined })} disabled={!pairing?.coll}>
									Reset collision
								</Button>
								{pairing?.tiles ? (
									<Tip text="This block is built from tiles. In the Tiles tab, choose a tile and its palette and flips, then click or drag on the block above to paint it. Right-click a cell to pick up its tile.">
										<Button variant="outline" size="sm" onClick={() => setTab("tiles")}>Edit tiles</Button>
									</Tip>
								) : (
									<Tip text="Start a tile-by-tile version of this block, copied from its current project block (or blank). The tool reuses an identical block or adds a new one when you port.">
										<Button variant="outline" size="sm" onClick={() => toTiles(selected)}>Build from tiles</Button>
									</Tip>
								)}
								{changed.has(selected) && (
									<Tip text="Its project block (or a picked tile) changed outside the tool since you paired it. Confirm keeps the pairing as it is now and clears the flag.">
										<Button size="sm" className="bg-orange-500 hover:bg-orange-600" onClick={() => confirmChange(selected)}>Confirm</Button>
									</Tip>
								)}
								<Button variant="ghost" size="sm" onClick={() => update(selected, undefined)} disabled={!pairing}>Clear</Button>
							</div>
						</CardContent>
					)}
				</Card>

				<Card className={SIDE_CARD}>
					<CardContent className="flex min-h-0 flex-1 flex-col">
						<Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
							<TabsList>
								<TabsTrigger value="suggest">Suggestions</TabsTrigger>
								<TabsTrigger value="blocks">Project blocks</TabsTrigger>
								<TabsTrigger value="tiles" disabled={!pairing?.tiles}>Tiles</TabsTrigger>
							</TabsList>
							<TabsContent value="suggest" className="min-h-0 overflow-y-auto">
								<div className="grid grid-cols-[repeat(auto-fill,64px)] gap-2">
									{suggestions.map((s) => (
										<button key={s.cse} onClick={() => selected !== null && pairBlock(selected, s.cse)}
											className={`flex flex-col items-center rounded-md p-1 text-[10px] hover:bg-muted ${sel?.cse === s.cse ? "ring-1 ring-ring ring-inset" : ""}`}>
											<BlockCanvas view={cseView} block={s.cse} palettes={palettes} scale={1.75} />
											<span className="font-mono">{hex(s.cse)}</span>
											<span className="text-muted-foreground">{s.kindMatches}/4 · {s.shadeDiff.toFixed(2)}</span>
										</button>
									))}
								</div>
								<p className="mt-2 text-xs text-muted-foreground">Ranked by matching collision quadrants (x/4), then by shade difference (0 = identical).</p>
							</TabsContent>
							<TabsContent value="blocks" className="flex min-h-0 flex-col">
								{ctx.unusedAdded.length > 0 && (
									<p className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
										Added by this tool, now used by no map: {ctx.unusedAdded.map(hex).join(" ")}. Delete them in Polished Map++ if you like (the tool never renumbers blocks).
									</p>
								)}
								<div className="min-h-0 flex-1 overflow-y-auto">
									<div className="grid grid-cols-[repeat(auto-fill,52px)] gap-1">
										{[...Array(cseResult.blockCount).keys()].map((b) => {
											const isNew = b >= ctx.cse.blockCount;
											const owner = isNew ? ownerOf(b) : undefined;
											const coll = (cseResult.collision ?? []).slice(b * 4, b * 4 + 4).join(" ");
											// A new block no Gen 1 block makes is a warp variant: the port's, not pickable.
											const title = !isNew ? `${hex(b)} ${coll}`
												: owner === undefined ? `${hex(b)} ${coll}: a warp variant the port makes for one square; it can't be picked`
												: `${hex(b)} ${coll}: new, made by Gen 1 ${hex(owner)}. Picking it links to that block, so later edits there change both.`;
											return (
											<button key={b} onClick={() => selected !== null && pairBlock(selected, b)} title={title} disabled={isNew && owner === undefined}
												className={`rounded p-0.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${sel?.cse === b ? "ring-1 ring-ring ring-inset" : ""} ${isNew ? "bg-sky-50" : ""}`}>
												<BlockCanvas view={cseView} block={b} palettes={palettes} scale={1.5} />
											</button>
											);
										})}
									</div>
								</div>
							</TabsContent>
							<TabsContent value="tiles" className="flex min-h-0 flex-col">
								{pairing?.tiles && palettes && (
									<div className="flex min-h-0 flex-1 flex-col gap-2">
										{colorPicks ? (
											<>
												<div className="flex flex-wrap items-center gap-2 text-xs">
													<span>Brush</span>
													<Select value={String(brush.pal)} onValueChange={(v) => setBrush({ ...brush, pal: Number(v) })}>
														<SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
														<SelectContent>{PAL_NAMES.map((name, p) => <SelectItem key={p} value={String(p)}>{name}</SelectItem>)}</SelectContent>
													</Select>
													<Toggle size="sm" pressed={!!brush.xflip} onPressedChange={(v) => setBrush({ ...brush, xflip: v })}>flip X</Toggle>
													<Toggle size="sm" pressed={!!brush.yflip} onPressedChange={(v) => setBrush({ ...brush, yflip: v })}>flip Y</Toggle>
												</div>
												<p className="text-xs text-muted-foreground">Click a tile to make it the brush, shown in the brush's palette.</p>
											</>
										) : (
											<p className="text-xs text-muted-foreground">
												Click a tile to make it the brush. This project's tileset gives each tile its palette (its palette map), so a block built
												from tiles takes the palettes shown here. Change them in Polished Map.
											</p>
										)}
										<div className="min-h-0 flex-1 overflow-auto">
											<TileSheet tileset={ctx.cse} palette={colorPicks ? palettes[brush.pal]! : (t) => palettes[sheetTilePalette(ctx.cse, t)]!} selected={brush.tile} onPick={(t) => setBrush({ ...brush, tile: t })} />
										</div>
									</div>
								)}
							</TabsContent>
						</Tabs>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader className="flex flex-row flex-wrap items-center gap-2">
					<CardTitle className="text-sm">Preview</CardTitle>
					<Tip text="Shade the squares that walk differently from Gen 1: red where Gen 1 is walkable but the result is blocked, blue the other way round. The count is how many squares differ."
						why="Fix them by pairing a block whose collision matches, or with Use Gen 1 collision.">
						<Toggle size="sm" pressed={showWalk} onPressedChange={setShowWalk}>walkability ({diff.issues.length})</Toggle>
					</Tip>
					<Tip text="Gen 1 also blocks some steps between two walkable squares, such as off a raised plateau, with a table of tile pairs. The project's collision is per square, so those edges can't carry over as they are. Yellow lines are still blocked in the result; red lines the player can now cross."
						why="Close a red edge by pairing a block with a wall or ledge on that side.">
						<Toggle size="sm" pressed={showEdges} onPressedChange={setShowEdges}>
							Gen 1 elevation edges ({diff.edges.length}, {diff.edges.filter((e) => e.crossable).length} crossable)
						</Toggle>
					</Tip>
					<Tip text="Outline every warp square. Cyan: the port gives it collision that fires (an arrow means a carpet; press that way). Orange: the port can't work it out; the Dry run report says why."
						why="The port changes only that square's block, so you needn't pair warp blocks yourself.">
						<Toggle size="sm" pressed={showWarps} onPressedChange={setShowWarps}>warps ({final!.warps.length})</Toggle>
					</Tip>
					<Tip text="Mark every event square on both maps, colored by kind: item balls, hidden items, signs, people, trainers, and what isn't ported. Hover a square to see what it is."
						why="Events keep their Gen 1 squares, so check they still sit where the player can reach them.">
						<Toggle size="sm" pressed={showEvents} onPressedChange={setShowEvents}>events ({marks.length})</Toggle>
					</Tip>
					<Select value={String(previewScale)} onValueChange={(v) => choosePreviewScale(v === "fit" ? "fit" : Number(v) as PreviewScale)}>
						<SelectTrigger size="sm" className="w-20"><SelectValue /></SelectTrigger>
						<SelectContent>{PREVIEW_SCALES.map((s) => <SelectItem key={s} value={String(s)}>{s === "fit" ? "Fit" : `${s}x`}</SelectItem>)}</SelectContent>
					</Select>
					<span className="text-xs text-muted-foreground">Click a block to select it. Overlays are on the result (right); events are on both.</span>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					<Legend
						lost={diff.issues.filter((i) => i.cse !== "unpaired" && isWalkable(i.gen1)).length}
						gained={diff.issues.filter((i) => i.cse !== "unpaired" && !isWalkable(i.gen1)).length}
						kept={diff.edges.filter((e) => !e.crossable).length}
						crossable={diff.edges.filter((e) => e.crossable).length}
						edited={(confirmOverwrite ?? report)?.outsideEdits?.blocks.length ?? 0}
						warps={final!.warps.filter((w) => w.want).length}
						stuck={final!.warps.filter((w) => !w.want).length}
					/>
					{showEvents && <EventLegend marks={marks} />}
				</CardContent>
				<CardContent ref={setPreviewArea} className={`flex gap-4 ${previewScale === "fit" ? "flex-nowrap overflow-hidden" : "flex-wrap overflow-auto"}`}>
					<PreviewMaps
						gen1={{ view: gen1View, width: g1.width, height: g1.height, blockAt: (i) => g1.blocks[i], scale: mapScale, onPick: pickAt, overlay: gen1Overlay, squareLabel: eventAt }}
						cse={{ view: cseView, width: g1.width, height: g1.height, blockAt: (i) => final!.grid[i], palettes, scale: mapScale, onPick: pickAt, overlay, squareLabel: eventAt }} />
				</CardContent>
			</Card>

			{report && (
				<Card className="shrink-0">
					<CardHeader><CardTitle className="text-sm">{`${report.dryRun ? "Dry run" : "Port"}: ${report.map} → ${report.cseMap}`}</CardTitle></CardHeader>
					<CardContent className="flex flex-col gap-2 text-xs">
						{report && (
							<>
								{report.errors.map((e) => <p key={e} className="text-red-700">{e}</p>)}
								{report.outsideEdits && (
									<p className="text-fuchsia-800">
										{report.outsideEdits.path} {report.outsideEdits.reason === "no-record" ? "exists and the tool has no record of writing it" : "was changed outside the tool since the last port"}:
										{" "}{report.outsideEdits.blocks.length} block(s) differ from this port (outlined in the preview).
										{report.needsConfirm ? " Nothing was written." : ""}
									</p>
								)}
								{report.unpaired.length > 0 && <p className="text-red-700">Unpaired: {report.unpaired.map(hex).join(" ")} (nothing written)</p>}
								{report.missing?.length > 0 && <p className="text-destructive">Needs a match in the project first: {report.missing.map((m) => `${m.kind} ${m.gen1}`).join(", ")} (nothing written)</p>}
								{report.events && <p>Events: {report.events.items} item(s), {report.events.hiddenItems} hidden item(s), {report.events.signs} sign(s) and other bg events, {report.events.people} person(s), {report.events.trainers} trainer(s)</p>}
								{report.events?.notes.length > 0 && <ul className="list-disc pl-5 text-muted-foreground">{report.events.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
								<p>{report.appendedBlocks} new block(s) · {report.conflicts.length} collision difference(s) · walkability differs on {report.walkIssues.length} square(s)</p>
								<ul className="list-disc pl-5">
									{report.warps.map((w, i) => {
										const sq = report.warpSquares[i];
										const coll = !sq ? "" : sq.want ? (sq.want === sq.before ? ` · collision ${sq.want}` : ` · collision ${sq.before ?? "?"} → ${sq.want}`) : ` · collision left as ${sq.before ?? "?"}: ${sq.note}`;
										return <li key={i}>warp ({w.gen1.x},{w.gen1.y}) → {w.gen1.dest} {w.gen1.warp}: {w.cse ? `${w.cse.map} ${w.cse.warp}` : `omitted: ${w.reason}`}{coll}</li>;
									})}
									{report.files.map((f) => <li key={f.path}>{f.action}: {f.path}</li>)}
								</ul>
							</>
						)}
					</CardContent>
				</Card>
			)}

			<AlertDialog open={!!confirmOverwrite} onOpenChange={(open) => !open && setConfirmOverwrite(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Overwrite your edits to {String(ctx.entry.name)}?</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmOverwrite?.outsideEdits?.reason === "no-record"
								? `${confirmOverwrite?.outsideEdits?.path} already exists, and the tool has no record of writing it, so it may hold your own work.`
								: `${confirmOverwrite?.outsideEdits?.path} was changed outside the tool (e.g. in Polished Map++) since the last port.`}
							{" "}Porting replaces {confirmOverwrite?.outsideEdits?.blocks.length ?? 0} block(s), outlined in the preview, with this mapping's.
							Nothing has been written yet.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep my edits</AlertDialogCancel>
						<AlertDialogAction onClick={() => {
							setConfirmOverwrite(null);
							port_(false, true);
						}}>Overwrite and port</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
