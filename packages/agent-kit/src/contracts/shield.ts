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
