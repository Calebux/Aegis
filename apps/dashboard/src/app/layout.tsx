import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis — Multi-Agent Intelligence",
  description: "Governed multi-agent intelligence on Stellar — live task execution, wallet balances, and agent reputation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            <span className="logo">
              <span className="logo-shield">⬡</span> Aegis
            </span>
            <span className="tagline">Governed multi-agent intelligence on Stellar</span>
            <span className="network-badge">Stellar Testnet</span>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
