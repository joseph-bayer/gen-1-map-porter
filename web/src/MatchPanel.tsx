// Gen 1 names this map's events use that the project has no match for yet: a picker for each, saved to the
// project's tables (tables/sprites.json, items.json, trainer_classes.json, species.json) as soon as
// one is picked. Port waits for all.

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { loadCseChoices, saveChoice, type Missing, type MissingKind } from "./api";

const KIND_LABEL: Record<MissingKind, string> = {
	sprite: "Sprite",
	palette: "Palette for",
	item: "Item",
	class: "Trainer class",
	species: "Pokémon",
};

const KIND_HINT: Record<MissingKind, string> = {
	sprite: "The project has no sprite of this name. Pick the closest look; every map using it gets the same.",
	palette: "The NPC palette this sprite uses on every ported map. Default is the sprite's own.",
	item: "The project has no item of this name.",
	class: "The project has no trainer class of this name. Its trainers use the class you pick.",
	species: "The project has no species of this name.",
};

function Row({ m, choices, onSaved }: { m: Missing; choices: string[]; onSaved: () => void }) {
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const suggested = m.suggestion && choices.includes(m.suggestion) ? m.suggestion : undefined;
	// Picking saves at once; the suggestion is listed first but never saved without a pick.
	const pick = async (v: string) => {
		setValue(v);
		setSaving(true);
		setError(null);
		try {
			await saveChoice(m.kind, m.gen1, v);
			onSaved();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setValue("");
		} finally {
			setSaving(false);
		}
	};
	return (
		<div className="flex flex-wrap items-center gap-2 text-xs" title={KIND_HINT[m.kind]}>
			<span className="w-24 text-muted-foreground">{KIND_LABEL[m.kind]}</span>
			<span className="w-56 font-mono">{m.gen1}</span>
			<span className="text-muted-foreground">→</span>
			<Select value={value || undefined} onValueChange={pick} disabled={saving}>
				<SelectTrigger size="sm" className="w-56 text-xs"><SelectValue placeholder={suggested ? `Choose… (suggested: ${suggested})` : "Choose…"} /></SelectTrigger>
				<SelectContent className="max-h-72">
					{[...(suggested ? [suggested] : []), ...choices.filter((c) => c !== suggested)].map((c) => (
						<SelectItem key={c} value={c}>{c}{c === suggested ? " (suggested)" : ""}</SelectItem>
					))}
				</SelectContent>
			</Select>
			{saving && <span className="text-muted-foreground">Saving…</span>}
			{error && <span className="text-destructive">{error}</span>}
		</div>
	);
}

/** One row per unmatched name; saving one reloads the page through the version poll. */
export function MatchPanel({ missing, onSaved }: { missing: Missing[]; onSaved: () => void }) {
	const [choices, setChoices] = useState<Record<MissingKind, string[]> | null>(null);
	useEffect(() => {
		loadCseChoices().then(setChoices, () => setChoices(null));
	}, []);
	if (!missing.length) return null;
	return (
		<Card className="border-destructive/40">
			<CardHeader>
				<CardTitle className="text-sm">
					{missing.length} Gen 1 name{missing.length === 1 ? "" : "s"} need a match in the project before Port
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<p className="text-xs text-muted-foreground">
					This map's events use them. A choice is saved as soon as you pick it, to the project's tables, so later maps reuse it.
				</p>
				{!choices
					? <p className="text-xs text-muted-foreground">Loading choices…</p>
					: missing.map((m) => <Row key={`${m.kind}:${m.gen1}`} m={m} choices={choices[m.kind] ?? []} onSaved={onSaved} />)}
			</CardContent>
		</Card>
	);
}
