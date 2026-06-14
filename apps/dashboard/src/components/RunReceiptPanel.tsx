"use client";

import type { RunReceipt, RunReceiptVerification } from "@calebux/agent-kit";

function shortHash(value: string, left = 10, right = 8): string {
  if (!value) return "-";
  if (value.length <= left + right + 1) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function formatCusd(value: number): string {
  return (value / 1e18).toFixed(4);
}

function statusText(verification?: RunReceiptVerification): string {
  if (!verification) return "PENDING";
  return verification.valid ? "VERIFIED" : "FAILED";
}

interface Props {
  receipt: RunReceipt;
  verification?: RunReceiptVerification;
}

export function RunReceiptPanel({ receipt, verification }: Props) {
  const receiptUrl = `/receipts/${receipt.runId}`;
  const status = statusText(verification);

  return (
    <div className="receipt-panel">
      <div className="receipt-status-row">
        <span className={`receipt-status ${status.toLowerCase()}`}>{status}</span>
        <span className="infra-badge" data-tooltip="Cryptographically signed receipt with task hash, output hash, and payment proof">Verifiable</span>
        <a className="receipt-link" href={receiptUrl}>
          OPEN PROOF
        </a>
      </div>

      <div className="receipt-grid">
        <div className="receipt-item">
          <span>Receipt</span>
          <code>{shortHash(receipt.receiptHash)}</code>
        </div>
        <div className="receipt-item">
          <span>Task</span>
          <code>{shortHash(receipt.taskHash)}</code>
        </div>
        <div className="receipt-item">
          <span>Output</span>
          <code>{shortHash(receipt.outputHash)}</code>
        </div>
        <div className="receipt-item">
          <span>Spend</span>
          <code>{formatCusd(receipt.totalSpentStroops)} USDm</code>
        </div>
        <div className="receipt-item">
          <span>Signer</span>
          <code>{receipt.signature ? shortHash(receipt.signature.signer, 8, 6) : "UNSIGNED"}</code>
        </div>
        <div className="receipt-item">
          <span>Txs</span>
          <code>{receipt.txHashes.length}</code>
        </div>
      </div>

      {verification && verification.errors.length > 0 && (
        <div className="receipt-errors">
          {verification.errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      )}
    </div>
  );
}
