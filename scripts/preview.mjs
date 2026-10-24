// Render a port's current mapping: Gen 1 on top, the CSE result below. With --accept, unpaired
// blocks first take their top suggestion (not saved).
// usage: node scripts/preview.mjs GEN1_CONST out_prefix [--accept]

import { writeFileSync } from "node:fs";

import { walkabilityDiff, withAppended } from "../dist/shared/mapping.js";
import { portContext } from "../dist/shared/node/port.js";
import { encodePng } from "../dist/shared/node/png.js";
import { loadConfig } from "../dist/shared/node/project.js";
import { drawBlock } from "../dist/shared/render.js";
import { suggestBlocks } from "../dist/shared/suggest.js";
import { finalGrid } from "../dist/shared/warps.js";
import { cseEnvironment } from "./preview-lib.mjs";

const [gen1Const, out, flag] = process.argv.slice(2);
const config = loadConfig();
let ctx = portContext(config, gen1Const);
const mapping = structuredClone(ctx.mapping);
if (flag === "--accept") {
	for (const g of ctx.result.unpaired) {
		const kinds = ctx.result.blocks.get(g).gen1Kinds;
		const top = suggestBlocks(ctx.gen1Map.tileset, g, kinds, ctx.cseTileset, 1)[0];
		if (top) mapping.blocks[String(g)] = { cse: top.cse };
	}
	ctx = portContext(config, gen1Const, mapping);
}
const { gen1Map } = ctx;
const final = finalGrid(gen1Map, ctx.gen1Coll, ctx.result, ctx.cseTileset, ctx.tilesetEntry.warpColl, ctx.collisionNames);
const cse = withAppended(ctx.cseTileset, final.appended);
const palettes = cseEnvironment(config, ctx.entry.environment).nite;
const view = (game, tileset) => ({ game, tileset, blocks: new Uint8Array(0), notes: [] });
const W = gen1Map.width * 32, H = gen1Map.height * 32;
const img = { width: W, height: H * 2 + 8, rgba: new Uint8Array(W * (H * 2 + 8) * 4).fill(40) };
for (let i = 0; i < gen1Map.width * gen1Map.height; i++) {
	const x = (i % gen1Map.width) * 32, y = Math.floor(i / gen1Map.width) * 32;
	drawBlock(view("yellow", gen1Map.tileset), gen1Map.blocks[i], img, x, y);
	const c = final.grid[i];
	if (c !== undefined) drawBlock(view("cse", cse), c, img, x, H + 8 + y, palettes);
}
writeFileSync(`${out}_map.png`, encodePng(img));
const diff = walkabilityDiff(gen1Map, ctx.gen1Coll, final.grid, cse);
console.log(`unpaired ${ctx.result.unpaired.length}, new ${final.appended.length}, walk issues ${diff.issues.length}, edges ${diff.edges.length} (${diff.edges.filter((e) => e.crossable).length} crossable)`);
