// The local server: a small JSON/PNG API for the page, and the built page itself.
// It's the only part of the tool (besides the command line) that touches project files.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { extname, join, normalize } from "node:path";

import { cseCollisionNames } from "../shared/coll.js";
import { environmentPalettes, loadCseTileset, TILESET_FEATURES, timeNames } from "../shared/cse.js";
import { FEATURE_IDS, FEATURES, overrideChoices, refusal, variantLabel, type FeatureId } from "../shared/features.js";
import { snapshotOf } from "../shared/fingerprint.js";
import type { Mapping } from "../shared/mapping.js";
import { encodePng } from "../shared/node/png.js";
import { cseChoices, eventCounts, portContext, portEvents, portMap, portVersion, unusedAddedBlocks } from "../shared/node/port.js";
import type { MissingKind } from "../shared/node/events.js";
import { formatsOf, projectFeatures, saveOverride } from "../shared/node/features.js";
import { gameFiles, listMaps, loadConfig, loadMap, projectFiles, TOOL_ROOT } from "../shared/node/project.js";
import { pickFolder } from "../shared/node/folder-dialog.js";
import { chooseFolder, FOLDER_KINDS, FOLDER_LABELS, folderProblem, knownFolders, loadPlace, loadSettings, savePlace, type FolderKind, type Place } from "../shared/node/settings.js";
import { gen1MapList, saveSetup, setupForm, type SetupDraft } from "../shared/node/setup.js";
import { mapTable, saveEventChoice, saveMapping } from "../shared/node/tables.js";
import { renderMap } from "../shared/render.js";
import { TIMES, type Game, type TimeOfDay } from "../shared/types.js";
import { collToWire, mapToWire, tilesetToWire, type PortEntrySummary, type WireFeatures, type WirePortContext } from "../shared/wire.js";

const PORT = Number(process.env.PORT ?? 5174);
const GAMES: readonly Game[] = ["yellow", "red", "blue", "cse"];
const SOURCE_GAMES: readonly Game[] = ["yellow", "red", "blue"];
const WEB_DIST = join(TOOL_ROOT, "web", "dist");
const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
};
const PINNED: Record<string, TimeOfDay> = { PALETTE_MORN: "morn", PALETTE_DAY: "day", PALETTE_NITE: "nite", PALETTE_EVE: "eve" };

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
	const send = (status: number, type: string, body: string | Uint8Array) => {
		res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
		res.end(body);
	};
	const json = (body: unknown, status = 200) => send(status, "application/json", JSON.stringify(body));
	const fail = (status: number, message: string) => json({ error: message }, status);
	try {
		if (url.pathname.startsWith("/api/")) {
			// Writes need a header a cross-site page can't send without a CORS preflight, which this
			// server never answers, so only the tool's own page can change files.
			if (req.method !== "GET" && req.headers["x-gen1-map-porter"] !== "1") return fail(403, "missing x-gen1-map-porter header");
			// Folders (D32-D33): what's chosen, the suite's known options, choosing one, the dialog.
			if (url.pathname === "/api/folders" && req.method === "GET") {
				const s = loadSettings();
				return json(FOLDER_KINDS.map((kind) => {
					const path = s.folders[kind];
					return { kind, label: FOLDER_LABELS[kind], path, problem: path ? folderProblem(kind, path) : "not chosen yet", known: knownFolders(kind) };
				}));
			}
			if (url.pathname === "/api/folders" && req.method === "PUT") {
				const { kind, path } = JSON.parse(await readBody(req)) as { kind: FolderKind; path: string };
				if (!FOLDER_KINDS.includes(kind)) return fail(400, `unknown folder kind: ${kind}`);
				const problem = chooseFolder(kind, path);
				return problem ? fail(400, `${path}: ${problem}`) : json({ ok: true });
			}
			if (url.pathname === "/api/folders/pick" && req.method === "POST") {
				const kind = url.searchParams.get("kind") as FolderKind | null;
				if (!kind || !FOLDER_KINDS.includes(kind)) return fail(400, "unknown folder kind");
				const current = loadSettings().folders[kind];
				const path = await pickFolder(`Choose the ${FOLDER_LABELS[kind]} folder`, current);
				if (!path) return json({ cancelled: true });
				const problem = chooseFolder(kind, path);
				return json(problem ? { path, problem } : { path });
			}

			const config = loadConfig(); // re-read so changes apply without a restart
			const mapName = url.searchParams.get("map");

			// The project's features: what each probe found, its override, and the base it looks like.
			if (url.pathname === "/api/features" && req.method === "GET") {
				if (!config.cse || folderProblem("cse-project", config.cse)) return json(null);
				const pf = projectFeatures(projectFiles(config.cse));
				const body: WireFeatures = {
					looksLike: pf.looksLike,
					features: pf.features.map((f) => ({
						...f,
						variantLabel: variantLabel(f.id, f.variant),
						detectedLabel: variantLabel(f.id, f.detected.variant),
						refusal: refusal(f),
						choices: overrideChoices(f.id).map((v) => ({ variant: v, label: variantLabel(f.id, v)! })),
					})),
				};
				return json(body);
			}
			if (url.pathname === "/api/features" && req.method === "PUT") {
				const { id, variant } = JSON.parse(await readBody(req)) as { id: FeatureId; variant: string | null };
				if (!FEATURE_IDS.includes(id)) return fail(400, "unknown feature");
				if (variant !== null && !overrideChoices(id).includes(variant)) return fail(400, `${variant} isn't a ${FEATURES[id].label} the porter can use`);
				if (!config.cse || folderProblem("cse-project", config.cse)) return fail(400, "choose the project folder first");
				saveOverride(config.cse, id, variant ?? undefined);
				return json({ ok: true });
			}

			// Where the Port page was left in this project (a map that's no longer set up isn't offered).
			if (url.pathname === "/api/place" && req.method === "GET") {
				const place = loadPlace(config.cse);
				return json(place && mapTable(config.cse)[place.map] ? place : null);
			}
			if (url.pathname === "/api/place" && req.method === "PUT") {
				const place = JSON.parse(await readBody(req)) as Place;
				if (!SOURCE_GAMES.includes(place.game) || typeof place.map !== "string") return fail(400, "not a place");
				savePlace(config.cse, { game: place.game, map: place.map, ...(typeof place.block === "number" && { block: place.block }) });
				return json({ ok: true });
			}

			// Matches for Gen 1 names CSE lacks: the choices, and saving one to its table.
			if (url.pathname === "/api/cse-choices") return json(cseChoices(config));
			if (url.pathname === "/api/tables/choice" && req.method === "PUT") {
				const { kind, gen1, value } = JSON.parse(await readBody(req)) as { kind: MissingKind; gen1: string; value: string };
				const choices = cseChoices(config);
				if (!choices[kind]?.includes(value)) return fail(400, `${value} isn't a ${kind} in the project`);
				saveEventChoice(config.cse, kind, gen1, value);
				return json({ ok: true });
			}

			// Setting up any Gen 1 map: the full list, the form, saving it.
			if (url.pathname === "/api/gen1-maps") {
				const g = url.searchParams.get("game") as Game | null;
				if (!g || !SOURCE_GAMES.includes(g)) return fail(400, "game must be yellow, red or blue");
				return json(gen1MapList(config, g));
			}
			if (url.pathname === "/api/setup" && req.method === "GET") {
				const g = url.searchParams.get("game") as Game | null;
				if (!g || !SOURCE_GAMES.includes(g) || !mapName) return fail(400, "game and map are required");
				return json(setupForm(config, g, mapName));
			}
			if (url.pathname === "/api/setup" && req.method === "PUT") {
				const draft = JSON.parse(await readBody(req)) as SetupDraft;
				if (!SOURCE_GAMES.includes(draft.game)) return fail(400, "game must be yellow, red or blue");
				const problem = saveSetup(config, draft);
				return problem ? fail(400, problem) : json({ ok: true });
			}

			// Route B
			if (url.pathname === "/api/ports") {
				const table = mapTable(config.cse);
				const list: PortEntrySummary[] = Object.entries(table).map(([gen1Const, e]) => ({ gen1Const, game: e.game, cseName: e.name, cseConst: e.const }));
				return json(list);
			}
			if (url.pathname === "/api/port/context") {
				if (!mapName) return fail(400, "map is required");
				const ctx = portContext(config, mapName);
				const cseFiles = gameFiles(config, "cse");
				const ev = portEvents(config, mapName, ctx.entry, ctx.gen1Map.name);
				const body: WirePortContext = {
					gen1Const: mapName,
					entry: ctx.entry as unknown as Record<string, unknown>,
					warpColl: ctx.tilesetEntry.warpColl,
					gen1Map: mapToWire(ctx.gen1Map),
					gen1Coll: collToWire(ctx.gen1Coll),
					cseTileset: tilesetToWire(ctx.cseTileset),
					csePalettes: environmentPalettes(cseFiles, ctx.entry.environment),
					csePinnedTime: Object.entries(PINNED).find(([p]) => ctx.entry.palette.includes(p))?.[1],
					timeNames: timeNames(cseFiles),
					collisionNames: cseCollisionNames(cseFiles),
					collisionSet: ctx.collisionNames,
					mapping: ctx.mapping,
					mappingSaved: ctx.mappingSaved,
					unusedAdded: unusedAddedBlocks(config, ctx.cseTileset.constName),
					reconciled: ctx.reconciled,
					version: portVersion(config, mapName),
					used: ctx.used,
					missing: ev.missing,
					collisionSquares: ev.collisionSquares,
					events: {
						...eventCounts(ev),
						notes: ctx.entry.target === "replace" ? ["a replaced map keeps its own script; no events are written"] : ev.report,
						marks: ev.marks,
					},
				};
				return json(body);
			}
			if (url.pathname === "/api/port/version") {
				if (!mapName) return fail(400, "map is required");
				return json({ version: portVersion(config, mapName) });
			}
			if (url.pathname === "/api/mapping" && req.method === "PUT") {
				const mapping = JSON.parse(await readBody(req)) as Mapping;
				if (mapping.version !== 1 || !mapping.gen1Tileset || !mapping.cseTileset) return fail(400, "not a mapping");
				// The tileset as saved against, so a later reload can tell moved content from copies.
				const cseFiles = gameFiles(config, "cse");
				saveMapping(config.cse, { ...mapping, snapshot: snapshotOf(loadCseTileset(cseFiles, mapping.cseTileset, formatsOf(cseFiles, TILESET_FEATURES))) });
				return json({ ok: true });
			}
			if (url.pathname === "/api/port" && req.method === "POST") {
				if (!mapName) return fail(400, "map is required");
				return json(portMap(config, mapName, { dryRun: url.searchParams.get("dry") === "1", force: url.searchParams.get("force") === "1" }));
			}

			// Viewing
			const game = url.searchParams.get("game") as Game | null;
			if (!game || !GAMES.includes(game)) return fail(400, "game must be yellow, red, blue or cse");
			if (url.pathname === "/api/maps") return json(listMaps(config, game));
			if (!mapName) return fail(400, "map is required");
			const map = loadMap(config, game, mapName);
			if (url.pathname === "/api/map") {
				const { tileset } = map;
				return json({
					name: map.name,
					constName: map.constName,
					width: map.width,
					height: map.height,
					borderBlock: map.borderBlock,
					tileset: { constName: tileset.constName, tileCount: tileset.tileCount, blockCount: tileset.blockCount, files: tileset.files },
					environment: map.environment,
					pinnedTime: map.pinnedTime,
					...(game === "cse" && { timeNames: timeNames(gameFiles(config, "cse")) }),
					notes: map.notes,
				});
			}
			if (url.pathname === "/api/render") {
				const time = url.searchParams.get("time") as TimeOfDay | null;
				if (time && !TIMES.includes(time)) return fail(400, "bad time");
				return send(200, "image/png", encodePng(renderMap(map, { time: time ?? undefined })));
			}
			return fail(404, "unknown API path");
		}
		// The built page (npm run build:web); in development Vite serves it instead.
		const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^([/\\])+/, "");
		const file = join(WEB_DIST, rel);
		if (!file.startsWith(WEB_DIST) || !existsSync(file) || !statSync(file).isFile()) {
			return send(404, "text/plain", existsSync(WEB_DIST) ? "not found" : "page not built: npm run build:web (or use npm run dev)");
		}
		send(200, TYPES[extname(file)] ?? "application/octet-stream", readFileSync(file));
	} catch (e) {
		fail(500, e instanceof Error ? e.message : String(e));
	}
});

server.listen(PORT, "127.0.0.1", () => console.log(`gen1-map-porter server on http://localhost:${PORT}`));
