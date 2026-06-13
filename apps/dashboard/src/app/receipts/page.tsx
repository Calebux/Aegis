import { receipts } from "@/lib/taskStore";

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function cusd(wei: number): string {
  return `${(wei / 1e18).toFixed(4)} cUSD`;
}

export default function ReceiptsPage() {
  const unique = new Map(
    Array.from(receipts.values()).map((receipt) => [receipt.receiptHash, receipt])
  );
  const list = Array.from(unique.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="receipt-page">
      <div className="module receipt-page-title">
        <h1>Run Receipts</h1>
        <p>Public proof index for Cal-AgentKit agent executions.</p>
      </div>

      <div className="module">
        <div className="mod-header">
          RECEIPTS
          <span style={{ marginLeft: "auto" }}>{list.length}</span>
        </div>
        <table className="receipt-detail-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Task</th>
              <th>Receipt</th>
              <th>Spend</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={5}>No receipts yet.</td>
              </tr>
            ) : (
              list.map((receipt) => (
                <tr key={receipt.receiptHash}>
                  <td>
                    <a className="receipt-link" href={`/receipts/${receipt.runId}`}>
                      {shortHash(receipt.runId)}
                    </a>
                  </td>
                  <td>{receipt.task}</td>
                  <td>{shortHash(receipt.receiptHash)}</td>
                  <td>{cusd(receipt.totalSpentStroops)}</td>
                  <td>{receipt.createdAt}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
