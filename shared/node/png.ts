// A small PNG codec on Node's zlib: decodes any non-interlaced PNG to RGBA, encodes RGBA.

import { deflateSync, inflateSync } from "node:zlib";

import type { RgbaImage } from "../types.js";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) {
		c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Uint8Array, name = "PNG"): RgbaImage {
	for (let i = 0; i < SIGNATURE.length; i++) {
		if (file[i] !== SIGNATURE[i]) throw new Error(`${name}: not a PNG`);
	}
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	let pos = 8;
	let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
	let palette: Uint8Array | undefined;
	let transparency: Uint8Array | undefined;
	const idat: Uint8Array[] = [];
	while (pos < file.length) {
		const length = view.getUint32(pos);
		const type = String.fromCharCode(...file.subarray(pos + 4, pos + 8));
		const data = file.subarray(pos + 8, pos + 8 + length);
		pos += 12 + length;
		if (type === "IHDR") {
			width = view.getUint32(pos - length - 4);
			height = view.getUint32(pos - length);
			bitDepth = data[8]!;
			colorType = data[9]!;
			interlace = data[12]!;
		} else if (type === "PLTE") {
			palette = data;
		} else if (type === "tRNS") {
			transparency = data;
		} else if (type === "IDAT") {
			idat.push(data);
		} else if (type === "IEND") {
			break;
		}
	}
	if (interlace) throw new Error(`${name}: interlaced PNGs aren't supported`);
	const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
	if (!channels) throw new Error(`${name}: unknown color type ${colorType}`);

	const raw = inflateSync(Buffer.concat(idat));
	const bitsPerPixel = channels * bitDepth;
	const stride = Math.ceil((width * bitsPerPixel) / 8);
	const bpp = Math.max(1, bitsPerPixel >> 3);
	const pixels = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]!;
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const out = pixels.subarray(y * stride, (y + 1) * stride);
		const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : undefined;
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? out[x - bpp]! : 0;
			const b = prev ? prev[x]! : 0;
			const c = prev && x >= bpp ? prev[x - bpp]! : 0;
			const v = line[x]!;
			out[x] = (filter === 0 ? v
				: filter === 1 ? v + a
				: filter === 2 ? v + b
				: filter === 3 ? v + ((a + b) >> 1)
				: v + paeth(a, b, c)) & 0xff;
		}
	}

	const rgba = new Uint8Array(width * height * 4);
	const maxValue = (1 << bitDepth) - 1;
	const sample = (row: Uint8Array, index: number): number => {
		if (bitDepth === 8) return row[index]!;
		if (bitDepth === 16) return row[index * 2]!;
		const bit = index * bitDepth;
		return (row[bit >> 3]! >> (8 - bitDepth - (bit & 7))) & maxValue;
	};
	const to8 = (v: number) => (bitDepth >= 8 ? v : Math.round((v * 255) / maxValue));
	for (let y = 0; y < height; y++) {
		const row = pixels.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			if (colorType === 3) {
				const i = sample(row, x);
				rgba[o] = palette?.[i * 3] ?? 0;
				rgba[o + 1] = palette?.[i * 3 + 1] ?? 0;
				rgba[o + 2] = palette?.[i * 3 + 2] ?? 0;
				rgba[o + 3] = transparency?.[i] ?? 255;
			} else {
				const s = (k: number) => to8(sample(row, x * channels + k));
				const g = s(0);
				rgba[o] = g;
				rgba[o + 1] = channels >= 3 ? s(1) : g;
				rgba[o + 2] = channels >= 3 ? s(2) : g;
				rgba[o + 3] = channels === 2 ? s(1) : channels === 4 ? s(3) : 255;
			}
		}
	}
	return { width, height, rgba };
}

export function encodePng(image: RgbaImage): Uint8Array {
	const { width, height, rgba } = image;
	const raw = new Uint8Array((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (width * 4 + 1)] = 0;
		raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	}
	const chunk = (type: string, data: Uint8Array): Uint8Array => {
		const out = new Uint8Array(12 + data.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
		out.set(data, 8);
		view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
		return out;
	};
	const ihdr = new Uint8Array(13);
	const hv = new DataView(ihdr.buffer);
	hv.setUint32(0, width);
	hv.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	return Buffer.concat([
		Buffer.from(SIGNATURE),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array(0)),
	]);
}
