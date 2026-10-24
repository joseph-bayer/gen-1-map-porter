// The Folders panel: this tool's Crystal project and Gen 1 repos, with a dropdown of folders any
// Crystal Tool Suite tool already found and Windows' own folder dialog. Below them, the project's
// features as detected, each with an override saved in the project.

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { WireFeatures } from "../../shared/wire";
import { getJson } from "./api";

export interface FolderRow {
	kind: "cse-project" | "pokered" | "pokeyellow";
	label: string;
	path?: string;
	problem?: string;
	known: { path: string; tool: string; lastUsed: string }[];
}

const writeInit = (method: string, body?: unknown): RequestInit => ({
	method,
	headers: { "x-gen1-map-porter": "1", "content-type": "application/json" },
	body: body === undefined ? undefined : JSON.stringify(body),
});

export function useFolders() {
	const [rows, setRows] = useState<FolderRow[] | null>(null);
	const refresh = useCallback(() => getJson<FolderRow[]>("/api/folders").then(setRows, () => setRows([])), []);
	useEffect(() => {
		refresh();
	}, [refresh]);
	return { rows, refresh };
}

/** Choose a folder, as the Folders panel does; fails with the folder's problem. */
export const putFolder = (kind: string, path: string) => getJson<{ ok: boolean }>("/api/folders", writeInit("PUT", { kind, path }));

/** The override select's value for "use what was detected". */
const DETECTED = "detected";

function FeaturesList({ project, onChange }: { project: string; onChange: () => void }) {
	const [features, setFeatures] = useState<WireFeatures | null>(null);
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(() => {
		getJson<WireFeatures | null>("/api/features").then(setFeatures, (e: Error) => setError(e.message));
	}, []);
	useEffect(load, [load, project]);

	const override = async (id: string, value: string) => {
		setError(null);
		try {
			await getJson("/api/features", writeInit("PUT", { id, variant: value === DETECTED ? null : value }));
			onChange();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
		load();
	};

	if (error) return <p className="text-xs text-destructive">{error}</p>;
	if (!features) return null;
	return (
		<div className="flex flex-col gap-1 border-t pt-3 text-xs">
			<p className="font-medium">
				Project features: {features.looksLike ? `looks like ${features.looksLike}` : "matches no known base, so no default names apply"}
			</p>
			{features.features.map((f) => (
				<div key={f.id} className="flex flex-wrap items-center gap-2" title={`${f.detected.detail} (${f.detected.source})`}>
					<span className="w-56 shrink-0 text-muted-foreground">{f.label}</span>
					<Select value={f.override ?? DETECTED} onValueChange={(v) => override(f.id, v)}>
						<SelectTrigger size="sm" className="w-80 text-xs"><SelectValue /></SelectTrigger>
						<SelectContent>
							<SelectItem value={DETECTED}>Detected: {f.detectedLabel ?? "not recognized"}</SelectItem>
							{f.choices.map((c) => <SelectItem key={c.variant} value={c.variant}>{c.label}</SelectItem>)}
						</SelectContent>
					</Select>
					{f.refusal && <span className="text-amber-700">{f.refusal.replace(/^[^:]*: /, "")}</span>}
				</div>
			))}
			<p className="text-muted-foreground">
				Read from the project's own files; hover a row to see where. A choice here is saved in the project, in
				tools/gen1-map-porter/features.json.
			</p>
		</div>
	);
}

/** `notice`: a problem to show from the start (a folder the page was opened onto). */
export function FoldersPanel({ rows, refresh, onChange, notice }: { rows: FolderRow[]; refresh: () => void; onChange: () => void; notice?: string | null }) {
	const [busy, setBusy] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(notice ?? null);

	const choose = async (kind: FolderRow["kind"], path: string) => {
		setMessage(null);
		try {
			await putFolder(kind, path);
			onChange();
		} catch (e) {
			setMessage(e instanceof Error ? e.message : String(e));
		}
		refresh();
	};
	const pick = async (kind: FolderRow["kind"]) => {
		setBusy(kind);
		setMessage("A folder dialog is open; it may be behind this window.");
		try {
			const r = await getJson<{ cancelled?: boolean; path?: string; problem?: string }>(`/api/folders/pick?kind=${kind}`, writeInit("POST"));
			setMessage(r.problem ? `${r.path}: ${r.problem}` : null);
			if (r.path && !r.problem) onChange();
		} catch (e) {
			setMessage(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
			refresh();
		}
	};
	const project = rows.find((r) => r.kind === "cse-project");

	return (
		<Card>
			<CardHeader><CardTitle className="text-sm">Folders</CardTitle></CardHeader>
			<CardContent className="flex flex-col gap-3">
				{rows.map((row) => {
					const options = [...new Set([...(row.path ? [row.path] : []), ...row.known.map((k) => k.path)])];
					return (
						<div key={row.kind} className="flex flex-wrap items-center gap-2 text-sm">
							<span className="w-48 shrink-0 font-medium">{row.label}</span>
							<Select value={row.path ?? ""} onValueChange={(v) => choose(row.kind, v)} disabled={!options.length}>
								<SelectTrigger className="min-w-0 flex-1 font-mono text-xs">
									<SelectValue placeholder={options.length ? "Choose a known folder…" : "No known folders yet; use Choose…"} />
								</SelectTrigger>
								<SelectContent>
									{options.map((p) => {
										const k = row.known.find((x) => x.path === p);
										return (
											<SelectItem key={p} value={p} className="font-mono text-xs">
												{p}{k && k.tool !== "gen1-map-porter" ? `  (found by ${k.tool})` : ""}
											</SelectItem>
										);
									})}
								</SelectContent>
							</Select>
							<Button variant="outline" size="sm" onClick={() => pick(row.kind)} disabled={!!busy}>
								{busy === row.kind ? "Waiting…" : "Choose…"}
							</Button>
							<span className={`w-56 text-xs ${row.path && !row.problem ? "text-emerald-700" : "text-muted-foreground"}`}>
								{row.path && !row.problem ? "✓ ready" : row.problem}
							</span>
						</div>
					);
				})}
				{message && <p className="text-xs text-amber-700">{message}</p>}
				<p className="text-xs text-muted-foreground">
					Folders you choose are remembered for next time and offered to the other Crystal Tool Suite tools. The Crystal project is
					required; each Gen 1 repo is needed only for maps from that game.
				</p>
				{project?.path && !project.problem && <FeaturesList project={project.path} onChange={onChange} />}
			</CardContent>
		</Card>
	);
}
