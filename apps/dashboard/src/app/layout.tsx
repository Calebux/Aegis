import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { WalletStrip } from "@/components/WalletStrip";
import { ThemeToggle } from "@/components/ThemeToggle";

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
    <html lang="en">
      <body>
        <header className="site-header">
          <span className="hdr-brand">
            AEGIS<span className="slash"> / </span>FIELD
          </span>
          <span className="hdr-sub">Agent Control Module</span>
          <div className="hdr-right">
            <WalletStrip />
            <span className="hdr-divider" />
            <span className="sys-ok">
              <span className="sys-dot" />
              SYS.OK
            </span>
            <span>Celo · Mainnet</span>
            <span className="hdr-divider" />
            <ThemeToggle />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
