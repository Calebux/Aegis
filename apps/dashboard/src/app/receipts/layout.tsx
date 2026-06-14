import type { ReactNode } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";

export default function ReceiptsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DashboardHeader />
      <main>{children}</main>
    </>
  );
}
