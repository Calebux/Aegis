import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Aegis - Celo Agent Infrastructure",
  description:
    "Agent execution and trust infrastructure for Celo: x402 payments, agent discovery, EVM policy controls, on-chain reputation, and MCP tooling.",
  keywords: [
    "Celo agents",
    "Celo agent infrastructure",
    "x402 Celo",
    "AI agent payments",
    "on-chain reputation",
    "agent wallet policy",
    "verifiable agent execution",
    "cUSD",
    "MCP agents",
  ],
  applicationName: "Aegis",
  authors: [{ name: "Aegis" }],
  creator: "Aegis",
  publisher: "Aegis",
  openGraph: {
    title: "Aegis - Celo Agent Infrastructure",
    description:
      "Build governed AI agents on Celo with x402 payments, EVM spend policies, on-chain reputation, agent discovery, and MCP tools.",
    siteName: "Aegis",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Aegis - Celo Agent Infrastructure",
    description:
      "Governed AI agent infrastructure for Celo: wallets, policy, x402 payments, reputation, discovery, and MCP.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
