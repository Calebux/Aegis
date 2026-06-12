import type { ReactNode } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { SystemHealthBanner } from "@/components/SystemHealthBanner";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DashboardHeader />
      <SystemHealthBanner />
      <main>{children}</main>
    </>
  );
}
