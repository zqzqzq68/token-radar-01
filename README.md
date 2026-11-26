# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zqzqzq68/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zqzqzq68/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks the 198 genuine pre-token launch candidates by an implied market value, and writes a sortable, filterable dashboard plus a concrete farming plan for every candidate. The value model is `implied = TVL × benchmark × growth × age`: the benchmark is the median market-cap/TVL ratio of token-bearing protocols in the same category (cross-category median where the category has fewer than five comparables), growth scales with the 7-day TVL change, and age scales with how long the protocol has run with no token. Wrapped, bridged and staked products of tokens that already trade (Bridge, Liquid Staking, Restaking, CEX, versioned and exchange-named products) are excluded, so the board lists launch candidates, not tokens that already exist. Entry for make.fun's "Build the best token launch radar" bounty ($1,325 in USDC).

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

`main.ts` reads the snapshot, writes `board.json` (198 ranked rows with the value breakdown and a 5-step farm plan each), copies the dashboard into `out/dashboard`, decodes the three screenshots into `out/screenshots`, and writes `out/dossier.json`. The run is deterministic: two runs write identical bytes.

## Method

- **Universe:** a protocol is a launch candidate when it has no token (`gecko_id` and `symbol` both null) and is not a wrapped/bridged/staked product of an already-trading token. 198 candidates pass (60 above the $50M floor, 138 below); 144 are excluded and all 40 watchlist slugs are kept.
- **Benchmark:** median mcap/TVL over token-bearing protocols in the same category (n ≥ 5), else the global median 0.214. Category medians range 0.034–0.482.
- **Growth:** `1 + 0.5 × clamp(change_7d, −30, +60) / 100`; null change counts as 1.
- **Age:** `1 + 0.12 × (1 − exp(−days / 730))`; unknown age counts as 1.
- **Farm plans:** five steps per candidate (setup, core, deepen, maintain, track), each with a per-chain gas cost and a time estimate, varied by the protocol's playbook family (lend, dex, yield, bridge, stake, trade).
- **Dashboard:** dark theme, sort by value / TVL / growth / age / name, search, category and chain filters, watchlist-only toggle, and a detail view per protocol showing the facts, the value-breakdown formula and the five farm steps.

Screenshots are stored in this repository as base64 text (`screenshots/*.b64`, one file per image) so the repository stays text-only; `main.ts` decodes them to PNG in the output.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
