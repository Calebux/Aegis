import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AEGIS / FIELD",
  description: "Multi-agent intelligence on Stellar",
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
            <span className="sys-ok">
              <span className="sys-dot" />
              SYS.OK
            </span>
            <span>Stellar · Testnet</span>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
