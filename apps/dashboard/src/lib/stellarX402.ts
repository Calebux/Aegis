import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";

const USDC_TESTNET_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_TESTNET_CONTRACT_ID =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const USDC_DECIMALS = 7;

export const STELLAR_NETWORK =
  process.env.CALAGENT_X402_STELLAR_NETWORK ?? "testnet";
export const STELLAR_NETWORK_ID = `stellar:${STELLAR_NETWORK}`;
export const STELLAR_USDC_ISSUER =
  process.env.STELLAR_USDC_ISSUER ?? USDC_TESTNET_ISSUER;
export const STELLAR_USDC_CONTRACT_ID =
  process.env.STELLAR_USDC_CONTRACT_ID ?? USDC_TESTNET_CONTRACT_ID;
export const CALAGENT_AGENT_PRICE_USDC =
  process.env.CALAGENT_AGENT_PRICE_USDC ?? "0.001";

export interface StellarX402PaymentRequirement {
  x402Version: 2;
  scheme: "exact";
  network: string;
  asset: string;
  assetLabel?: string;
  assetIssuer?: string;
  amount: string;
  displayAmount: string;
  payTo?: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  maxTimeoutSeconds: number;
  facilitatorUrl?: string;
}

export function x402Enforced(): boolean {
  return process.env.CALAGENT_X402_ENFORCE === "true";
}

export function x402DevAcceptEnabled(): boolean {
  return process.env.CALAGENT_X402_DEV_ACCEPT !== "false";
}

export function facilitatorUrl(): string | undefined {
  return process.env.CALAGENT_X402_FACILITATOR_URL;
}

export function paymentReceiver(): string | undefined {
  return (
    process.env.CALAGENT_X402_RECEIVER ??
    process.env.HORIZON_PAYMENT_RECEIVER ??
    process.env.PAYMENT_RECEIVER
  );
}

function decimalUsdToBaseUnits(amount: string): string {
  const normalized = amount.replace(/^\$/, "").replace(/\s*USDC$/i, "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid USDC amount: ${amount}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const padded = fraction.padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  return `${whole}${padded}`.replace(/^0+/, "") || "0";
}

export function buildStellarX402Requirement(params: {
  resource: string;
  description: string;
  amount?: string;
  payTo?: string;
}): StellarX402PaymentRequirement {
  const displayAmount = params.amount ?? CALAGENT_AGENT_PRICE_USDC;
  return {
    x402Version: 2,
    scheme: "exact",
    network: STELLAR_NETWORK_ID,
    asset: STELLAR_USDC_CONTRACT_ID,
    assetLabel: "USDC",
    assetIssuer: STELLAR_USDC_ISSUER,
    amount: decimalUsdToBaseUnits(displayAmount),
    displayAmount,
    payTo: params.payTo ?? paymentReceiver(),
    resource: params.resource,
    description: params.description,
    mimeType: "application/json",
    maxTimeoutSeconds: Number(process.env.CALAGENT_X402_TIMEOUT_SECONDS ?? 300),
    facilitatorUrl: facilitatorUrl(),
  };
}

export function toX402PaymentRequirements(
  requirement: StellarX402PaymentRequirement
): PaymentRequirements {
  return {
    scheme: requirement.scheme,
    network: requirement.network as Network,
    amount: requirement.amount,
    payTo: requirement.payTo ?? "",
    maxTimeoutSeconds: requirement.maxTimeoutSeconds,
    asset: requirement.asset,
    extra: {
      assetCode: requirement.assetLabel ?? "USDC",
      assetIssuer: requirement.assetIssuer ?? null,
      displayAmount: requirement.displayAmount,
      facilitatorUrl: requirement.facilitatorUrl ?? null,
    },
  };
}

export function buildPaymentRequired(
  requirement: StellarX402PaymentRequirement
): PaymentRequired {
  return {
    x402Version: requirement.x402Version,
    error: "payment required",
    resource: {
      url: requirement.resource,
      description: requirement.description,
      mimeType: requirement.mimeType,
      serviceName: "Cal-AgentKit",
      tags: ["stellar", "agents", "x402", "usdc"],
    },
    accepts: [toX402PaymentRequirements(requirement)],
  };
}

export function encodePaymentRequirement(
  requirement: StellarX402PaymentRequirement
): string {
  return encodePaymentRequiredHeader(buildPaymentRequired(requirement));
}

export function paymentRequiredResponse(params: {
  requirement: StellarX402PaymentRequirement;
  agent?: unknown;
}): Response {
  const paymentRequired = buildPaymentRequired(params.requirement);
  const encoded = encodePaymentRequiredHeader(paymentRequired);

  return Response.json(
    {
      error: "payment required",
      protocol: "x402",
      payment: paymentRequired,
      agent: params.agent,
    },
    {
      status: 402,
      headers: {
        "X-Payment": encoded,
        "PAYMENT-REQUIRED": encoded,
        "X-PAYMENT-REQUIRED": encoded,
        "Access-Control-Expose-Headers":
          "X-Payment, PAYMENT-REQUIRED, X-PAYMENT-REQUIRED",
      },
    }
  );
}

export interface X402PaymentCheck {
  headerPresent: boolean;
  verified: boolean;
  verificationMode: "facilitator" | "dev-header-acceptance" | "disabled";
  payer?: string;
  transaction?: string;
  paymentResponseHeader?: string;
  verify?: VerifyResponse;
  settle?: SettleResponse;
}

function facilitatorAuthHeaders(): Record<string, string> {
  const apiKey = process.env.CALAGENT_X402_FACILITATOR_API_KEY;
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function postFacilitator<T>(
  path: "verify" | "settle",
  baseUrl: string,
  body: {
    x402Version: number;
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements;
  }
): Promise<T> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...facilitatorAuthHeaders(),
    },
    body: JSON.stringify(body),
  });

  const parsed = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !parsed) {
    throw new Error(`x402 facilitator ${path} returned ${res.status}`);
  }
  return parsed;
}

export async function verifyAndSettleX402Payment(params: {
  paymentSignatureHeader?: string | null;
  requirement: StellarX402PaymentRequirement;
}): Promise<X402PaymentCheck> {
  const configuredFacilitator = params.requirement.facilitatorUrl ?? facilitatorUrl();

  if (!params.paymentSignatureHeader) {
    return {
      headerPresent: false,
      verified: false,
      verificationMode: configuredFacilitator ? "facilitator" : "disabled",
    };
  }

  if (!configuredFacilitator) {
    return {
      headerPresent: true,
      verified: x402DevAcceptEnabled(),
      verificationMode: x402DevAcceptEnabled()
        ? "dev-header-acceptance"
        : "disabled",
    };
  }

  const paymentPayload = decodePaymentSignatureHeader(
    params.paymentSignatureHeader
  );
  const paymentRequirements = toX402PaymentRequirements(params.requirement);
  const facilitatorBody = {
    x402Version: params.requirement.x402Version,
    paymentPayload,
    paymentRequirements,
  };

  const verify = await postFacilitator<VerifyResponse>(
    "verify",
    configuredFacilitator,
    facilitatorBody
  );
  if (!verify.isValid) {
    return {
      headerPresent: true,
      verified: false,
      verificationMode: "facilitator",
      payer: verify.payer,
      verify,
    };
  }

  const settle = await postFacilitator<SettleResponse>(
    "settle",
    configuredFacilitator,
    facilitatorBody
  );
  return {
    headerPresent: true,
    verified: settle.success,
    verificationMode: "facilitator",
    payer: settle.payer ?? verify.payer,
    transaction: settle.transaction,
    paymentResponseHeader: encodePaymentResponseHeader(settle),
    verify,
    settle,
  };
}
