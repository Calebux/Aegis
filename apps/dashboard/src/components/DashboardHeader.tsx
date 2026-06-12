import { WalletStrip } from "@/components/WalletStrip";
import { ThemeToggle } from "@/components/ThemeToggle";

export function DashboardHeader() {
  return (
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
  );
}
