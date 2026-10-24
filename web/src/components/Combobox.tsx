// A dropdown you can type into to filter: a button that opens a list with a search box on top.
// Arrow keys move, Enter picks, Escape closes. Built on Radix Popover (no extra package).

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { Popover } from "radix-ui";

export interface ComboboxOption {
	value: string;
	label: string;
	/** Small text after the label, e.g. a status. */
	detail?: string;
	detailClassName?: string;
}

export function Combobox({ options, value, onChange, placeholder = "Choose…", searchPlaceholder = "Type to filter…", className }: {
	options: ComboboxOption[];
	value?: string;
	onChange: (value: string) => void;
	placeholder?: string;
	searchPlaceholder?: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const list = useRef<HTMLDivElement>(null);
	const current = options.find((o) => o.value === value);
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase().replace(/\s+/g, "_");
		return q ? options.filter((o) => `${o.label} ${o.detail ?? ""}`.toLowerCase().replace(/\s+/g, "_").includes(q)) : options;
	}, [options, query]);

	// Opening starts on the current value; typing starts on the first match.
	useEffect(() => {
		if (open) setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
	}, [open]); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => setActive(0), [query]);
	useEffect(() => {
		list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
	}, [active, open]);

	const pick = (o: ComboboxOption | undefined) => {
		if (!o) return;
		setOpen(false);
		setQuery("");
		onChange(o.value);
	};
	return (
		<Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
			<Popover.Trigger asChild>
				<button type="button"
					className={cn("flex h-7 items-center justify-between gap-1.5 rounded-[min(var(--radius-md),10px)] border border-input bg-transparent pr-2 pl-2.5 text-sm whitespace-nowrap outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
					<span className="flex min-w-0 items-center gap-1.5 truncate">
						{current ? <>{current.label}{current.detail && <span className={cn("text-[10px]", current.detailClassName)}>{current.detail}</span>}</> : <span className="text-muted-foreground">{placeholder}</span>}
					</span>
					<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content align="start" sideOffset={4}
					className="z-50 flex w-(--radix-popover-trigger-width) min-w-72 flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
					onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}>
					<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder}
						className="h-8 border-b border-border bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
						onKeyDown={(e) => {
							if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
							else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
							else if (e.key === "Enter") { e.preventDefault(); pick(shown[active]); }
						}} />
					<div ref={list} role="listbox" className="max-h-96 overflow-y-auto p-1">
						{shown.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No matches.</p>}
						{shown.map((o, i) => (
							<div key={o.value} role="option" aria-selected={o.value === value} data-index={i}
								onMouseMove={() => setActive(i)} onClick={() => pick(o)}
								className={cn("flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-sm", i === active && "bg-accent text-accent-foreground", o.value === value && "font-medium")}>
								{o.label}
								{o.detail && <span className={cn("text-[10px]", o.detailClassName)}>{o.detail}</span>}
							</div>
						))}
					</div>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
