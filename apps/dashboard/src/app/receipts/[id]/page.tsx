import { notFound } from "next/navigation";
import { verifyRunReceipt } from "@calebux/agent-kit";
import { RunReceiptPanel } from "@/components/RunReceiptPanel";
import { receipts, tasks } from "@/lib/taskStore";

interface PageProps {
  params: Promise<{ id: string }>;
}

function xlm(stroops: number): string {
  return `${(stroops / 1e7).toFixed(4)} XLM`;
}

function Row({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{value === undefined || value === "" ? "-" : value}</td>
    </tr>
  );
}

export default async function ReceiptPage({ params }: PageProps) {
  const { id } = await params;
  const receipt = receipts.get(id);

  if (!receipt) notFound();

  const verification = verifyRunReceipt(receipt, {
    output: receipt.taskId ? tasks.get(receipt.taskId)?.finalReport : undefined,
  });

  return (
    <div className="receipt-page">
      <div className="module receipt-page-title">
        <h1>Run Receipt</h1>
        <p>
          Verifiable Aegis agent execution receipt with task/output hashes,
          Stellar payment traces, policy contracts, and signature status.
        </p>
      </div>

      <div className="module">
        <div className="mod-header">
          VERIFICATION
          <span style={{ color: verification.valid ? "#48a858" : "#c05050", marginLeft: "auto" }}>
            {verification.valid ? "VALID" : "FAILED"}
          </span>
        </div>
        <RunReceiptPanel receipt={receipt} verification={verification} />
      </div>

      <div className="module">
        <div className="mod-header">RECEIPT DETAIL</div>
        <table className="receipt-detail-table">
          <tbody>
            <Row label="Run ID" value={receipt.runId} />
            <Row label="Task ID" value={receipt.taskId} />
            <Row label="Created" value={receipt.createdAt} />
            <Row label="Completed" value={receipt.completedAt} />
            <Row label="Task" value={receipt.task} />
            <Row label="Task Hash" value={receipt.taskHash} />
            <Row label="Output Hash" value={receipt.outputHash} />
            <Row label="Receipt Hash" value={receipt.receiptHash} />
            <Row label="Total Spend" value={xlm(receipt.totalSpentStroops)} />
            <Row label="Network" value={receipt.policy.network} />
            <Row label="Shield Contract" value={receipt.policy.shieldContractId} />
            <Row label="Registry Contract" value={receipt.policy.registryContractId} />
            <Row label="Signer" value={receipt.signature?.signer} />
            <Row label="Signature" value={receipt.signature?.signature} />
          </tbody>
        </table>
      </div>

      <div className="module">
        <div className="mod-header">AGENTS</div>
        <table className="receipt-detail-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Wallet</th>
              <th>Spend</th>
              <th>Reputation</th>
              <th>Txs</th>
            </tr>
          </thead>
          <tbody>
            {receipt.agents.map((agent) => (
              <tr key={agent.agentId}>
                <td>{agent.agentId}</td>
                <td>{agent.walletAddress || "-"}</td>
                <td>{xlm(agent.spentStroops)}</td>
                <td>{agent.reputation}</td>
                <td>{agent.txHashes.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receipt.txHashes.length > 0 && (
        <div className="module">
          <div className="mod-header">PAYMENT TX HASHES</div>
          <table className="receipt-detail-table">
            <tbody>
              {receipt.txHashes.map((hash, index) => (
                <Row key={`${hash}-${index}`} label={`Tx ${index + 1}`} value={hash} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
