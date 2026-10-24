// The page: the route B porting view, and a viewer for any Gen 1 or project map (two side by side,
// rendered by the server).

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { TIMES, type Game, type TimeOfDay } from "../../shared/types";
import { FoldersPanel, putFolder, useFolders, type FolderRow } from "./FoldersPanel";
import { PortPage, TOOLBAR_ACTIONS_ID, TOOLBAR_MAP_ID } from "./PortPage";

interface MapInfo {
	name: string;
	constName: string;
	width: number;
	height: number;
	tileset: { constName: string; tileCount: number; blockCount: number };
	environment?: string;
	pinnedTime?: TimeOfDay;
	/** A project map's names for the times of day. */
	timeNames?: Record<TimeOfDay, string>;
	notes: string[];
}

const GAMES: Game[] = ["yellow", "red", "blue", "cse"];
/** The viewer's names for the games; "cse" is the chosen project, whatever its base. */
const GAME_LABELS: Record<Game, string> = { yellow: "yellow", red: "red", blue: "blue", cse: "project" };

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	const body = await res.json();
	if (!res.ok) throw new Error(body.error ?? res.statusText);
	return body as T;
}

function MapPanel({ initialGame, initialMap }: { initialGame: Game; initialMap: string }) {
	const [game, setGame] = useState<Game>(initialGame);
	const [maps, setMaps] = useState<string[]>([]);
	const [map, setMap] = useState(initialMap);
	const [time, setTime] = useState<TimeOfDay>("day");
	const [zoom, setZoom] = useState(2);
	const [info, setInfo] = useState<MapInfo | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		getJson<string[]>(`/api/maps?game=${game}`).then(setMaps, (e: Error) => setError(e.message));
	}, [game]);

	useEffect(() => {
		setInfo(null);
		setError(null);
		getJson<MapInfo>(`/api/map?game=${game}&map=${map}`).then(setInfo, (e: Error) => setError(e.message));
	}, [game, map]);

	const select = "rounded border border-slate-300 bg-white px-2 py-1 text-sm";
	return (
		<section className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
			<div className="flex flex-wrap items-center gap-2">
				<select className={select} value={game} onChange={(e) => setGame(e.target.value as Game)}>
					{GAMES.map((g) => <option key={g} value={g}>{GAME_LABELS[g]}</option>)}
				</select>
				<select className={`${select} min-w-0 flex-1`} value={map} onChange={(e) => setMap(e.target.value)}>
					{!maps.includes(map) && <option value={map}>{map}</option>}
					{maps.map((m) => <option key={m} value={m}>{m}</option>)}
				</select>
				{game === "cse" && (
					<select className={select} value={time} onChange={(e) => setTime(e.target.value as TimeOfDay)}>
						{TIMES.map((t) => <option key={t} value={t}>{info?.timeNames?.[t] ?? t}</option>)}
					</select>
				)}
				<select className={select} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
					{[1, 2, 3, 4].map((z) => <option key={z} value={z}>{z}x</option>)}
				</select>
			</div>
			{error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
			{info && (
				<>
					<p className="text-sm text-slate-600">
						{info.name}: {info.width}x{info.height} blocks · {info.tileset.constName} ({info.tileset.tileCount} tiles,{" "}
						{info.tileset.blockCount} blocks){info.environment ? ` · ${info.environment}` : ""}
						{info.pinnedTime ? ` · pinned ${info.timeNames?.[info.pinnedTime] ?? info.pinnedTime}` : ""}
					</p>
					<div className="overflow-auto rounded bg-slate-100 p-2">
						<img
							className="pixelated max-w-none"
							src={`/api/render?game=${game}&map=${map}&time=${time}`}
							width={info.width * 32 * zoom}
							height={info.height * 32 * zoom}
							alt={info.name}
						/>
					</div>
					{info.notes.length > 0 && (
						<ul className="list-disc pl-5 text-xs text-slate-500">
							{info.notes.map((n) => <li key={n}>{n}</li>)}
						</ul>
					)}
				</>
			)}
		</section>
	);
}

/** The folder the launcher opened the page onto (`?project=<path>&kind=<kind>`), if any. */
function openedOnto(): { path: string; kind: string } | undefined {
	const q = new URLSearchParams(location.search);
	const path = q.get("project"), kind = q.get("kind");
	return path && kind ? { path, kind } : undefined;
}

/** Take the launcher's parameters out of the address, so a reload doesn't choose the folder again. */
function clearOpenedOnto(): void {
	const url = new URL(location.href);
	url.searchParams.delete("project");
	url.searchParams.delete("kind");
	history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

export function App() {
	const { rows, refresh } = useFolders();
	// Bumped when a folder changes, so the pages below reload against it.
	const [generation, setGeneration] = useState(0);
	const ready = (kind: FolderRow["kind"]) => !!rows?.find((r) => r.kind === kind && r.path && !r.problem);
	const projectReady = ready("cse-project");
	const gen1Ready = ready("pokered") || ready("pokeyellow");
	const [showFolders, setShowFolders] = useState(false);

	// Opened onto a folder: it's chosen as in Folders (and remembered for the suite) before the pages
	// load. If it doesn't pass its check, Folders opens with the reason.
	const [opening, setOpening] = useState(openedOnto);
	const [ontoProblem, setOntoProblem] = useState<string | null>(null);
	const opened = useRef(false);
	useEffect(() => {
		if (!opening || opened.current) return;
		opened.current = true;
		putFolder(opening.kind, opening.path)
			.catch((e: unknown) => {
				setOntoProblem(e instanceof Error ? e.message : String(e));
				setShowFolders(true);
			})
			.then(refresh)
			.finally(() => {
				clearOpenedOnto();
				setOpening(undefined);
			});
	}, [opening, refresh]);

	if (!rows || opening) return <main className="min-h-screen bg-slate-50 p-4 text-sm text-muted-foreground">Loading…</main>;
	const title = <h1 className="text-xl font-semibold">Gen 1 Map Porter</h1>;
	const folders = (
		<div className="max-h-[50vh] shrink-0 overflow-y-auto">
			<FoldersPanel rows={rows} refresh={refresh} onChange={() => setGeneration((g) => g + 1)} notice={ontoProblem} />
		</div>
	);
	if (!projectReady || !gen1Ready) {
		return (
			<main className="flex min-h-screen flex-col gap-4 bg-slate-50 p-4 text-slate-900">
				{title}
				{folders}
				<p className="text-sm text-muted-foreground">Choose your Crystal project and at least one Gen 1 repo to start.</p>
			</main>
		);
	}
	return (
		<main className="min-h-screen bg-slate-50 p-4 text-slate-900">
			<Tabs defaultValue="port" key={generation} className="gap-3">
				{/* One line when wide, two when not, three when narrow (app-header in index.css). The Port
				    page puts its map picker and stats, and its action buttons, in the two slots. */}
				<div className="app-header">
					<div className="app-header-main flex items-center gap-3">
						{title}
						<TabsList>
							<TabsTrigger value="port">Port</TabsTrigger>
							<TabsTrigger value="view">View maps</TabsTrigger>
						</TabsList>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant={showFolders ? "secondary" : "outline"} size="sm" onClick={() => setShowFolders((v) => !v)}>Folders</Button>
							</TooltipTrigger>
							<TooltipContent className="max-w-sm">
								{showFolders ? "Hide the folder choices." : `Choose the Crystal project and the Gen 1 repos. Project: ${rows.find((r) => r.kind === "cse-project")?.path}`}
							</TooltipContent>
						</Tooltip>
					</div>
					<div id={TOOLBAR_MAP_ID} className="app-header-map flex min-w-0 flex-wrap items-center gap-2" />
					<div id={TOOLBAR_ACTIONS_ID} className="app-header-actions flex flex-wrap items-center gap-2" />
				</div>
				{showFolders && folders}
				<TabsContent value="port"><PortPage /></TabsContent>
				<TabsContent value="view">
					<div className="flex flex-col gap-4 lg:flex-row">
						<MapPanel initialGame="yellow" initialMap="CERULEAN_CAVE_1F" />
						<MapPanel initialGame="cse" initialMap="UNION_CAVE_1F" />
					</div>
				</TabsContent>
			</Tabs>
		</main>
	);
}
