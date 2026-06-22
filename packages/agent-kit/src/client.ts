/**
 * CalagentClient
 *
 * A lightweight client wrapper for the Calagent-Ultra API endpoint.
 * It automatically handles the HTTP 402 Payment Required x402 challenge,
 * pays the Celo cUSD invoice using a viem wallet, and retries the request.
 *
 * @example
 * ```ts
 * import { CalagentClient } from "@calagent/agent-kit";
 *
 * const client = new CalagentClient({
 *   baseURL: "https://your-calagent-instance.com/api/v1",
 *   celoPrivateKey: process.env.CELO_PRIVATE_KEY,
 * });
 *
 * const response = await client.chat.completions.create({
 *   model: "calagent-ultra",
 *   messages: [{ role: "user", content: "Analyze the Celo market" }],
 * });
 * console.log(response.choices[0].message.content);
 * ```
 */

import { submitCusdPayment } from "./payments-celo.js";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Address } from "viem";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalagentClientOptions {
  /** Base URL of the Calagent API (e.g. "https://cal-agentkit.dev/api/v1") */
  baseURL?: string;
  /** Celo private key (hex, with or without 0x prefix) for automatic x402 payments */
  celoPrivateKey?: string;
  /** Optional Celo RPC URL override */
  celoRpcUrl?: string;
}

export interface CalagentChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CalagentChatCompletionRequest {
  model: string;
  messages: CalagentChatMessage[];
}

export interface CalagentChatCompletionChoice {
  index: number;
  message: { role: string; content: string };
  finish_reason: string;
}

export interface CalagentChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: CalagentChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** On-chain receipt hash (from x-calagent-receipt-hash header) */
  receiptHash?: string;
  /** Total cost in base units (from x-calagent-cost-stroops header) */
  cost?: string;
  /** On-chain transaction hash (from x-calagent-tx-hash header) */
  txHash?: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class CalagentClient {
  public baseURL: string;
  private account?: PrivateKeyAccount;
  private celoRpcUrl?: string;

  constructor(options?: CalagentClientOptions) {
    this.baseURL = options?.baseURL ?? "https://cal-agentkit.dev/api/v1";
    this.celoRpcUrl = options?.celoRpcUrl;

    if (options?.celoPrivateKey) {
      const key = options.celoPrivateKey.startsWith("0x")
        ? (options.celoPrivateKey as `0x${string}`)
        : (`0x${options.celoPrivateKey}` as `0x${string}`);
      this.account = privateKeyToAccount(key);
    }
  }

  public chat = {
    completions: {
      create: async (
        body: CalagentChatCompletionRequest
      ): Promise<CalagentChatCompletionResponse> => {
        return this._requestWithX402("/chat/completions", body);
      },
    },
  };

  private async _requestWithX402(
    path: string,
    body: CalagentChatCompletionRequest,
    paymentHeader?: string
  ): Promise<CalagentChatCompletionResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (paymentHeader) {
      headers["PAYMENT-SIGNATURE"] = paymentHeader;
    }

    const response = await fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (response.status === 402) {
      // Parse the x402 challenge
      const challenge = await response.json();

      if (!this.account) {
        throw new Error(
          [
            "402 Payment Required.",
            `Amount: ${challenge.payment?.accepts?.[0]?.extra?.displayAmount ?? "unknown"} cUSD`,
            "Provide a celoPrivateKey to the CalagentClient constructor to auto-pay.",
          ].join(" ")
        );
      }

      // Extract payment details from the 402 challenge
      const accepts = challenge.payment?.accepts?.[0];
      const payTo = (accepts?.payTo ?? challenge.payment?.payTo) as Address | undefined;
      const displayAmount =
        accepts?.extra?.displayAmount ?? accepts?.amount ?? "0.05";

      if (!payTo) {
        throw new Error("402 challenge missing payTo address");
      }

      console.log(
        `[CalagentClient] 402 Payment Required: ${displayAmount} cUSD → ${payTo}. Paying...`
      );

      // Submit real cUSD payment on Celo
      const txHash = await submitCusdPayment(
        this.account,
        payTo,
        displayAmount,
        this.celoRpcUrl
      );

      console.log(
        `[CalagentClient] Payment confirmed: ${txHash}. Retrying request...`
      );

      // Retry with payment proof
      return this._requestWithX402(path, body, txHash);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`Calagent API Error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as CalagentChatCompletionResponse;

    // Attach verification headers to the response object
    data.receiptHash =
      response.headers.get("x-calagent-receipt-hash") ?? undefined;
    data.cost =
      response.headers.get("x-calagent-cost-stroops") ?? undefined;
    data.txHash =
      response.headers.get("x-calagent-tx-hash") ?? undefined;

    return data;
  }
}
