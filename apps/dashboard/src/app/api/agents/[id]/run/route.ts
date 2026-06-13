import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";
import {
  CALAGENT_CELO_REGISTRY_ABI,
  createCeloClients,
} from "@calebux/calagent-chain-celo";
import {
  createRunReceipt,
  computeReceiptHash,
  signRunReceipt,
  type OrchestratorReport,
  type RunReceipt,
} from "@calebux/agent-kit";
import { buildAgentManifests, findPeerForAgent } from "@/lib/agentRegistry";
import { routeToPeer, getHopCount } from "@calebux/agent-kit";
import {
  buildStellarX402Requirement,
  facilitatorUrl,
  paymentRequiredResponse,
  verifyAndSettleX402Payment,
  x402Enforced,
} from "@/lib/stellarX402";
import {
  CELO_CHAIN,
  CELO_NETWORK_ID,
  CELO_RPC_URL,
  CELO_STABLE_ASSET,
  CELO_STABLE_ASSET_CONTRACT,
  celoAmountToBaseUnits,
  celoFacilitatorUrl,
  celoPaymentReceiver,
  celoX402Enforced,
} from "@/lib/celoX402";
import {
  persistReceiptOutputs,
  persistReceipts,
  receiptOutputs,
  receipts,
} from "@/lib/taskStore";
import {
  validateTaskInput,
  checkRateLimit,
  getClientIp,
} from "@/lib/validation";
import { isSelfVerified, selfEnforced } from "@calebux/agent-kit";

export const dynamic = "force-dynamic";

type RunBody = {
  task?: string;
};

function agentOutput(agentId: string, task: string): string {
  return [
    `Cal-AgentKit external agent "${agentId}" accepted the task.`,
    "",
    `Task: ${task}`,
    "",
    "This response is wrapped in an Cal-AgentKit run receipt so callers can verify the task hash, output hash, and optional Stellar Ed25519 signature.",
  ].join("\n");
}

type HorizonLedger = {
  sequence: number;
  hash: string;
  closed_at: string;
  base_fee_in_stroops: number;
  successful_transaction_count: number;
  failed_transaction_count: number;
  operation_count: number;
};

type HorizonAccount = {
  account_id: string;
  sequence: string;
  balances: Array<{
    balance: string;
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }>;
};

async function horizonJson<T>(path: string): Promise<T | null> {
  const base =
    process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function ledgerOutput(task: string, walletAddress: string): Promise<string> {
  const latestLedger = await horizonJson<HorizonLedger>(
    "/ledgers?order=desc&limit=1"
  );
  const account =
    walletAddress.length > 0
      ? await horizonJson<HorizonAccount>(
          `/accounts/${encodeURIComponent(walletAddress)}`
        )
      : null;

  const ledger = Array.isArray(
    (latestLedger as unknown as { _embedded?: { records?: unknown[] } })
      ?._embedded?.records
  )
    ? ((latestLedger as unknown as { _embedded: { records: HorizonLedger[] } })
        ._embedded.records[0] ?? null)
    : latestLedger;

  const lines = [
    "Cal-AgentKit Ledger agent completed a live Stellar network read.",
    "",
    `Task: ${task}`,
  ];

  if (ledger) {
    lines.push(
      "",
      `Latest ledger: #${ledger.sequence}`,
      `Closed at: ${ledger.closed_at}`,
      `Base fee: ${ledger.base_fee_in_stroops} stroops`,
      `Transactions: ${ledger.successful_transaction_count} successful, ${ledger.failed_transaction_count} failed`,
      `Operations: ${ledger.operation_count}`
    );
  } else {
    lines.push("", "Latest ledger: unavailable from Horizon");
  }

  if (account) {
    const balances = account.balances
      .map((balance) => {
        const asset =
          balance.asset_type === "native"
            ? "XLM"
            : `${balance.asset_code ?? "asset"}:${balance.asset_issuer ?? ""}`;
        return `${balance.balance} ${asset}`;
      })
      .join(", ");
    lines.push("", `Account: ${account.account_id}`, `Balances: ${balances}`);
  }

  lines.push(
    "",
    "The output is wrapped in a Cal-AgentKit receipt so callers can verify task hash, output hash, payment settlement, and optional Stellar Ed25519 signature."
  );

  return lines.join("\n");
}

async function celoRpc<T>(method: string, params: unknown[] = []): Promise<T | null> {
  try {
    const res = await fetch(CELO_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
      cache: "no-store",
    });
    const body = (await res.json()) as { result?: T };
    return body.result ?? null;
  } catch {
    return null;
  }
}

/** ABI-encode a single `string` argument call (offset + length + data). */
function abiEncodeStringCall(selector: string, value: string): string {
  const enc = Buffer.from(value, "utf8");
  const offset = "0000000000000000000000000000000000000000000000000000000000000020";
  const length = enc.length.toString(16).padStart(64, "0");
  const dataHex = enc.toString("hex").padEnd(Math.ceil(enc.length / 32) * 64, "0");
  return `0x${selector}${offset}${length}${dataHex}`;
}

function decodeBytes32(hex: string): string {
  return hex.startsWith("0x") ? hex : `0x${hex}`;
}

type NotaryResult = { output: string; attestationTxHash?: string };

async function celoNotaryRun(task: string, runId: string): Promise<NotaryResult> {
  const registryAddress = process.env.CELO_REGISTRY_ADDRESS;
  const deployerKey = process.env.CELO_DEPLOYER_PRIVATE_KEY;

  if (!registryAddress) {
    return {
      output: [
        "Cal-AgentKit Celo Notary agent: CELO_REGISTRY_ADDRESS not configured.",
        "",
        `Task: ${task}`,
      ].join("\n"),
    };
  }

  // Hash task + runId → bytes32 payload hash to attest on-chain
  const payloadHash = `0x${createHash("sha256")
    .update(`${runId}:${task}`)
    .digest("hex")}` as `0x${string}`;

  const [ledgerHashHex, notaryHashHex, blockNumberHex] = await Promise.all([
    celoRpc<string>("eth_call", [
      { to: registryAddress, data: abiEncodeStringCall("3a35d96b", "celo-ledger") },
      "latest",
    ]),
    celoRpc<string>("eth_call", [
      { to: registryAddress, data: abiEncodeStringCall("3a35d96b", "celo-notary") },
      "latest",
    ]),
    celoRpc<string>("eth_blockNumber"),
  ]);

  const blockNumber = blockNumberHex ? Number.parseInt(blockNumberHex, 16) : null;

  // Write attestation on-chain if deployer key is available
  let attestationTxHash: string | undefined;
  if (deployerKey) {
    try {
      const { walletClient, publicClient, account } = createCeloClients({
        privateKey: deployerKey as `0x${string}`,
        rpcUrl: CELO_RPC_URL,
        network: CELO_NETWORK_ID,
      });
      const txHash = await walletClient.writeContract({
        address: registryAddress as `0x${string}`,
        abi: CALAGENT_CELO_REGISTRY_ABI,
        functionName: "setManifestHash",
        args: ["celo-notary", payloadHash],
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      attestationTxHash = txHash;

      // Record the successful run in the registry (reputation +10, non-fatal)
      walletClient.writeContract({
        address: registryAddress as `0x${string}`,
        abi: CALAGENT_CELO_REGISTRY_ABI,
        functionName: "recordSuccess",
        args: ["celo-notary"],
        account,
      }).catch((err: unknown) => {
        console.warn("[celo-notary] recordSuccess failed:", err);
      });
    } catch (err) {
      console.warn("[celo-notary] on-chain write failed:", err);
    }
  }

  const output = [
    "Cal-AgentKit Celo Notary agent completed a live on-chain attestation.",
    "",
    `Task: ${task}`,
    "",
    `Network: ${CELO_NETWORK_ID}`,
    `Registry contract: ${registryAddress}`,
    `Policy contract: ${process.env.CELO_POLICY_ADDRESS ?? "not set"}`,
    `Block: ${blockNumber ?? "unavailable"}`,
    "",
    `Payload hash (SHA-256 of runId:task): ${payloadHash}`,
    attestationTxHash
      ? `Attestation tx: ${attestationTxHash}`
      : deployerKey
        ? "Attestation: write failed (check logs)"
        : "Attestation: CELO_DEPLOYER_PRIVATE_KEY not set — read-only mode",
    "",
    "Existing on-chain manifest hashes (from AegisCeloRegistry):",
    `  celo-ledger:  ${ledgerHashHex ? decodeBytes32(ledgerHashHex) : "not registered"}`,
    `  celo-notary:  ${notaryHashHex ? decodeBytes32(notaryHashHex) : "not registered"}`,
    "",
    "This proves the Cal-AgentKit identity registry is live on Celo mainnet with permanently attested, updatable payload hashes.",
  ].join("\n");

  return { output, attestationTxHash };
}

async function celoPriceOutput(task: string): Promise<string> {
  let celoUsdRate = 0;
  let celoMarketCap = 0;
  let celoVol24h = 0;

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true",
      { signal: AbortSignal.timeout(5_000), cache: "no-store" }
    );
    if (res.ok) {
      const json = (await res.json()) as {
        celo?: { usd?: number; usd_market_cap?: number; usd_24h_vol?: number };
      };
      celoUsdRate = json.celo?.usd ?? 0;
      celoMarketCap = json.celo?.usd_market_cap ?? 0;
      celoVol24h = json.celo?.usd_24h_vol ?? 0;
    }
  } catch {
    // non-fatal
  }

  return [
    "Cal-AgentKit Celo Price agent fetched live CELO market data.",
    "",
    `Task: ${task}`,
    "",
    `Network: ${CELO_NETWORK_ID}`,
    `CELO/USD: ${celoUsdRate > 0 ? `$${celoUsdRate.toFixed(4)}` : "unavailable"}`,
    `Market cap: ${celoMarketCap > 0 ? `$${(celoMarketCap / 1e6).toFixed(2)}M` : "unavailable"}`,
    `24h volume: ${celoVol24h > 0 ? `$${(celoVol24h / 1e6).toFixed(2)}M` : "unavailable"}`,
    "",
    "Price data sourced from CoinGecko public API. Wrapped in a Cal-AgentKit receipt for verifiability.",
  ].join("\n");
}

async function celoDefiOutput(task: string): Promise<string> {
  // Read Mento SortedOracles rates via direct eth_call (selector for getRate(bytes32))
  const MENTO_ORACLE = "0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33"; // Celo mainnet SortedOracles

  async function getOracleRate(currencyId: string): Promise<number | null> {
    // SortedOracles.medianRate(address) selector: 0xef90e1b0
    // We use a known proxy approach via direct RPC
    try {
      const res = await fetch(CELO_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            {
              to: MENTO_ORACLE,
              // medianRate(address) = 0xef90e1b0
              data: `0xef90e1b0${currencyId.slice(2).padStart(64, "0")}`,
            },
            "latest",
          ],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await res.json()) as { result?: string };
      if (!body.result || body.result === "0x") return null;
      // Returns (uint256 numerator, uint256 denominator)
      const num = BigInt("0x" + body.result.slice(2, 66));
      const den = BigInt("0x" + body.result.slice(66, 130));
      if (den === 0n) return null;
      return Number(num) / Number(den);
    } catch {
      return null;
    }
  }

  const CUSD_ADDRESS = CELO_STABLE_ASSET_CONTRACT;
  const CEUR_ADDRESS = "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73";
  const CREAL_ADDRESS = "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787";

  const [cusdRate, ceurRate, crealRate] = await Promise.all([
    getOracleRate(CUSD_ADDRESS),
    getOracleRate(CEUR_ADDRESS),
    getOracleRate(CREAL_ADDRESS),
  ]);

  // Fallback to CoinGecko for additional rates
  let celoUsd = 0;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=celo,celo-dollar&vs_currencies=usd",
      { signal: AbortSignal.timeout(4_000), cache: "no-store" }
    );
    if (res.ok) {
      const json = (await res.json()) as { celo?: { usd?: number }; "celo-dollar"?: { usd?: number } };
      celoUsd = json.celo?.usd ?? 0;
    }
  } catch {
    // non-fatal
  }

  return [
    "Cal-AgentKit Celo DeFi agent fetched live Mento oracle rates.",
    "",
    `Task: ${task}`,
    "",
    `Network: ${CELO_NETWORK_ID}`,
    `SortedOracles contract: ${MENTO_ORACLE}`,
    "",
    "Exchange rates (Mento SortedOracles):",
    `  cUSD/CELO:  ${cusdRate != null ? cusdRate.toFixed(6) : "unavailable"}`,
    `  cEUR/CELO:  ${ceurRate != null ? ceurRate.toFixed(6) : "unavailable"}`,
    `  cREAL/CELO: ${crealRate != null ? crealRate.toFixed(6) : "unavailable"}`,
    `  CELO/USD (CoinGecko): ${celoUsd > 0 ? `$${celoUsd.toFixed(4)}` : "unavailable"}`,
    "",
    "Settlement asset: cUSD (ERC-20 stablecoin on Celo)",
    `Settlement asset contract: ${CELO_STABLE_ASSET_CONTRACT}`,
    "",
    "This output is wrapped in a Cal-AgentKit receipt enabling verifiable on-chain attestation.",
  ].join("\n");
}

async function celoLedgerOutput(task: string): Promise<string> {
  const [blockNumberHex, gasPriceHex, chainIdHex] = await Promise.all([
    celoRpc<string>("eth_blockNumber"),
    celoRpc<string>("eth_gasPrice"),
    celoRpc<string>("eth_chainId"),
  ]);

  const blockNumber = blockNumberHex ? Number.parseInt(blockNumberHex, 16) : null;
  const gasPriceWei = gasPriceHex ? BigInt(gasPriceHex).toString() : null;
  const chainId = chainIdHex ? Number.parseInt(chainIdHex, 16) : null;

  return [
    "Cal-AgentKit Celo Ledger agent completed a live Celo RPC read.",
    "",
    `Task: ${task}`,
    "",
    `Network: ${CELO_NETWORK_ID}`,
    `RPC chain ID: ${chainId ?? "unavailable"}`,
    `Latest block: ${blockNumber ?? "unavailable"}`,
    `Gas price wei: ${gasPriceWei ?? "unavailable"}`,
    `Settlement asset: ${CELO_STABLE_ASSET}`,
    `Settlement asset contract: ${CELO_STABLE_ASSET_CONTRACT}`,
    "",
    "This proves the same Cal-AgentKit discovery, x402, receipt, and verification layer can target Celo's EVM stablecoin rail.",
  ].join("\n");
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const agent = buildAgentManifests().find((candidate) => candidate.id === id);

  if (!agent) {
    // Federation fallback: check if a peer instance hosts this agent
    const peerUrl = await findPeerForAgent(id);
    if (peerUrl) {
      const hopCount = getHopCount(Object.fromEntries(req.headers.entries()));
      const forwardHeaders: Record<string, string> = {};
      const paymentSig =
        req.headers.get("PAYMENT-SIGNATURE") ??
        req.headers.get("x-payment-signature") ??
        req.headers.get("x-payment");
      if (paymentSig) forwardHeaders["PAYMENT-SIGNATURE"] = paymentSig;

      let proxyBody: RunBody;
      try {
        proxyBody = (await req.json()) as RunBody;
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }

      const result = await routeToPeer({
        peerUrl,
        agentId: id,
        task: (proxyBody.task ?? "").trim(),
        currentHopCount: hopCount,
        forwardHeaders,
      });

      if (result.proxied && result.response) {
        return Response.json(result.response);
      }
      return Response.json(
        { error: result.error ?? `Agent not found: ${id}` },
        { status: 404 }
      );
    }
    return Response.json({ error: `Agent not found: ${id}` }, { status: 404 });
  }

  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const task = (body.task ?? "").trim();
  if (!task) {
    return Response.json({ error: "task is required" }, { status: 400 });
  }

  const validation = validateTaskInput(task);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const ip = getClientIp(req);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return Response.json(
      { error: "Rate limit exceeded. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      }
    );
  }

  // Self Protocol sybil check (optional, controlled by CALAGENT_SELF_ENFORCE)
  if (selfEnforced() && agent.walletAddress) {
    const verified = await isSelfVerified(agent.walletAddress);
    if (!verified) {
      return Response.json(
        {
          error: "Agent wallet is not Self Protocol verified",
          selfRegistry: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
        },
        { status: 403 },
      );
    }
  }

  const isCeloAgent = agent.chain === CELO_CHAIN;

  const paymentCapability = agent.payments.find(
    (paymentItem) => paymentItem.protocol === "x402"
  );
  let requirement = buildStellarX402Requirement({
    resource: `${req.nextUrl.origin}/api/agents/${encodeURIComponent(id)}/run`,
    description: `Run the Cal-AgentKit ${agent.name} agent`,
    amount: paymentCapability?.price?.replace(/\s+[A-Z0-9]+$/i, ""),
    payTo: paymentCapability?.payTo,
  });

  if (agent.chain === CELO_CHAIN) {
    const displayAmount =
      paymentCapability?.price?.replace(/\s+[A-Z0-9]+$/i, "") ??
      requirement.displayAmount;
    requirement = {
      ...requirement,
      network: CELO_NETWORK_ID,
      asset: CELO_STABLE_ASSET_CONTRACT,
      assetLabel: CELO_STABLE_ASSET,
      assetIssuer: undefined,
      displayAmount,
      amount: celoAmountToBaseUnits(displayAmount),
      payTo: paymentCapability?.payTo ?? celoPaymentReceiver(),
      description: `Run the Cal-AgentKit ${agent.name} Celo agent`,
      facilitatorUrl: celoFacilitatorUrl() ?? requirement.facilitatorUrl,
    };
  }

  const payment = await verifyAndSettleX402Payment({
    paymentSignatureHeader:
      req.headers.get("PAYMENT-SIGNATURE") ??
      req.headers.get("x-payment-signature") ??
      req.headers.get("x-payment"),
    requirement,
  });

  const enforced = isCeloAgent ? celoX402Enforced() : x402Enforced();

  if (enforced && !payment.headerPresent) {
    return paymentRequiredResponse({ requirement, agent });
  }

  if (enforced && payment.headerPresent && !payment.verified) {
    return Response.json(
      {
        error: (requirement.facilitatorUrl ?? facilitatorUrl())
          ? "x402 payment verification failed"
          : "x402 facilitator verification is not configured",
        payment: payment.verify ?? requirement,
      },
      { status: (requirement.facilitatorUrl ?? facilitatorUrl()) ? 402 : 501 }
    );
  }

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const walletAddress = agent.walletAddress ?? requirement.payTo ?? "";
  let attestationTxHash: string | undefined;
  let output: string;
  if (id === "ledger") {
    output = await ledgerOutput(task, walletAddress);
  } else if (id === "celo-ledger") {
    output = await celoLedgerOutput(task);
  } else if (id === "celo-defi") {
    output = await celoDefiOutput(task);
  } else if (id === "celo-price") {
    output = await celoPriceOutput(task);
  } else if (id === "celo-notary") {
    const notaryResult = await celoNotaryRun(task, runId);
    output = notaryResult.output;
    attestationTxHash = notaryResult.attestationTxHash;
  } else {
    output = agentOutput(id, task);
  }
  const txHashes = [
    ...(payment.transaction ? [payment.transaction] : []),
    ...(attestationTxHash ? [attestationTxHash] : []),
  ];

  const report: OrchestratorReport = {
    task,
    subtasks: {
      [id]: task,
    },
    results: {
      [id]: output,
    },
    report: output,
    wallets: {
      [id]: walletAddress,
    },
    spent: {
      [id]: payment.verified ? Number(requirement.amount) : 0,
    },
    reputation: {
      [id]: 10000,
    },
    txHashes: {
      [id]: txHashes,
    },
    timestamp: now,
  };

  let receipt: RunReceipt = createRunReceipt({
    report,
    runId,
    taskId: runId,
    createdAt: now,
    completedAt: now,
    shieldContractId: isCeloAgent
      ? process.env.CELO_POLICY_ADDRESS
      : process.env.SHIELD_CONTRACT_ID,
    registryContractId: isCeloAgent
      ? process.env.CELO_REGISTRY_ADDRESS
      : process.env.REGISTRY_CONTRACT_ID,
    network: requirement.network,
  });

  receipt = {
    ...receipt,
    agents: receipt.agents.map((receiptAgent) =>
      receiptAgent.agentId === id
        ? {
            ...receiptAgent,
            paymentProtocol: "x402",
        paymentAsset:
          agent.chain === CELO_CHAIN ? CELO_STABLE_ASSET : "USDC",
            paymentAmount: requirement.displayAmount,
            paymentAmountBaseUnits: requirement.amount,
            settlementTxHash: payment.transaction,
            paymentMode: payment.verificationMode,
          }
        : receiptAgent
    ),
    payments: [
      {
        agentId: id,
        protocol: "x402",
        network: requirement.network,
        asset: agent.chain === CELO_CHAIN ? CELO_STABLE_ASSET : "USDC",
        amount: requirement.displayAmount,
        amountBaseUnits: requirement.amount,
        payer: payment.payer,
        payTo: requirement.payTo,
        transaction: payment.transaction,
        verificationMode: payment.verificationMode,
      },
    ],
  };
  receipt = {
    ...receipt,
    receiptHash: computeReceiptHash(receipt),
  };

  const signerSecret = process.env.ORCHESTRATOR_SECRET_KEY;
  if (signerSecret) {
    try {
      receipt = signRunReceipt(receipt, Keypair.fromSecret(signerSecret));
    } catch (err) {
      console.warn("[api/agents/:id/run] Could not sign receipt:", err);
    }
  }

  receipts.set(runId, receipt);
  receiptOutputs.set(runId, output);
  persistReceipts();
  persistReceiptOutputs();

  return Response.json({
    agent,
    task,
    result: output,
    receipt,
    verificationUrl: `${req.nextUrl.origin}/receipts/${encodeURIComponent(runId)}`,
    payment: {
      protocol: "x402",
      scheme: "exact",
      network: requirement.network,
      asset: requirement.asset,
      amount: requirement.displayAmount,
      maxAmountRequired: requirement.amount,
      required: x402Enforced(),
      headerPresent: payment.headerPresent,
      verified: payment.verified,
      payer: payment.payer,
      transaction: payment.transaction,
      verificationMode: payment.verificationMode,
    },
    settlement: payment.settle,
  }, {
    headers: payment.paymentResponseHeader
      ? {
          "PAYMENT-RESPONSE": payment.paymentResponseHeader,
          "Access-Control-Expose-Headers": "PAYMENT-RESPONSE",
        }
      : undefined,
  });
}
