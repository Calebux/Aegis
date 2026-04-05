/**
 * GET /api/status
 *
 * Returns live wallet balances, spend, and reputation for all agents.
 * The dashboard polls this endpoint via SWR.
 *
 * TODO: connect to Horizon API and Soroban contracts to return real data.
 */

import { NextResponse } from "next/server";
import type { WalletBalance } from "@aegis/shared";

export const dynamic = "force-dynamic";

// Stub data — replace with real Horizon + contract queries
const STUB_BALANCES: WalletBalance[] = [
  {
    agentId: "scout",
    publicKey: "GABC…SCOUT",
    xlmBalance: "10000.0000000",
    spentStroops: 250_000n,
    capStroops: 1_000_000n,
    reputationBps: 5_250,
  },
  {
    agentId: "ledger",
    publicKey: "GDEF…LEDGER",
    xlmBalance: "10000.0000000",
    spentStroops: 100_000n,
    capStroops: 500_000n,
    reputationBps: 6_000,
  },
  {
    agentId: "signal",
    publicKey: "GHIJ…SIGNAL",
    xlmBalance: "10000.0000000",
    spentStroops: 0n,
    capStroops: 750_000n,
    reputationBps: 5_000,
  },
  {
    agentId: "scribe",
    publicKey: "GKLM…SCRIBE",
    xlmBalance: "10000.0000000",
    spentStroops: 0n,
    capStroops: 2_000_000n,
    reputationBps: 5_000,
  },
];

export async function GET() {
  // Serialise BigInt as string for JSON transport
  const payload = STUB_BALANCES.map((b) => ({
    ...b,
    spentStroops: b.spentStroops.toString(),
    capStroops: b.capStroops.toString(),
  }));
  return NextResponse.json(payload);
}
