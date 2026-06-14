"use client";

import { useState } from "react";

interface VerifyPanelProps {
  agentSigTxHashes: Record<string, string>;
  registryAddress: string;
  policyAddress: string;
  receiptId?: string;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="verify-copy-btn"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "COPIED" : "COPY"}
    </button>
  );
}

export function VerifyPanel({ agentSigTxHashes, registryAddress, policyAddress, receiptId }: VerifyPanelProps) {
  const sigTxs = Object.entries(agentSigTxHashes).filter(([, hash]) => hash);

  return (
    <div className="verify-panel">
      <div className="mod-header">
        VERIFY ON-CHAIN
        <span style={{ marginLeft: "auto", color: "var(--green)", fontSize: "0.55rem" }}>
          INDEPENDENT VERIFICATION
        </span>
      </div>
      <div style={{ padding: "1rem" }}>
        <p style={{ color: "var(--text-mid)", fontSize: "0.78rem", marginBottom: "1rem", lineHeight: 1.6 }}>
          Don&apos;t trust us &mdash; verify. Every pipeline run writes attestations to Celo mainnet.
          Use the links below to independently confirm each transaction on Celoscan.
        </p>

        {sigTxs.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: "0.5rem" }}>
              ATTESTATION TRANSACTIONS
            </div>
            {sigTxs.map(([agent, hash]) => (
              <div key={agent} className="verify-row">
                <span style={{ fontSize: "0.68rem", color: "var(--text-mid)", minWidth: 100 }}>{agent}</span>
                <a
                  href={`https://celoscan.io/tx/${hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="verify-tx-link"
                >
                  {hash.slice(0, 14)}...{hash.slice(-8)}
                </a>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: "0.5rem" }}>
          CONTRACTS
        </div>
        <div className="verify-row">
          <span style={{ fontSize: "0.68rem", color: "var(--text-mid)", minWidth: 100 }}>Registry</span>
          <code style={{ fontSize: "0.62rem", color: "var(--text-mid)", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
            {registryAddress}
          </code>
          <CopyBtn text={registryAddress} />
        </div>
        <div className="verify-row">
          <span style={{ fontSize: "0.68rem", color: "var(--text-mid)", minWidth: 100 }}>Policy</span>
          <code style={{ fontSize: "0.62rem", color: "var(--text-mid)", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
            {policyAddress}
          </code>
          <CopyBtn text={policyAddress} />
        </div>

        {receiptId && (
          <a
            href={`/receipts/${receiptId}`}
            style={{ display: "inline-block", marginTop: "0.75rem", fontSize: "0.68rem", color: "var(--accent)", textDecoration: "none" }}
          >
            View full receipt &rarr;
          </a>
        )}
      </div>
    </div>
  );
}
