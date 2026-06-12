import {
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  scValToNative,
  xdr,
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
 * Thin wrapper around the Aegis Identity Registry Contract.
 *
 * The Identity Registry tracks each agent's on-chain reputation.
 * Call `recordSuccess` after a successful run and `recordFailure` after
 * an error to keep reputation scores current.
 */
export class IdentityRegistry {
  constructor(
    private readonly contractId: string,
    private readonly rpc: SorobanRpc.Server,
    private readonly adminKeypair: Keypair
  ) {}

  /**
   * Register a new agent.
   * Silently ignores AlreadyRegistered errors so re-runs are safe.
   */
  async registerAgent(
    agentId: string,
    name: string,
    capability: string
  ): Promise<void> {
    const horizon = getHorizonServer();
    const acct = await horizon.loadAccount(this.adminKeypair.publicKey());
    const contract = new Contract(this.contractId);
    const capName = capability.charAt(0).toUpperCase() + capability.slice(1);
    const capScVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(capName)]);
    const tx = new TransactionBuilder(acct, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call(
          "register_agent",
          nativeToScVal(agentId, { type: "symbol" }),
          nativeToScVal(name, { type: "string" }),
          capScVal
        )
      )
      .setTimeout(30)
      .build();
    await sorobanInvoke(this.rpc, tx, this.adminKeypair).catch((err) => {
      if (!String(err).includes("AlreadyRegistered")) throw err;
    });
  }

  /** Increment this agent's on-chain reputation score after a successful task. */
  async recordSuccess(agentId: string, agentKeypair: Keypair): Promise<string | null> {
    try {
      const horizon = getHorizonServer();
      const acct = await horizon.loadAccount(agentKeypair.publicKey());
      const contract = new Contract(this.contractId);
      const tx = new TransactionBuilder(acct, {
        fee: BASE_FEE,
        networkPassphrase: networkPassphrase(),
      })
        .addOperation(
          contract.call("record_success", nativeToScVal(agentId, { type: "symbol" }))
        )
        .setTimeout(30)
        .build();
      const sim = await this.rpc.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) return null;
      const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
      prepared.sign(agentKeypair);
      const sent = await this.rpc.sendTransaction(prepared);
      return sent.status !== "ERROR" ? sent.hash : null;
    } catch {
      return null;
    }
  }

  /**
   * Read the on-chain reputation score for an agent via Soroban simulation.
   * Returns null if the agent isn't registered or the call fails.
   */
  async getReputation(agentId: string): Promise<number | null> {
    try {
      const horizon = getHorizonServer();
      const acct = await horizon.loadAccount(this.adminKeypair.publicKey());
      const contract = new Contract(this.contractId);
      const tx = new TransactionBuilder(acct, {
        fee: BASE_FEE,
        networkPassphrase: networkPassphrase(),
      })
        .addOperation(
          contract.call("get_reputation", nativeToScVal(agentId, { type: "symbol" }))
        )
        .setTimeout(30)
        .build();
      const sim = await this.rpc.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result) {
        return scValToNative(sim.result.retval) as number;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Store the canonical manifest hash for an already-registered agent. */
  async setManifestHash(agentId: string, manifestHash: string): Promise<string | null> {
    try {
      const horizon = getHorizonServer();
      const acct = await horizon.loadAccount(this.adminKeypair.publicKey());
      const contract = new Contract(this.contractId);
      const tx = new TransactionBuilder(acct, {
        fee: BASE_FEE,
        networkPassphrase: networkPassphrase(),
      })
        .addOperation(
          contract.call(
            "set_manifest_hash",
            nativeToScVal(agentId, { type: "symbol" }),
            nativeToScVal(manifestHash, { type: "string" })
          )
        )
        .setTimeout(30)
        .build();
      const sim = await this.rpc.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) return null;
      const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
      prepared.sign(this.adminKeypair);
      const sent = await this.rpc.sendTransaction(prepared);
      return sent.status !== "ERROR" ? sent.hash : null;
    } catch {
      return null;
    }
  }

  /** Read the canonical manifest hash for an agent via Soroban simulation. */
  async getManifestHash(agentId: string): Promise<string | null> {
    try {
      const horizon = getHorizonServer();
      const acct = await horizon.loadAccount(this.adminKeypair.publicKey());
      const contract = new Contract(this.contractId);
      const tx = new TransactionBuilder(acct, {
        fee: BASE_FEE,
        networkPassphrase: networkPassphrase(),
      })
        .addOperation(
          contract.call("get_manifest_hash", nativeToScVal(agentId, { type: "symbol" }))
        )
        .setTimeout(30)
        .build();
      const sim = await this.rpc.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result) {
        return scValToNative(sim.result.retval) as string;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Decrement this agent's on-chain reputation score after a failed task. */
  async recordFailure(agentId: string, agentKeypair: Keypair): Promise<void> {
    try {
      const horizon = getHorizonServer();
      const acct = await horizon.loadAccount(agentKeypair.publicKey());
      const contract = new Contract(this.contractId);
      const tx = new TransactionBuilder(acct, {
        fee: BASE_FEE,
        networkPassphrase: networkPassphrase(),
      })
        .addOperation(
          contract.call("record_failure", nativeToScVal(agentId, { type: "symbol" }))
        )
        .setTimeout(30)
        .build();
      const sim = await this.rpc.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) return;
      const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
      prepared.sign(agentKeypair);
      await this.rpc.sendTransaction(prepared);
    } catch {
      // non-fatal
    }
  }
}
