// Canvas views built on the shared renderer: one block, a whole map, a tile sheet.

import { useEffect, useRef } from "react";

import { drawBlock, to8 } from "../../shared/render";
import type { GameMap, Palette, RgbaImage, Tileset } from "../../shared/types";

/** A map-shaped wrapper so drawBlock can draw from any tileset. */
export function viewOf(game: GameMap["game"], tileset: Tileset): GameMap {
	return { game, name: "", constName: "", width: 0, height: 0, blocks: new Uint8Array(0), tileset, notes: [] };
}

function paint(canvas: HTMLCanvasElement | null, image: RgbaImage) {
	if (!canvas) return;
	canvas.width = image.width;
	canvas.height = image.height;
	const ctx = canvas.getContext("2d")!;
	ctx.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
}

function blank(width: number, height: number): RgbaImage {
	return { width, height, rgba: new Uint8Array(width * height * 4) };
}

export function BlockCanvas({ view, block, palettes, scale = 2, className = "", title }: {
	view: GameMap;
	block: number;
	palettes?: Palette[];
	scale?: number;
	className?: string;
	title?: string;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const img = blank(32, 32);
		drawBlock(view, block, img, 0, 0, palettes);
		paint(ref.current, img);
	}, [view, block, palettes]);
	return <canvas ref={ref} title={title} className={`pixelated ${className}`} style={{ width: 32 * scale, height: 32 * scale }} />;
}

/** A whole map; `blockAt` gives each position's block in `view` (undefined = unpaired). */
/** `hover` lightens that block; `onHover` reports the block under the mouse (null on leaving).
 * `squareLabel` names what's on the square under the mouse (shown as the canvas's tooltip). */
export function MapCanvas({ view, width, height, blockAt, palettes, scale = 2, onPick, overlay, hover, onHover, squareLabel }: {
	view: GameMap;
	width: number;
	height: number;
	blockAt: (i: number) => number | undefined;
	palettes?: Palette[];
	scale?: number;
	onPick?: (i: number) => void;
	overlay?: (ctx: CanvasRenderingContext2D) => void;
	hover?: number | null;
	onHover?: (i: number | null) => void;
	squareLabel?: (sx: number, sy: number) => string | undefined;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const img = blank(width * 32, height * 32);
		for (let i = 0; i < width * height; i++) {
			const b = blockAt(i);
			const x = (i % width) * 32, y = Math.floor(i / width) * 32;
			if (b === undefined) {
				for (let yy = 0; yy < 32; yy++) {
					for (let xx = 0; xx < 32; xx++) {
						const o = ((y + yy) * img.width + x + xx) * 4;
						const on = (xx + yy) % 8 < 4;
						img.rgba.set(on ? [255, 0, 255, 255] : [60, 0, 60, 255], o);
					}
				}
			} else {
				drawBlock(view, b, img, x, y, palettes);
			}
		}
		paint(ref.current, img);
		if (overlay && ref.current) overlay(ref.current.getContext("2d")!);
	}, [view, width, height, blockAt, palettes, overlay]);
	const blockUnder = (e: React.MouseEvent<HTMLCanvasElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		const bx = Math.min(width - 1, Math.floor(((e.clientX - r.left) / r.width) * width));
		const by = Math.min(height - 1, Math.floor(((e.clientY - r.top) / r.height) * height));
		return by * width + bx;
	};
	const size = 32 * scale;
	return (
		<div className="relative shrink-0" style={{ width: width * size, height: height * size }}>
			<canvas
				ref={ref}
				className="pixelated block cursor-crosshair"
				style={{ width: width * size, height: height * size }}
				onClick={(e) => onPick?.(blockUnder(e))}
				onMouseMove={(e) => {
					const i = blockUnder(e);
					if (i !== hover) onHover?.(i);
					if (squareLabel) {
						const r = e.currentTarget.getBoundingClientRect();
						const sx = Math.floor(((e.clientX - r.left) / r.width) * width * 2), sy = Math.floor(((e.clientY - r.top) / r.height) * height * 2);
						e.currentTarget.title = squareLabel(sx, sy) ?? "";
					}
				}}
				onMouseLeave={() => onHover?.(null)}
			/>
			{hover != null && (
				<div className="pointer-events-none absolute bg-white/35 outline outline-1 outline-white/70"
					style={{ left: (hover % width) * size, top: Math.floor(hover / width) * size, width: size, height: size }} />
			)}
		</div>
	);
}

/** A project's tile sheet, 16 tiles a row, in one palette or each tile in its own; click picks a tile. */
export function TileSheet({ tileset, palette, selected, onPick, scale = 2 }: {
	tileset: Tileset;
	palette: Palette | ((tile: number) => Palette);
	selected?: number;
	onPick: (tile: number) => void;
	scale?: number;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	const rows = Math.ceil(tileset.tileCount / 16);
	useEffect(() => {
		const img = blank(128, rows * 8);
		for (let t = 0; t < tileset.tileCount; t++) {
			const tx = (t % 16) * 8, ty = Math.floor(t / 16) * 8;
			const pal = typeof palette === "function" ? palette(t) : palette;
			for (let y = 0; y < 8; y++) {
				for (let x = 0; x < 8; x++) {
					const c = pal[tileset.tiles[t * 64 + y * 8 + x]!]!;
					img.rgba.set([to8(c[0]), to8(c[1]), to8(c[2]), 255], ((ty + y) * 128 + tx + x) * 4);
				}
			}
		}
		paint(ref.current, img);
		if (selected !== undefined && ref.current) {
			const ctx = ref.current.getContext("2d")!;
			ctx.strokeStyle = "#f0f";
			ctx.lineWidth = 1;
			ctx.strokeRect((selected % 16) * 8 + 0.5, Math.floor(selected / 16) * 8 + 0.5, 7, 7);
		}
	}, [tileset, palette, rows, selected]);
	return (
		<canvas
			ref={ref}
			className="pixelated cursor-pointer"
			style={{ width: 128 * scale, height: rows * 8 * scale }}
			onClick={(e) => {
				const r = e.currentTarget.getBoundingClientRect();
				const x = Math.floor(((e.clientX - r.left) / r.width) * 16);
				const y = Math.floor(((e.clientY - r.top) / r.height) * rows);
				const t = y * 16 + x;
				if (t < tileset.tileCount) onPick(t);
			}}
		/>
	);
}
