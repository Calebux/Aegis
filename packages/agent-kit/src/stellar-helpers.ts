/**
 * Stellar helpers bundled into agent-kit (originally from @calagent/shared).
 * Avoids requiring a separate published package for downstream consumers.
 */

import { Horizon } from "@stellar/stellar-sdk";

export function getHorizonUrl(): string {
  return process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
}

export function getHorizonServer(): Horizon.Server {
  return new Horizon.Server(getHorizonUrl());
}

export async function fundTestnetAccount(publicKey: string): Promise<void> {
  const network = process.env.STELLAR_NETWORK ?? "testnet";
  const friendbotUrl =
    network === "futurenet"
      ? `https://friendbot-futurenet.stellar.org?addr=${encodeURIComponent(publicKey)}`
      : `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`;
  const response = await fetch(friendbotUrl);
  if (!response.ok) {
    throw new Error(`Friendbot funding failed: ${response.statusText}`);
  }
}
