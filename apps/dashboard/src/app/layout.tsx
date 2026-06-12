import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { WalletStrip } from "@/components/WalletStrip";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Aegis - Stellar Agent Infrastructure",
  description:
    "Agent execution and trust infrastructure for Stellar: x402 payments, MPP-ready agent discovery, Soroban policy controls, on-chain reputation, and MCP tooling.",
  keywords: [
    "Stellar agents",
    "Stellar agent infrastructure",
    "Soroban agents",
    "x402 Stellar",
    "MPP payments",
    "MCP Stellar",
    "AI agent payments",
    "on-chain reputation",
    "agent wallet policy",
    "verifiable agent execution",
  ],
  applicationName: "Aegis",
  authors: [{ name: "Aegis" }],
  creator: "Aegis",
  publisher: "Aegis",
  openGraph: {
    title: "Aegis - Stellar Agent Infrastructure",
    description:
      "Build governed AI agents on Stellar with x402 payments, Soroban spend policies, on-chain reputation, agent discovery, and MCP tools.",
    siteName: "Aegis",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Aegis - Stellar Agent Infrastructure",
    description:
      "Governed AI agent infrastructure for Stellar: wallets, policy, x402 payments, reputation, discovery, and MCP.",
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
            <span>Stellar · Testnet</span>
            <span className="hdr-divider" />
            <ThemeToggle />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
