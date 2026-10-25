# Gen 1 Map Porter

> **Disclaimer:** Generative AI was used as a code assistant for development of this tool.

Bring Pokémon Red, Blue and Yellow maps into your Pokémon Crystal hack.

Pick a Gen 1 map, pair its blocks with blocks from one of your tilesets, and port it. The porter
writes the map, its collision, its warps and its events (signs, people, trainers, items, hidden
items, Strength boulders and holes) into your project as ordinary source files, ready to build.

It works with three kinds of Crystal project:

| Project | Tested against |
|---|---|
| [CrystalShireEngine](https://github.com/fellowship-of-the-roms/CrystalShireEngine) | the CSE-based hack it was built for |
| [pret/pokecrystal](https://github.com/pret/pokecrystal) | commit `5c877ef` (Oct 2026) |
| [Polished Crystal](https://github.com/Rangi42/polishedcrystal) | commit `0aa83fa` (Oct 2026) |

Forks of these usually work too. The porter doesn't go by a project's name. It reads how the
project's own files and macros are laid out (see [Your project's features](#your-projects-features)),
and if something is laid out in a way it doesn't know, it says exactly what.

The Gen 1 maps come from your own copies of the [pret/pokered](https://github.com/pret/pokered)
and [pret/pokeyellow](https://github.com/pret/pokeyellow) disassemblies. Nothing from the games is
included here.

## Getting it

**With the Crystal Tool Suite launcher (easiest):** install the
[launcher](https://github.com/joseph-bayer/crystal-tool-suite), click **Install** on Gen 1 Map
Porter, then **Start**. It updates from there with one click.

**On its own:** download the zip from [Releases](https://github.com/joseph-bayer/gen-1-map-porter/releases),
unzip it anywhere, run `gen1-map-porter.exe`, and open <http://localhost:5174> in your browser.
Nothing else needs installing.

Windows only for now.

> Windows may warn that the app is from an unknown publisher the first time you run it
> (**More info → Run anyway**). The releases aren't code-signed.

## Before you start

You'll need:
- your hack, in a folder that builds;
- a clone of [pret/pokered](https://github.com/pret/pokered) for Red and Blue maps, and/or
  [pret/pokeyellow](https://github.com/pret/pokeyellow) for Yellow's.

Commit your hack first, or work on a branch. The porter edits your project's files directly, so git
is how you review and undo a port.

## Porting a map

1. **Folders.** Open **Folders** and choose your **Crystal project** and your pokered and pokeyellow
   folders. Below them, the porter lists what it detected about your project.
2. **Pick a map.** On the **Port** tab, choose the game and a map. The first time you port a map, the
   **Set up** form asks for its name in your project, its map group, its tileset, and its header
   values (landmark, music, palette…). The defaults come from similar maps in your project.
3. **Pair the blocks.** Each Gen 1 block needs a block from your tileset.
   - Pairings are suggested for you. Suggestions rank by matching collision first, then by how
     alike the graphics look. **Accept top suggestions** takes them all.
   - For a block with no good match, **Build from tiles** makes a new block out of your
     tileset's tiles.
   - You can change the collision of any quarter of a block.
   - The **Preview** shows the result. Squares you can walk on where Gen 1 couldn't, or the
     other way round, are marked red, and Gen 1's ledges and cliff edges are marked yellow.
   - **Save mapping** keeps your pairings. Every map on the same pair of tilesets shares them, so
     the second Cerulean Cave floor needs far less work than the first.
4. **Match names.** If the map uses something your project doesn't have, such as a sprite, an item
   or a trainer class, the porter asks you to pick a replacement. It remembers your pick for the
   whole project.
5. **Dry run, then Port.** **Dry run** shows everything that would be written, without writing
   anything. **Port** writes it. Then build your project the usual way.

Porting a map again is safe:
- identical blocks are reused, not appended twice;
- the map's script file is only rewritten while it still carries the porter's two-line
  "generated" header. Delete those lines once you start editing the file by hand.

## What it writes

Into your project:
- the map's blocks file and its registration (map constants, headers, attributes, blocks,
  scripts);
- new blocks appended to the tileset, with their collision (and attributes, where the project
  has them);
- a script file with the map's warps, signs, people, trainers and their parties, item balls,
  hidden items, Strength boulders, and holes you fall through;
- event flags for items, trainers and boulders. They fill free and unused flags only; the porter
  never grows the flag array.

A warp to a map you haven't ported yet points back at its own square until you port the
destination. Then port the first map again to connect them.

## What it leaves to you

- **Map scripts and story events.** Gen 1's scripts are plain assembly, so the porter writes a stub
  and notes what was there.
- **Wild Pokémon.** Your encounter tables are yours to curate; the porter doesn't touch them.
- **Things with no Crystal counterpart**, like Gen 1's one-off hidden events (slot machines, the
  Cinnabar quiz) and Seafoam's currents. They're left as comments and listed in the report.
- **Building the ROM** and **bank space.** If a bank overflows when you build, move a section in
  your layout the way you normally would.
- **Running out of event flags.** The porter stops and tells you how many the map needs and what to
  raise in your project.

## Your project's features

Rather than asking which engine you use, the porter reads your project's own files: its macro
definitions, constants and data layout. From those it works out 14 things, such as:
- whether colors are per block or per tile;
- how many tiles a tileset holds;
- how `object_event` and the map headers are laid out;
- whether species and items are 8-bit or 16-bit;
- what the collision types are called;
- how trainer parties are written.

The **Folders** panel shows what it found, says which known base your project looks like, and lets
you override any feature for that project. Overrides are saved in the project.

## Where it keeps things

Everything the porter needs to remember about a project is stored in that project, in
`tools/gen1-map-porter/`, so you commit it along with the maps it made:
- your block pairings (`mappings/`);
- your name matches and map setups (`tables/`);
- a record of what each port wrote (`ports/`);
- any feature overrides.

Your chosen folders are remembered per user, in `%APPDATA%\gen1-map-porter\`. Folders that any
Crystal Tool Suite tool has found are shared in `%APPDATA%\Crystal Tool Suite\known-paths.json`.

## Building from source

Needs Node 22.

```bash
npm ci
npm run dev       # the page with hot reload on http://localhost:5173, the server on :5174
npm run build
npm start         # the built page and server on http://localhost:5174
npm run package   # the release folder: release/gen1-map-porter.exe and its files
```

A command line is included for scripting:

```bash
npm run cli -- list   --game yellow
npm run cli -- render --game yellow --map CERULEAN_CAVE_1F
npm run cli -- port   --map CERULEAN_CAVE_1F --dry-run
```

| Folder | What |
|---|---|
| `shared/` | format readers, the renderer and the feature catalogue, shared by everything |
| `shared/node/` | the parts that touch files: projects, ports, tables, settings |
| `server/` | the local web server (the page plus its API) |
| `web/` | the page (React, Vite, Tailwind, shadcn) |
| `cli/` | the command line |
| `tables/<base>/` | default names for each known base |

Releases are built by GitHub Actions from a version tag and listed in the Crystal Tool Suite's index.

## Credits

- The Gen 1 data formats come from the [pret](https://github.com/pret) disassemblies: pokered,
  pokeyellow and pokecrystal.
- Detecting project formats feature by feature follows how
  [Polished Map](https://github.com/Rangi42/polished-map) and Polished Map++ handle projects, by
  [Rangi42](https://github.com/Rangi42).
- Built for the Crystal hack Crystal For Friends, on
  [CrystalShireEngine](https://github.com/fellowship-of-the-roms/CrystalShireEngine).

## License

MIT; see `LICENSE`. Third-party licenses for what the release bundles are in
`THIRD_PARTY_NOTICES.txt`.
