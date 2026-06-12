import type { AgentManifest } from "@calebux/agent-kit";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoAlfajores } from "viem/chains";

export const CELO_CHAIN = "celo";
export const CELO_MAINNET_NETWORK = "eip155:42220";
export const CELO_ALFAJORES_NETWORK = "eip155:44787";
export const CELO_MAINNET_CUSD = "0x765DE816845861e75A25fCA122bb6898B8B1282a";
export const CELO_ALFAJORES_CUSD = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";

export const AEGIS_CELO_REGISTRY_ABI = [
  {
    type: "function",
    name: "registerAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "name", type: "string" },
      { name: "capability", type: "string" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setManifestHash",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getManifestHash",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "recordSuccess",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "recordFailure",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [],
  },
] as const;

export interface CeloAgentManifestOptions {
  id: string;
  name: string;
  description?: string;
  capabilities: string[];
  endpointUrl: string;
  network?: string;
  asset?: string;
  assetContract?: string;
  price?: string;
  payTo?: string;
  registryContractId?: string;
  shieldContractId?: string;
}

export interface CeloClients {
  account: { address: Address };
  publicClient: {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>;
  };
  walletClient: {
    writeContract: (args: Record<string, unknown>) => Promise<Hex>;
  };
}

export function createCeloAgentManifest(
  options: CeloAgentManifestOptions
): Partial<AgentManifest> {
  const network = options.network ?? CELO_ALFAJORES_NETWORK;
  const asset = options.asset ?? "cUSD";

  return {
    id: options.id,
    name: options.name,
    description: options.description,
    chain: CELO_CHAIN,
    capabilities: options.capabilities,
    endpoint: {
      url: options.endpointUrl,
      protocol: "http",
    },
    payments: [
      {
        protocol: "x402",
        chain: CELO_CHAIN,
        network,
        asset,
        price: options.price,
        payTo: options.payTo,
      },
    ],
    policies: {
      allowedAssets: [asset],
      minCounterpartyReputation: 5000,
    },
    registryContractId: options.registryContractId,
    shieldContractId: options.shieldContractId,
    metadata: {
      chain: CELO_CHAIN,
      paymentScheme: "x402.exact",
      settlementNetwork: network,
      settlementAsset: asset,
      settlementAssetContract: options.assetContract ?? null,
      receiptVersion: "aegis.receipt.v1",
    },
  };
}

export function celoNetworkToViemChain(network = CELO_ALFAJORES_NETWORK) {
  return network === CELO_MAINNET_NETWORK ? celo : celoAlfajores;
}

export function createCeloClients(params: {
  privateKey: Hex;
  rpcUrl?: string;
  network?: string;
}): CeloClients {
  const chain = celoNetworkToViemChain(params.network);
  const transport = http(params.rpcUrl);
  const account = privateKeyToAccount(params.privateKey);

  return {
    account,
    publicClient: createPublicClient({
      chain,
      transport,
    }) as unknown as CeloClients["publicClient"],
    walletClient: createWalletClient({
      account,
      chain,
      transport,
    }) as unknown as CeloClients["walletClient"],
  };
}

export function manifestHashToBytes32(manifestHash: string): Hex {
  const normalized = manifestHash.startsWith("0x")
    ? manifestHash
    : `0x${manifestHash}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`Invalid manifest hash: ${manifestHash}`);
  }
  return normalized as Hex;
}

export async function publishCeloManifestHash(params: {
  registryAddress: Address;
  privateKey: Hex;
  agentId: string;
  name: string;
  capability: string;
  manifestHash: string;
  rpcUrl?: string;
  network?: string;
}) {
  const { publicClient, walletClient, account } = createCeloClients(params);
  const args = [
    params.agentId,
    params.name,
    params.capability,
    manifestHashToBytes32(params.manifestHash),
  ] as const;

  try {
    const hash = await walletClient.writeContract({
      address: params.registryAddress,
      abi: AEGIS_CELO_REGISTRY_ABI,
      functionName: "registerAgent",
      args,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  } catch {
    const hash = await walletClient.writeContract({
      address: params.registryAddress,
      abi: AEGIS_CELO_REGISTRY_ABI,
      functionName: "setManifestHash",
      args: [params.agentId, manifestHashToBytes32(params.manifestHash)],
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}
