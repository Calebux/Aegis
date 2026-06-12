import { NextResponse } from "next/server";
import { receipts } from "@/lib/taskStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const unique = new Map(
    Array.from(receipts.values()).map((receipt) => [receipt.receiptHash, receipt])
  );

  return NextResponse.json({
    count: unique.size,
    receipts: Array.from(unique.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
  });
}
