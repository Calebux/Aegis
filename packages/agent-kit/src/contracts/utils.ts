import { Keypair, SorobanRpc, Transaction } from "@stellar/stellar-sdk";

/**
 * Simulate → assemble → sign → submit → poll a Soroban transaction.
 * Throws if simulation fails, submission fails, or the tx times out.
 */
export async function sorobanInvoke(
  rpc: SorobanRpc.Server,
  tx: Transaction,
  signer: Keypair
): Promise<string> {
  const sim = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
  prepared.sign(signer);
  const sent = await rpc.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`Submit failed: ${JSON.stringify(sent.errorResult)}`);
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await rpc.getTransaction(sent.hash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(status)}`);
    }
  }
  throw new Error(`Transaction timed out: ${sent.hash}`);
}
