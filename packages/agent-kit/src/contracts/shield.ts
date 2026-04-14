import {
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";
import { getHorizonServer } from "@aegis/shared";
import { sorobanInvoke } from "./utils.js";

function networkPassphrase(): string {
  const net = process.env.STELLAR_NETWORK ?? "testnet";
  if (net === "futurenet") return Networks.FUTURENET;
  if (net === "testnet") return Networks.TESTNET;
  return Networks.PUBLIC;
}

/**
 * Thin wrapper around the Aegis Shield Contract.
 *
 * The Shield Contract enforces per-agent XLM spend caps on Soroban.
 * Register each agent before it runs; the contract will reject any spend
 * that exceeds the cap.
 */
export class ShieldContract {
  constructor(
    private readonly contractId: string,
    private readonly rpc: SorobanRpc.Server,
    private readonly adminKeypair: Keypair
  ) {}

  /**
   * Authorize a spend of `amountStroops` for `agentId`.
   * The contract increments the agent's `total_spent` and rejects if the cap
   * would be exceeded. Call this before every real Stellar payment.
   *
   * @returns true on success; throws if cap exceeded, agent inactive, or not found.
   */
  async authorizeSpend(agentId: string, amountStroops: bigint): Promise<boolean> {
    const horizon = getHorizonServer();
    const acct = await horizon.loadAccount(this.adminKeypair.publicKey());
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(acct, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call(
          "authorize_spend",
          nativeToScVal(agentId, { type: "string" }),
          nativeToScVal(amountStroops, { type: "i128" })
        )
      )
      .setTimeout(30)
      .build();
    await sorobanInvoke(this.rpc, tx, this.adminKeypair);
    return true;
  }

  /**
   * Store an agent output signature on-chain (Upgrade 7).
   * Enables off-chain verifiers to confirm agent output provenance.
   * Uses a single "{agentId}:{runId}" key to avoid tuple XDR issues.
   * Must be called with the admin keypair (admin-gated on-chain).
   */
  async storeSignature(params: {
    agentId: string;
    runId: string;
    signature: string;
    payloadHash: string;
  }): Promise<string> {
    const horizon = getHorizonServer();
    const acct = await horizon.loadAccount(this.adminKeypair.publicKey());
    const contract = new Contract(this.contractId);
    const sigKey = `${params.agentId}:${params.runId}`;
    const tx = new TransactionBuilder(acct, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call(
          "store_signature",
          nativeToScVal(sigKey, { type: "string" }),
          nativeToScVal(params.signature, { type: "string" }),
          nativeToScVal(params.payloadHash, { type: "string" })
        )
      )
      .setTimeout(30)
      .build();
    return sorobanInvoke(this.rpc, tx, this.adminKeypair);
  }

  /**
   * Register an agent with a spend cap.
   * @param agentId    Unique string identifier for the agent
   * @param agentKeypair  The agent's Stellar keypair
   * @param spendCapStroops  Maximum spend in stroops (1 XLM = 10_000_000)
   */
  async registerAgent(
    agentId: string,
    agentKeypair: Keypair,
    spendCapStroops: bigint
  ): Promise<void> {
    const horizon = getHorizonServer();
    const acct = await horizon.loadAccount(this.adminKeypair.publicKey());
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(acct, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call(
          "register_agent",
          nativeToScVal(agentId, { type: "string" }),
          new Address(agentKeypair.publicKey()).toScVal(),
          nativeToScVal(spendCapStroops, { type: "i128" })
        )
      )
      .setTimeout(30)
      .build();
    await sorobanInvoke(this.rpc, tx, this.adminKeypair);
  }
}
