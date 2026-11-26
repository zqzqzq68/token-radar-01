// main.ts — the token launch radar's entrypoint.
//
// Reads the sealed snapshot, ranks every pre-token protocol by implied
// value, and writes the whole entry into the output directory:
//   board.json            the ranked board (rows with farm steps)
//   dashboard/            the page (index.html, app.css, app.js) plus
//                         data.js, the board's data in compact form
//   screenshots/          the three screenshots, copied from the repo
//   dossier.json          buildDossier's dossier of dashboard + screenshots
//
// Run it with:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
// Defaults: input /input/snapshot.json, output $MAKEFUN_OUTPUT_DIR or /output.
// It writes the same bytes on every run: no clock, no randomness.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBoard,
  familyOf,
  gasForChain,
  STEP_TEMPLATES,
  type Snapshot,
} from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const TEXT_MAX_BYTES = 65536;

function parseInputPath(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith("--input=")) return argv[i].slice("--input=".length);
  }
  return "/input/snapshot.json";
}

/**
 * The dashboard's data in compact form: one array per row, short keys,
 * categories and gas costs factored out into shared tables, and the farm
 * step templates carried once so the page expands the same plan the board
 * holds. Kept small on purpose: the dossier shows the dashboard's source
 * whole only while it fits in 64 KiB.
 */
function buildDashboardData(model: ReturnType<typeof buildBoard>): unknown {
  const cats = [...new Set(model.rows.map((r) => r.category))].sort();
  const catIndex = new Map(cats.map((c, i) => [c, i]));
  const bench: Record<string, [number, number]> = {};
  for (const c of cats) {
    const hit = model.benchmarks[c];
    bench[c] = hit ? [hit.ratio, hit.n] : [model.globalMedian, 0];
  }
  const gas: Record<string, string> = {};
  for (const r of model.rows) gas[r.chain] = gasForChain(r.chain);
  const famByCat = cats.map((c) => familyOf(c === "(uncategorised)" ? null : c));
  const rows = model.rows.map((r) => [
    r.rank,
    r.slug,
    r.name,
    catIndex.get(r.category) ?? 0,
    r.chain,
    r.chains.length,
    r.tvl_usd,
    r.change_7d,
    r.age_days,
    r.implied_value_usd,
    r.on_watchlist ? 1 : 0,
  ]);
  return {
    asOf: model.asOf,
    floor: model.floorUsd,
    preToken: model.preTokenCount,
    excluded: model.excludedCount,
    rows: model.rows.length,
    globalMedian: model.globalMedian,
    cats,
    bench,
    gas,
    famByCat,
    templates: STEP_TEMPLATES,
    data: rows,
  };
}

function main(): void {
  const inputPath = parseInputPath(process.argv.slice(2));
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const repoRoot = path.dirname(fileURLToPath(import.meta.url));

  const snapshot = JSON.parse(
    fs.readFileSync(inputPath, "utf8"),
  ) as Snapshot;
  const model = buildBoard(snapshot);

  fs.mkdirSync(outputDir, { recursive: true });

  // The ranked board. Extra keys are allowed; the gate reads rows.
  const board = {
    as_of: model.asOf,
    floor_usd: model.floorUsd,
    model:
      "implied_value_usd = tvl_usd x category benchmark (median market-cap/TVL of token-bearing protocols in the same category, cross-category median when fewer than five comparables) x growth (damped, capped 7-day TVL change) x age (saturating bonus for days listed with no token). The board ranks genuine launch candidates only: protocols that record no token and are not a wrapped, staked or bridged product of a token that already trades (Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, versioned names, wrapped/staked names and exchange-led names are left out).",
    global_median_benchmark: model.globalMedian,
    pre_token_protocols: model.preTokenCount,
    excluded_products: model.excludedCount,
    rows: model.rows,
  };
  fs.writeFileSync(
    path.join(outputDir, "board.json"),
    JSON.stringify(board, null, 2) + "\n",
    "utf8",
  );

  // The dashboard: copy the page, then write its data beside it.
  const dashOut = path.join(outputDir, "dashboard");
  fs.rmSync(dashOut, { recursive: true, force: true });
  fs.cpSync(path.join(repoRoot, "dashboard"), dashOut, { recursive: true });
  fs.writeFileSync(
    path.join(dashOut, "data.js"),
    "window.RADAR = " +
      JSON.stringify(buildDashboardData(model)) +
      ";\n",
    "utf8",
  );

  // The screenshots. The repository stores them as base64 text (one .b64
  // file per image, so the repository stays text-only) and this step decodes
  // each one to its PNG in /output/screenshots, the form the gate reads.
  const shotsIn = path.join(repoRoot, "screenshots");
  const shotsOut = path.join(outputDir, "screenshots");
  fs.rmSync(shotsOut, { recursive: true, force: true });
  fs.mkdirSync(shotsOut, { recursive: true });
  for (const f of fs.readdirSync(shotsIn).sort()) {
    if (!f.endsWith(".b64")) continue;
    const pngName = f.slice(0, -".b64".length);
    const b64 = fs.readFileSync(path.join(shotsIn, f), "utf8").trim();
    fs.writeFileSync(path.join(shotsOut, pngName), Buffer.from(b64, "base64"));
  }

  // The dossier, byte for byte what the library writes.
  const dossier = buildDossier(outputDir, { text_max_bytes: TEXT_MAX_BYTES });
  fs.writeFileSync(path.join(outputDir, "dossier.json"), dossier);

  const boardBytes = fs.statSync(path.join(outputDir, "board.json")).size;
  const dossierBytes = fs.statSync(path.join(outputDir, "dossier.json")).size;
  process.stdout.write(
    `radar: ${model.rows.length} rows, board.json ${boardBytes} bytes, dossier.json ${dossierBytes} bytes\n`,
  );
}

main();
