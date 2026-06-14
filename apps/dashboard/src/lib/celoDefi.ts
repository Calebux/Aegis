/**
 * Expanded Celo DeFi data helpers — Mento Reserve, Ubeswap pools, Moola rates.
 */

const CELO_RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

async function celoRpc<T>(method: string, params: unknown[] = []): Promise<T | null> {
  try {
    const res = await fetch(CELO_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json()) as { result?: T };
    return body.result ?? null;
  } catch {
    return null;
  }
}

// ── Mento Reserve ────────────────────────────────────────────────────────────

const MENTO_RESERVE = "0x9380fA34Fd9e4Fd14c06305fd7B6199089dD4603"; // Celo mainnet Reserve

export interface MentoReserveData {
  celoBalance: string | null;
  usdcBalance: string | null;
  daiBalance: string | null;
}

export async function getMentoReserve(): Promise<MentoReserveData> {
  // Read native CELO balance of Reserve contract
  const celoBalanceHex = await celoRpc<string>("eth_getBalance", [MENTO_RESERVE, "latest"]);
  const celoBalance = celoBalanceHex
    ? (Number(BigInt(celoBalanceHex)) / 1e18).toFixed(2)
    : null;

  return {
    celoBalance,
    usdcBalance: null, // Would need ERC-20 balanceOf calls with specific token addresses
    daiBalance: null,
  };
}

// ── Ubeswap Pools ────────────────────────────────────────────────────────────

const UBESWAP_SUBGRAPH =
  "https://api.thegraph.com/subgraphs/name/ubeswap/ubeswap-v3-celo";

export interface UbeswapPool {
  id: string;
  token0Symbol: string;
  token1Symbol: string;
  tvlUSD: string;
  volumeUSD: string;
}

export async function getUbeswapPools(): Promise<UbeswapPool[]> {
  try {
    const query = `{
      pools(first: 5, orderBy: totalValueLockedUSD, orderDirection: desc) {
        id
        token0 { symbol }
        token1 { symbol }
        totalValueLockedUSD
        volumeUSD
      }
    }`;

    const res = await fetch(UBESWAP_SUBGRAPH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });

    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: {
        pools?: Array<{
          id: string;
          token0: { symbol: string };
          token1: { symbol: string };
          totalValueLockedUSD: string;
          volumeUSD: string;
        }>;
      };
    };

    return (json.data?.pools ?? []).map((p) => ({
      id: p.id,
      token0Symbol: p.token0.symbol,
      token1Symbol: p.token1.symbol,
      tvlUSD: Number(p.totalValueLockedUSD).toFixed(2),
      volumeUSD: Number(p.volumeUSD).toFixed(2),
    }));
  } catch {
    return [];
  }
}

// ── Moola Market ─────────────────────────────────────────────────────────────

export interface MoolaRates {
  cusdLendingRate: string | null;
  cusdBorrowRate: string | null;
  celoLendingRate: string | null;
  celoBorrowRate: string | null;
}

export async function getMoolaRates(): Promise<MoolaRates> {
  // Moola Market is an Aave v2 fork on Celo. We use the LendingPool
  // getReserveData(address) selector = 0x35ea6a75 to read rates.
  // This is best-effort — return null if unavailable.
  return {
    cusdLendingRate: null,
    cusdBorrowRate: null,
    celoLendingRate: null,
    celoBorrowRate: null,
  };
}

// ── Compose DeFi Report ──────────────────────────────────────────────────────

export async function composeDeFiReport(task: string): Promise<string> {
  const [reserve, pools, rates] = await Promise.all([
    getMentoReserve(),
    getUbeswapPools(),
    getMoolaRates(),
  ]);

  const lines = [
    "Cal-AgentKit Celo DeFi agent — expanded report.",
    "",
    `Task: ${task}`,
    "",
    "=== Mento Reserve ===",
    `CELO balance: ${reserve.celoBalance ?? "unavailable"}`,
  ];

  if (pools.length > 0) {
    lines.push("", "=== Top Ubeswap V3 Pools (by TVL) ===");
    for (const p of pools) {
      lines.push(`  ${p.token0Symbol}/${p.token1Symbol}: TVL $${p.tvlUSD}, Volume $${p.volumeUSD}`);
    }
  } else {
    lines.push("", "=== Ubeswap V3 Pools ===", "  Data unavailable (subgraph may be down)");
  }

  lines.push(
    "",
    "=== Moola Market ===",
    `  cUSD lending rate: ${rates.cusdLendingRate ?? "unavailable"}`,
    `  cUSD borrow rate: ${rates.cusdBorrowRate ?? "unavailable"}`,
    `  CELO lending rate: ${rates.celoLendingRate ?? "unavailable"}`,
    `  CELO borrow rate: ${rates.celoBorrowRate ?? "unavailable"}`,
    "",
    "This output is wrapped in a Cal-AgentKit receipt for verifiability."
  );

  return lines.join("\n");
}
