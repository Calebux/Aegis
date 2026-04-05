import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis — Multi-Agent Dashboard",
  description: "Live view of Aegis task execution, wallet balances, and agent reputation on Stellar testnet",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            <span className="logo">Aegis</span>
            <span className="network-badge">Stellar Testnet</span>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
