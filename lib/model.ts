// lib/model.ts — the token launch radar's value model and farm plans.
//
// The radar ranks protocols that record no token yet ("pre-token") by an
// implied value: what the protocol's token would be worth if it launched
// one today, judged from the snapshot's own figures. Nothing here names a
// protocol in advance. Every number below is computed from the snapshot
// at run time, so the same program ranks a future snapshot the same way.
//
// The model, in one line:
//   implied = TVL x benchmark x growth x age
// where
//   benchmark = the median market-cap / TVL of the token-bearing
//               protocols in the same category (the cross-category median
//               when a category has fewer than five such comparables),
//   growth    = a capped, damped 7-day TVL change,
//   age       = a saturating bonus for how long the protocol has run
//               with no token (older, stickier TVL counts for more).
//
// Farm plans are built from the same figures: the protocol's category
// picks the playbook, its first chain picks the gas cost, and each step
// states what to do, what it costs and how long it takes.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  // Display fields the dashboard reads (also carried in data.js).
  category: string;
  chains: string[];
  chain: string;
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  benchmark: number;
  benchmark_n: number;
  family: string;
  gas_usd: string;
  on_watchlist: boolean;
}

export interface Benchmark {
  ratio: number;
  n: number;
}

export interface ModelResult {
  rows: BoardRow[];
  globalMedian: number;
  benchmarks: Record<string, Benchmark>;
  asOf: string;
  floorUsd: number;
  preTokenCount: number;
  excludedCount: number;
}

/** A protocol records no token when DefiLlama gives it neither a CoinGecko id nor a ticker. */
export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * The exclusion half of the watchlist's rule, as far as the snapshot's
 * ten fields can check it: a wrapped, staked or bridged product of a
 * token that already trades is not a protocol still waiting on a launch
 * of its own. WBTC is Bitcoin on Ethereum and a staked-ETH product is ETH
 * in a staking wrapper; neither is a launch candidate, however large its
 * TVL. The snapshot carries no parentProtocol field, so that check cannot
 * be applied here; the watchlist itself already applied it.
 */
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_LEAD =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

export function isExcludedProduct(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_LEAD.test(p.name)) return true;
  return false;
}

/** A genuine launch candidate: records no token and is not a wrapped, staked or bridged product of one that trades. */
export function isLaunchCandidate(p: Protocol): boolean {
  return isPreToken(p) && !isExcludedProduct(p);
}

/** Median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Days between two YYYY-MM-DD dates (asOf minus listed). Null when listed is unknown. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const a = Date.parse(asOf + "T00:00:00Z");
  const b = Date.parse(listedAt + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86400000));
}

/**
 * The benchmark ratio per category: the median market-cap / TVL of the
 * token-bearing protocols in that category. A category with fewer than
 * five token-bearing comparables falls back to the cross-category median,
 * so a single outlier protocol cannot set a category's price.
 */
export function categoryBenchmarks(protocols: Protocol[]): {
  globalMedian: number;
  benchmarks: Record<string, Benchmark>;
} {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? "(uncategorised)";
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.169;
  const benchmarks: Record<string, Benchmark> = {};
  for (const [key, list] of byCategory) {
    if (list.length >= 5) {
      benchmarks[key] = { ratio: median(list), n: list.length };
    }
  }
  return { globalMedian, benchmarks };
}

function benchmarkFor(
  category: string | null,
  globalMedian: number,
  benchmarks: Record<string, Benchmark>,
): Benchmark {
  const key = category ?? "(uncategorised)";
  const hit = benchmarks[key];
  if (hit) return hit;
  return { ratio: globalMedian, n: 0 };
}

/**
 * Growth factor from the 7-day TVL change. The change is clamped to
 * [-30%, +60%] and damped by half, so one wild week cannot double a
 * protocol's value and a bad week cannot halve it. No change reported
 * means no adjustment.
 */
export function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  return 1 + 0.5 * (clamp(change7d, -30, 60) / 100);
}

/**
 * Age factor from how long the protocol has run with no token. It rises
 * from 1.00 for a brand-new protocol and saturates near 1.12 after about
 * two years: older, stickier TVL counts for more, but age alone never
 * doubles a value. Unknown listing date means no adjustment.
 */
export function ageFactor(days: number | null): number {
  if (days === null) return 1;
  return 1 + 0.12 * (1 - Math.exp(-days / 730));
}

// ---------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------

/** The playbook family a category belongs to. */
export function familyOf(category: string | null): string {
  const c = category ?? "";
  if (
    c === "Lending" ||
    c === "CDP" ||
    c === "CDP Manager" ||
    c === "Collateral Markets" ||
    c === "Collateral Management" ||
    c === "Uncollateralized Lending" ||
    c === "Leveraged Farming"
  ) return "lend";
  if (c === "Dexs" || c === "Liquidity Manager") return "dex";
  if (
    c === "Yield" ||
    c === "Yield Aggregator" ||
    c === "Farm" ||
    c === "Basis Trading"
  ) return "yield";
  if (
    c === "Bridge" ||
    c === "Cross Chain Bridge" ||
    c === "Canonical Bridge"
  ) return "bridge";
  if (
    c === "Liquid Staking" ||
    c === "Liquid Restaking" ||
    c === "Restaking" ||
    c === "Staking Pool"
  ) return "stake";
  return "trade";
}

/** Rough cost of one simple transaction on a chain, in US dollars. */
export function gasForChain(chain: string): string {
  const table: Record<string, string> = {
    Ethereum: "$3.00",
    Solana: "$0.01",
    Base: "$0.05",
    Arbitrum: "$0.20",
    Optimism: "$0.10",
    Binance: "$0.15",
    Polygon: "$0.05",
    Avalanche: "$0.30",
    Sui: "$0.02",
    Aptos: "$0.02",
    Tron: "$0.50",
    Bitcoin: "$2.00",
    Linea: "$0.10",
    zkSync: "$0.10",
    Scroll: "$0.10",
    Blast: "$0.05",
    Sonic: "$0.05",
    Berachain: "$0.05",
    Unichain: "$0.05",
  };
  return table[chain] ?? "$0.50";
}

/**
 * The step templates. {name}, {chain} and {gas} are filled per protocol.
 * The setup, maintain and track steps are the same for every protocol;
 * the core and deepen steps vary by playbook family. Keeping the text in
 * one table means the board and the dashboard always show the same plan:
 * main.ts writes this table into data.js and the page expands it.
 */
export const STEP_TEMPLATES: {
  setup: string;
  core: Record<string, string>;
  deepen: Record<string, string>;
  maintain: string;
  track: string;
} = {
  setup:
    "Open a {chain} wallet, fund it with gas (about {gas} per transaction on {chain}) and the assets you plan to use, then connect it to {name}. Allow about 15 minutes for setup.",
  core: {
    lend: "Supply assets to {name}'s lending markets on {chain}: deposit a stablecoin or blue-chip collateral, keep borrow usage under 50% so a price dip cannot liquidate you, and leave the position open. Gas about {gas} per action; allow about 20 minutes.",
    dex: "Trade on {name} on {chain} and add liquidity to its most active pool: swap a small amount first to confirm routing, then provide a two-sided position and hold the LP receipt. Gas about {gas} per action; allow about 25 minutes.",
    yield: "Deposit into {name}'s highest-TVL vault or strategy on {chain}, confirm the deposit receipt and the strategy fee, and leave the position to accrue. Gas about {gas} per action; allow about 20 minutes.",
    bridge: "Bridge assets through {name} on {chain}, starting with a small test amount, then move a working amount in each direction the route supports and keep the receipt. Gas about {gas} per action; allow about 20 minutes.",
    stake: "Stake through {name} on {chain} and hold the liquid staking receipt in your wallet; if it offers restaking, opt into one restaking vault with a small share. Gas about {gas} per action; allow about 20 minutes.",
    trade: "Open a small real position in {name}'s core product on {chain}, confirm the position and its fee, and hold the receipt or open position in your wallet. Gas about {gas} per action; allow about 25 minutes.",
  },
  deepen: {
    lend: "Deepen the position once a week: add collateral or repay a little borrow so usage stays under 50%, and use a second market on {name} if it lists one. Each top-up costs about {gas} in gas; about 10 minutes a week.",
    dex: "Return weekly to {name} on {chain}: rebalance the liquidity position if one side drifts past 60%, collect any fees, and keep the position open. Each visit costs about {gas} in gas; about 10 minutes a week.",
    yield: "Check the vault weekly and top it up when the strategy's TVL rises; move a share to a second {name} strategy if one opens. Each top-up costs about {gas} in gas; about 10 minutes a week.",
    bridge: "Bridge a working amount through {name} each week on {chain}, alternating direction when the route supports it, and keep every receipt. Each bridge costs about {gas} in gas; about 10 minutes a week.",
    stake: "Add to the stake monthly and restake any rewards {name} pays on {chain} instead of selling them, so the staked balance compounds. Each action costs about {gas} in gas; about 10 minutes a month.",
    trade: "Revisit the position weekly on {chain}: close or roll it before expiry if it has one, and keep a small open position so activity stays continuous. Each visit costs about {gas} in gas; about 10 minutes a week.",
  },
  maintain:
    "Keep a simple log: the date, the amount, the chain and the transaction hash of every {name} action, so you can prove activity later. Review it weekly; about 5 minutes a week.",
  track:
    "Watch {name}'s TVL, its announcements and any points or rewards page; if it announces a token or a snapshot, claim or register the same day. Withdrawing costs about {gas} in gas; allow about 15 minutes when the time comes.",
};

function fill(template: string, name: string, chain: string, gas: string): string {
  return template
    .split("{name}").join(name)
    .split("{chain}").join(chain)
    .split("{gas}").join(gas);
}

/** Five concrete steps for one protocol: setup, core, deepen, maintain, track. */
export function farmSteps(
  p: Protocol,
  chain: string,
  gas: string,
  family: string,
): string[] {
  const core = STEP_TEMPLATES.core[family] ?? STEP_TEMPLATES.core.trade;
  const deep = STEP_TEMPLATES.deepen[family] ?? STEP_TEMPLATES.deepen.trade;
  return [
    fill(STEP_TEMPLATES.setup, p.name, chain, gas),
    fill(core, p.name, chain, gas),
    fill(deep, p.name, chain, gas),
    fill(STEP_TEMPLATES.maintain, p.name, chain, gas),
    fill(STEP_TEMPLATES.track, p.name, chain, gas),
  ];
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** Build the ranked board: every genuine launch candidate in the snapshot. */
export function buildBoard(snapshot: Snapshot): ModelResult {
  const { globalMedian, benchmarks } = categoryBenchmarks(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const pre = snapshot.protocols.filter(isPreToken);
  const candidates = pre.filter(isLaunchCandidate);

  const scored = candidates.map((p) => {
    const bench = benchmarkFor(p.category, globalMedian, benchmarks);
    const age = ageDays(p.listed_at, snapshot.as_of);
    const implied = Math.max(
      1,
      Math.round(
        p.tvl_usd * bench.ratio * growthFactor(p.change_7d) * ageFactor(age),
      ),
    );
    const chain = p.chains.length > 0 ? p.chains[0] : "Ethereum";
    const family = familyOf(p.category);
    const gas = gasForChain(chain);
    return { p, bench, age, implied, chain, family, gas };
  });

  // Rank by implied value, then TVL, then slug: fully deterministic.
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    if (b.p.tvl_usd !== a.p.tvl_usd) return b.p.tvl_usd - a.p.tvl_usd;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });

  const rows: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, s.chain, s.gas, s.family),
    category: s.p.category ?? "(uncategorised)",
    chains: s.p.chains,
    chain: s.chain,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    benchmark: s.bench.ratio,
    benchmark_n: s.bench.n,
    family: s.family,
    gas_usd: s.gas,
    on_watchlist: watch.has(s.p.slug),
  }));

  return {
    rows,
    globalMedian,
    benchmarks,
    asOf: snapshot.as_of,
    floorUsd: snapshot.floor_usd,
    preTokenCount: pre.length,
    excludedCount: pre.length - candidates.length,
  };
}
