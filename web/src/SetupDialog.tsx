// The Set up port form: picks a new Gen 1 map's name, tileset and header in the project, or changes a set-up
// map's (Map settings). Saving writes the tool's tables; nothing else in the project changes.

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { headerDefaults, headerOf, type HeaderValues, type SetupDraft, type SetupForm } from "../../shared/setup";
import type { Game } from "../../shared/types";
import { loadSetup, saveSetup } from "./api";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		<label className="flex min-w-0 flex-col gap-1 text-xs">
			<span className="font-medium text-foreground">{label}</span>
			{children}
			{hint && <span className="text-muted-foreground">{hint}</span>}
		</label>
	);
}

function Pick({ value, options, onChange, disabled, placeholder }: {
	value: string;
	options: { value: string; label?: string }[] | string[];
	onChange: (v: string) => void;
	disabled?: boolean;
	placeholder?: string;
}) {
	const list = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
	return (
		<Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger size="sm" className="w-full text-xs"><SelectValue placeholder={placeholder ?? "Choose…"} /></SelectTrigger>
			<SelectContent className="max-h-72">
				{list.map((o) => <SelectItem key={o.value} value={o.value}>{o.label ?? o.value}</SelectItem>)}
			</SelectContent>
		</Select>
	);
}

const inputClass = "h-7 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

export function SetupDialog({ target, onClose, onSaved }: {
	/** The map to set up (or change), or null when closed. */
	target: { game: Game; gen1Const: string } | null;
	onClose: () => void;
	onSaved: (gen1Const: string) => void;
}) {
	const [form, setForm] = useState<SetupForm | null>(null);
	const [draft, setDraft] = useState<SetupDraft | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setForm(null);
		setDraft(null);
		setError(null);
		if (!target) return;
		loadSetup(target.game, target.gen1Const).then((f) => {
			setForm(f);
			setDraft(f.draft);
		}, (e: Error) => setError(e.message));
	}, [target]);

	const replacing = draft?.target === "replace";
	const set = (patch: Partial<SetupDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
	const setHeader = (h: HeaderValues) => set(h);

	const chooseTarget = (t: "new" | "replace") => {
		if (!form || !draft) return;
		const same = form.sameNamed;
		if (t === "replace" && same) set({ target: t, name: same.name, const: same.const, ...headerOf(same), tileset: draft.tileset || same.tileset });
		else set({ target: "new", name: `${form.gen1.name}Gen1`, const: `${form.gen1.const}_GEN1` });
	};
	const chooseTileset = (tileset: string) => {
		if (!form || !draft) return;
		// With no same-named CSE map, a new map's header follows the tileset's most common values.
		if (draft.target === "new" && !form.sameNamed && !form.locked) set({ tileset, ...headerDefaults(form.cseMaps, tileset) });
		else set({ tileset });
	};

	const save = async () => {
		if (!draft) return;
		setSaving(true);
		setError(null);
		try {
			await saveSetup(draft);
			onSaved(draft.gen1Const);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const same = form?.sameNamed;
	const sizeMatches = !!same && !!form && same.width === form.gen1.width && same.height === form.gen1.height;
	const headerLocked = replacing;
	return (
		<Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{form && isSetUp(form) ? `Map settings: ${form.draft.const}` : `Set up ${target?.gen1Const ?? ""}`}</DialogTitle>
					<DialogDescription>
						{form
							? `${target?.game} ${form.gen1.name} (${form.gen1.const}), ${form.gen1.width}×${form.gen1.height} blocks, Gen 1 tileset ${form.gen1.tileset}. Saving writes the tool's tables only; Port writes the map.`
							: "Loading…"}
					</DialogDescription>
				</DialogHeader>
				{form && draft && (
					<div className="flex flex-col gap-4">
						{form.locked && (
							<p className="rounded-md border border-border bg-muted p-2 text-xs text-muted-foreground">
								Already ported, so the name and constant can't change (the files already written use them). Rename by hand, or start again. A new group moves the map on the next Port.
							</p>
						)}
						{same && !form.locked && (
							<Field label="Target" hint={sizeMatches
								? `The project already has ${same.name} (${same.const}). Replacing keeps its header (except the tileset), its connections and its script, and overwrites its blocks after a warning.`
								: `The project already has ${same.name} (${same.const}), but it's ${same.width}×${same.height}, so it can only be ported as a new map.`}>
								<Pick value={draft.target} onChange={(v) => chooseTarget(v as "new" | "replace")} options={[
									{ value: "new", label: "New map" },
									...(sizeMatches ? [{ value: "replace", label: `Replace the project's ${same.name}` }] : []),
								]} />
							</Field>
						)}
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<Field label="Name">
								<input className={inputClass} value={draft.name} disabled={form.locked || replacing} onChange={(e) => set({ name: e.target.value })} />
							</Field>
							<Field label="Constant">
								<input className={inputClass} value={draft.const} disabled={form.locked || replacing} onChange={(e) => set({ const: e.target.value.toUpperCase() })} />
							</Field>
							<Field label="Project tileset" hint={form.draft.tileset ? undefined : "Nothing to go on yet: pick the tileset whose blocks look closest."}>
								<Pick value={draft.tileset} options={form.options.tilesets} onChange={chooseTileset} />
							</Field>
							<Field label="Group" hint={headerLocked ? "Kept from the replaced map." : /^\d+$/.test(form.options.groups[0] ?? "") ? "This project numbers its groups (MapGroup1, MapGroup2…)." : undefined}>
								<Pick value={draft.group} options={form.options.groups} onChange={(v) => set({ group: v })} disabled={headerLocked} />
							</Field>
						</div>
						<div className="flex flex-col gap-3 rounded-md border border-border p-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="text-xs font-medium">Header</span>
								{!headerLocked && (
									<div className="w-56">
										<Pick value="" placeholder="Copy from a project map…" options={form.cseMaps.map((m) => ({ value: m.name, label: `${m.name} (${m.tileset})` }))}
											onChange={(name) => {
												const m = form.cseMaps.find((x) => x.name === name);
												if (m) setHeader(headerOf(m));
											}} />
									</div>
								)}
							</div>
							{headerLocked && <p className="text-xs text-muted-foreground">A replaced map keeps its own header; only the tileset changes.</p>}
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<Field label="Environment"><Pick value={draft.environment} options={form.options.environments} onChange={(v) => set({ environment: v })} disabled={headerLocked} /></Field>
								<Field label="Landmark"><Pick value={draft.landmark} options={form.options.landmarks} onChange={(v) => set({ landmark: v })} disabled={headerLocked} /></Field>
								<Field label="Music"><Pick value={draft.music} options={form.options.music} onChange={(v) => set({ music: v })} disabled={headerLocked} /></Field>
								<Field label="Palette"><Pick value={draft.palette} options={form.options.palettes} onChange={(v) => set({ palette: v })} disabled={headerLocked} /></Field>
								<Field label="Phone"><Pick value={draft.noPhone} options={[
									{ value: form.options.phone.on, label: "Phone works" },
									{ value: form.options.phone.off, label: "No phone service" },
								]} onChange={(v) => set({ noPhone: v })} disabled={headerLocked} /></Field>
								{form.extras.includes("fishGroup") && (
									<Field label="Fish group"><Pick value={draft.fishGroup} options={form.options.fishGroups} onChange={(v) => set({ fishGroup: v })} disabled={headerLocked} /></Field>
								)}
								{form.extras.includes("sign") && (
									<Field label="Location sign"><Pick value={draft.sign} options={form.options.signs} onChange={(v) => set({ sign: v })} disabled={headerLocked} /></Field>
								)}
							</div>
						</div>
						<Field label={`Warp collision for ${form.gen1.tileset} maps`} hint={form.warpCollSet
							? `Already set for every ${form.gen1.tileset} map (tables/tilesets.json).`
							: `The collision a Gen 1 door or warp tile gets. Set once for every ${form.gen1.tileset} map.`}>
							<Pick value={draft.warpColl} options={form.options.warpColls} onChange={(v) => set({ warpColl: v })} disabled={form.warpCollSet} />
						</Field>
					</div>
				)}
				{error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
				<DialogFooter>
					<Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
					<Button size="sm" onClick={save} disabled={!draft || saving}>{saving ? "Saving…" : form && isSetUp(form) ? "Save settings" : "Set up"}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const isSetUp = (form: SetupForm) => form.setUp;
