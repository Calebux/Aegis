/**
 * Agent Delegation / Sub-Orchestration
 *
 * Enables parent agents to delegate tasks to child agents with linked receipt chains.
 */

import { createHash } from "node:crypto";

export interface DelegationOptions {
  /** Maximum spend budget inherited from parent (in base units). */
  maxSpend?: bigint;
  /** Custom metadata attached to the delegation receipt. */
  metadata?: Record<string, unknown>;
}

export interface DelegationResult {
  parentRunId: string;
  childRunId: string;
  parentAgentId: string;
  childAgentId: string;
  task: string;
  delegatedAt: string;
  receiptHash: string;
}

/**
 * Create a delegation record linking a parent agent run to a child agent task.
 * Returns a `DelegationResult` that can be embedded in receipts for traceability.
 */
export function delegateTask(
  parentAgentId: string,
  childAgentId: string,
  task: string,
  parentRunId: string,
  options?: DelegationOptions
): DelegationResult {
  const childRunId = crypto.randomUUID();
  const delegatedAt = new Date().toISOString();

  const receiptHash = createHash("sha256")
    .update(`${parentRunId}:${childRunId}:${parentAgentId}:${childAgentId}:${task}`)
    .digest("hex");

  return {
    parentRunId,
    childRunId,
    parentAgentId,
    childAgentId,
    task,
    delegatedAt,
    receiptHash,
  };
}

export interface SubOrchestratorOptions {
  /** Parent run ID for receipt chain linking. */
  parentRunId: string;
  /** Parent agent ID. */
  parentAgentId: string;
  /** Inherited spend budget (base units). */
  maxSpend?: bigint;
}

/**
 * Create a sub-orchestrator context that inherits the parent's identity
 * and budget. Each child task produces a `DelegationResult` linked back
 * to the parent.
 */
export function createSubOrchestrator(
  childAgentIds: string[],
  options: SubOrchestratorOptions
) {
  const { parentRunId, parentAgentId, maxSpend } = options;
  let totalSpent = 0n;

  return {
    parentRunId,
    parentAgentId,
    childAgentIds,

    /** Delegate a task to a specific child agent. */
    delegate(childAgentId: string, task: string): DelegationResult {
      if (!childAgentIds.includes(childAgentId)) {
        throw new Error(
          `Child agent "${childAgentId}" is not in this sub-orchestrator's agent list`
        );
      }
      return delegateTask(parentAgentId, childAgentId, task, parentRunId, {
        maxSpend,
      });
    },

    /** Track spend against the inherited budget. Returns false if over budget. */
    recordSpend(amount: bigint): boolean {
      if (maxSpend !== undefined && totalSpent + amount > maxSpend) {
        return false;
      }
      totalSpent += amount;
      return true;
    },

    /** Current total spent by child agents. */
    get spent(): bigint {
      return totalSpent;
    },

    /** Remaining budget. */
    get remaining(): bigint | undefined {
      return maxSpend !== undefined ? maxSpend - totalSpent : undefined;
    },
  };
}
