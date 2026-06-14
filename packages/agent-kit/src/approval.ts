/**
 * Human Approval Gateway
 *
 * Enforces human-in-the-loop approval for high-value agent operations.
 * Uses the `requireApprovalAbove` threshold from AgentPolicyConstraints.
 */

import type { AgentPolicyConstraints } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "denied";

export interface ApprovalRequest {
  id: string;
  agentId: string;
  task: string;
  amount: bigint;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class ApprovalRequiredError extends Error {
  public readonly approvalId: string;
  public readonly agentId: string;
  public readonly amount: bigint;

  constructor(approvalId: string, agentId: string, amount: bigint) {
    super(
      `Approval required for agent "${agentId}" — amount ${amount} exceeds threshold. Approval ID: ${approvalId}`
    );
    this.name = "ApprovalRequiredError";
    this.approvalId = approvalId;
    this.agentId = agentId;
    this.amount = amount;
  }
}

// ── ApprovalGateway ───────────────────────────────────────────────────────────

export class ApprovalGateway {
  private requests = new Map<string, ApprovalRequest>();
  private nextId = 1;

  /** Check if an operation requires approval based on policy. */
  requiresApproval(
    agentId: string,
    amount: bigint,
    policy?: AgentPolicyConstraints
  ): boolean {
    if (!policy?.requireApprovalAbove) return false;
    return amount > policy.requireApprovalAbove;
  }

  /** Create a pending approval request. */
  requestApproval(
    agentId: string,
    task: string,
    amount: bigint
  ): ApprovalRequest {
    const id = `approval-${this.nextId++}`;
    const request: ApprovalRequest = {
      id,
      agentId,
      task,
      amount,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.requests.set(id, request);
    return request;
  }

  /** Approve a pending request. */
  approveRequest(approvalId: string, approvedBy?: string): ApprovalRequest {
    const request = this.requests.get(approvalId);
    if (!request) throw new Error(`Approval request "${approvalId}" not found`);
    if (request.status !== "pending") {
      throw new Error(`Approval request "${approvalId}" is already ${request.status}`);
    }
    request.status = "approved";
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = approvedBy;
    return request;
  }

  /** Deny a pending request. */
  denyRequest(approvalId: string, deniedBy?: string): ApprovalRequest {
    const request = this.requests.get(approvalId);
    if (!request) throw new Error(`Approval request "${approvalId}" not found`);
    if (request.status !== "pending") {
      throw new Error(`Approval request "${approvalId}" is already ${request.status}`);
    }
    request.status = "denied";
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = deniedBy;
    return request;
  }

  /** Get all pending approval requests. */
  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) => r.status === "pending"
    );
  }

  /** Get a specific approval request by ID. */
  getApproval(approvalId: string): ApprovalRequest | undefined {
    return this.requests.get(approvalId);
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────────

/**
 * Creates a middleware function that checks approval thresholds.
 * Throws ApprovalRequiredError if the amount exceeds the threshold
 * and no prior approval exists.
 */
export function approvalMiddleware(
  gateway: ApprovalGateway,
  threshold: bigint
): (agentId: string, task: string, amount: bigint) => void {
  const policy: AgentPolicyConstraints = { requireApprovalAbove: threshold };

  return (agentId: string, task: string, amount: bigint) => {
    if (!gateway.requiresApproval(agentId, amount, policy)) return;

    // Check if there's already an approved request for this agent+task
    const pending = gateway.getPendingApprovals();
    const existing = pending.find(
      (r) => r.agentId === agentId && r.task === task
    );
    if (existing) {
      throw new ApprovalRequiredError(existing.id, agentId, amount);
    }

    const request = gateway.requestApproval(agentId, task, amount);
    throw new ApprovalRequiredError(request.id, agentId, amount);
  };
}
