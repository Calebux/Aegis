/**
 * Ledger Agent
 *
 * Queries on-chain Stellar data via the Horizon API, exposed behind
 * a local x402-gated endpoint. Spend is enforced by the Shield Contract.
 */

import { keypairFromSecret, getHorizonServer } from "@aegis/shared";

interface LedgerResult {
  result: string;
  spentStroops: bigint;
}

export class LedgerAgent {
  private readonly keypair: ReturnType<typeof keypairFromSecret> | null;

  constructor() {
    const secret = process.env.LEDGER_SECRET_KEY;
    this.keypair = secret ? keypairFromSecret(secret) : null;
  }

  async run(instruction: string): Promise<LedgerResult> {
    console.log("[ledger] Running:", instruction);

    // TODO: check spend cap via Shield Contract before proceeding
    // TODO: parse instruction to determine which Horizon endpoint to query
    //   e.g. ledger stats, account info, transaction history, offers, etc.
    // TODO: wrap Horizon call behind local x402 endpoint
    //   const server = getHorizonServer();
    //   const ledgerStats = await server.ledgers().order("desc").limit(1).call();
    // TODO: format and return relevant on-chain data

    const _server = getHorizonServer(); // placeholder reference to avoid unused import

    return {
      result: `[ledger stub] On-chain data for: "${instruction}"`,
      spentStroops: 0n,
    };
  }
}
