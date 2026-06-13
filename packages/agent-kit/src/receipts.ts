import { createHash } from "crypto";
import { Keypair } from "@stellar/stellar-sdk";
import type {
  OrchestratorReport,
  RunReceipt,
  RunReceiptAgent,
  RunReceiptVerification,
} from "./types.js";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function normalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  return String(value);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function unsignedReceipt(receipt: RunReceipt): Omit<RunReceipt, "receiptHash" | "signature"> {
  const { receiptHash: _receiptHash, signature: _signature, ...rest } = receipt;
  return rest;
}

export function computeReceiptHash(
  receipt: Omit<RunReceipt, "receiptHash"> | RunReceipt
): string {
  const comparable =
    "receiptHash" in receipt ? unsignedReceipt(receipt as RunReceipt) : receipt;
  return sha256Hex(comparable);
}

export function createRunReceipt(params: {
  report: OrchestratorReport;
  runId: string;
  taskId?: string;
  createdAt?: string;
  completedAt?: string;
  shieldContractId?: string;
  registryContractId?: string;
  network?: string;
}): RunReceipt {
  const { report } = params;
  const agentIds = Array.from(
    new Set([
      ...Object.keys(report.wallets),
      ...Object.keys(report.spent),
      ...Object.keys(report.reputation),
      ...Object.keys(report.txHashes),
    ])
  ).sort();

  const agents: RunReceiptAgent[] = agentIds.map((agentId) => ({
    agentId,
    walletAddress: report.wallets[agentId] ?? "",
    spentStroops: Number(report.spent[agentId] ?? 0),
    reputation: Number(report.reputation[agentId] ?? 0),
    txHashes: report.txHashes[agentId] ?? [],
  }));

  const txHashes = agents.flatMap((agent) => agent.txHashes).sort();
  const totalSpentStroops = agents.reduce(
    (sum, agent) => sum + agent.spentStroops,
    0
  );

  const receiptWithoutHash: Omit<RunReceipt, "receiptHash"> = {
    version: "calagent.receipt.v1",
    runId: params.runId,
    taskId: params.taskId,
    task: report.task,
    taskHash: sha256Hex(report.task),
    outputHash: sha256Hex(report.report),
    createdAt: params.createdAt ?? report.timestamp,
    completedAt: params.completedAt ?? report.timestamp,
    agents,
    policy: {
      shieldContractId: params.shieldContractId,
      registryContractId: params.registryContractId,
      network: params.network ?? "stellar:testnet",
    },
    totalSpentStroops,
    txHashes,
  };

  return {
    ...receiptWithoutHash,
    receiptHash: computeReceiptHash(receiptWithoutHash),
  };
}

export function signRunReceipt(
  receipt: RunReceipt,
  keypair: Keypair
): RunReceipt {
  const receiptHash = computeReceiptHash(receipt);
  const signature = keypair.sign(Buffer.from(receiptHash, "utf8")).toString("hex");

  return {
    ...receipt,
    receiptHash,
    signature: {
      signer: keypair.publicKey(),
      signature,
      algorithm: "stellar-ed25519",
    },
  };
}

export function verifyRunReceipt(
  receipt: RunReceipt,
  options: { output?: string } = {}
): RunReceiptVerification {
  const errors: string[] = [];
  const taskHashValid = receipt.taskHash === sha256Hex(receipt.task);
  const receiptHashValid = receipt.receiptHash === computeReceiptHash(receipt);

  if (!taskHashValid) errors.push("taskHash does not match task");
  if (!receiptHashValid) errors.push("receiptHash does not match receipt");

  const outputHashValid =
    options.output !== undefined
      ? receipt.outputHash === sha256Hex(options.output)
      : /^[a-f0-9]{64}$/i.test(receipt.outputHash);
  if (!outputHashValid) {
    errors.push(
      options.output !== undefined
        ? "outputHash does not match output"
        : "outputHash is not a valid sha256 hex hash"
    );
  }

  let signatureValid: boolean | undefined;
  if (receipt.signature) {
    try {
      const signer = Keypair.fromPublicKey(receipt.signature.signer);
      signatureValid = signer.verify(
        Buffer.from(receipt.receiptHash, "utf8"),
        Buffer.from(receipt.signature.signature, "hex")
      );
      if (!signatureValid) errors.push("signature does not verify");
    } catch {
      signatureValid = false;
      errors.push("signature could not be verified");
    }
  }

  return {
    valid:
      taskHashValid &&
      outputHashValid &&
      receiptHashValid &&
      (signatureValid ?? true),
    receiptHashValid,
    taskHashValid,
    outputHashValid,
    signatureValid,
    errors,
  };
}
