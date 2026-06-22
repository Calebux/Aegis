import { NextRequest, NextResponse } from "next/server";
import { EventEmitter } from "events";
import { runCeloTask } from "@calagent/orchestrator";
import {
  buildStellarX402Requirement,
  paymentRequiredResponse,
  verifyAndSettleX402Payment,
} from "@/lib/stellarX402";
import {
  CELO_NETWORK_ID,
  CELO_STABLE_ASSET,
  CELO_STABLE_ASSET_CONTRACT,
  celoAmountToBaseUnits,
  celoFacilitatorUrl,
  celoPaymentReceiver,
  celoX402Enforced,
} from "@/lib/celoX402";
import { tasks, emitters, persistTasks } from "@/lib/taskStore";
import type { Task } from "@calagent/shared";
import { createLLMProvider, type RunReceipt } from "@calagent/agent-kit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const model = body.model || "calagent-ultra";
  const messages = body.messages || [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  // Extract the latest user message
  const lastMessage = messages[messages.length - 1];
  const prompt = lastMessage?.content?.trim() || "";

  if (!prompt) {
    return NextResponse.json({ error: "prompt content is required" }, { status: 400 });
  }

  // --- x402 Gating ---
  const displayAmount = "0.05"; // Flat rate 0.05 USDm for Calagent-Ultra per prompt
  const requirement = {
    ...buildStellarX402Requirement({
      resource: `${req.nextUrl.origin}/api/v1/chat/completions`,
      description: `Calagent Ultra Orchestration Request`,
      amount: displayAmount,
      payTo: celoPaymentReceiver(),
    }),
    network: CELO_NETWORK_ID,
    asset: CELO_STABLE_ASSET_CONTRACT,
    assetLabel: CELO_STABLE_ASSET,
    assetIssuer: undefined,
    displayAmount,
    amount: celoAmountToBaseUnits(displayAmount),
    payTo: celoPaymentReceiver(),
    description: `Calagent Ultra Orchestration Request`,
    facilitatorUrl: celoFacilitatorUrl(),
  };

  const payment = await verifyAndSettleX402Payment({
    paymentSignatureHeader: req.headers.get("Authorization")?.replace(/^L402\s+/i, ""),
    requirement,
  });

  const enforced = celoX402Enforced();

  if (enforced && !payment.headerPresent) {
    return paymentRequiredResponse({ requirement, agent: { id: "calagent-ultra" } as never });
  }

  if (enforced && payment.headerPresent && !payment.verified) {
    return NextResponse.json(
      {
        error: "x402 payment verification failed",
        payment: payment.verify ?? requirement,
      },
      { status: 402 }
    );
  }

  // --- Run Orchestrator ---
  const taskId = crypto.randomUUID();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);

  const task: Task = {
    id: taskId,
    prompt,
    status: "running",
    chain: "celo",
    subTasks: [
      { id: crypto.randomUUID(), assignedAgent: "celo-scout", instruction: `Search: ${prompt}`, status: "pending" },
      { id: crypto.randomUUID(), assignedAgent: "celo-ledger", instruction: `Metrics: ${prompt}`, status: "pending" },
      { id: crypto.randomUUID(), assignedAgent: "celo-signal", instruction: `Signals: ${prompt}`, status: "pending" },
      { id: crypto.randomUUID(), assignedAgent: "celo-scribe", instruction: `Synthesize: ${prompt}`, status: "pending" },
    ],
    createdAt: new Date(),
  };

  tasks.set(taskId, task);
  emitters.set(taskId, emitter);
  persistTasks();

  // Promise to await the final completion
  const runCompletion = new Promise<{ report: string; receipt?: RunReceipt; cost: number; txHash?: string }>((resolve, reject) => {
    let finalReceipt: RunReceipt | undefined;
    let totalSpent = 0;
    
    emitter.once("receipt", (r: RunReceipt) => {
      finalReceipt = r;
    });

    emitter.once("complete", (payload: { spent?: Record<string, number>, report: string, txHashes?: Record<string, string[]> }) => {
      for (const stroops of Object.values(payload.spent || {}) as number[]) {
        totalSpent += stroops;
      }
      resolve({ 
        report: payload.report, 
        receipt: finalReceipt, 
        cost: totalSpent,
        txHash: payload.txHashes ? Object.values(payload.txHashes).flat()[0] as string : undefined
      });
    });

    emitter.once("error", (err) => {
      reject(err);
    });
  });

  // Resolve which OpenRouter model to use:
  //  1. Caller can pass body.openrouter_model to override (e.g. "anthropic/claude-sonnet-4")
  //  2. Env vars CALAGENT_MODEL_ULTRA / CALAGENT_MODEL_BASE set the server default per tier
  //  3. Fallback: deepseek/deepseek-reasoner (ultra) / deepseek/deepseek-chat (base)
  let llmProvider;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: OPENROUTER_API_KEY is not set" },
      { status: 503 }
    );
  }
  try {
    const callerModel = body.openrouter_model as string | undefined;
    const llmModel = callerModel
      ?? (model === "calagent-base"
        ? (process.env.CALAGENT_MODEL_BASE ?? "deepseek/deepseek-chat")
        : (process.env.CALAGENT_MODEL_ULTRA ?? "deepseek/deepseek-reasoner"));
    llmProvider = createLLMProvider({
      provider: "openrouter",
      apiKey: openrouterKey,
      model: llmModel,
    });
  } catch (err) {
    console.warn("Failed to create OpenRouter provider:", err);
    return NextResponse.json(
      { error: "Failed to initialize LLM provider" },
      { status: 503 }
    );
  }

  // Start orchestrator fire-and-forget
  runCeloTask(prompt, emitter, llmProvider).catch(console.error);

  try {
    const { report, receipt, cost, txHash } = await runCompletion;

    const completionResponse = {
      id: `chatcmpl-${taskId}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: report,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        // Rough token estimate: ~4 chars per token for English text
        prompt_tokens: Math.ceil(prompt.length / 4),
        completion_tokens: Math.ceil(report.length / 4),
        total_tokens: Math.ceil(prompt.length / 4) + Math.ceil(report.length / 4),
      },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-calagent-cost-stroops": cost.toString(),
    };

    if (receipt?.receiptHash) {
      headers["x-calagent-receipt-hash"] = receipt.receiptHash;
    }
    if (txHash) {
      headers["x-calagent-tx-hash"] = txHash;
    }

    return NextResponse.json(completionResponse, { headers });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message || "Orchestration failed" }, { status: 500 });
  } finally {
    emitters.delete(taskId);
  }
}
