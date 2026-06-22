// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CalagentCeloPolicy
/// @notice Minimal Celo spend policy contract for agent execution.
contract CalagentCeloPolicy {
    struct Policy {
        uint256 maxSpendPerTask;
        uint256 maxSpendPerSession;
        bool active;
    }

    address public immutable admin;
    mapping(bytes32 => Policy) public policies;
    mapping(bytes32 => uint256) public sessionSpent;

    event PolicySet(string indexed agentId, uint256 maxSpendPerTask, uint256 maxSpendPerSession);
    event SpendAuthorized(string indexed agentId, bytes32 indexed sessionId, address asset, uint256 amount);
    event PolicyRevoked(string indexed agentId);

    error NotAdmin();
    error PolicyInactive();
    error SpendCapExceeded();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        admin = admin_;
    }

    function setPolicy(
        string calldata agentId,
        uint256 maxSpendPerTask,
        uint256 maxSpendPerSession
    ) external onlyAdmin {
        policies[keccak256(bytes(agentId))] = Policy({
            maxSpendPerTask: maxSpendPerTask,
            maxSpendPerSession: maxSpendPerSession,
            active: true
        });
        emit PolicySet(agentId, maxSpendPerTask, maxSpendPerSession);
    }

    function revokePolicy(string calldata agentId) external onlyAdmin {
        policies[keccak256(bytes(agentId))].active = false;
        emit PolicyRevoked(agentId);
    }

    function authorizeSpend(
        string calldata agentId,
        bytes32 sessionId,
        address asset,
        uint256 amount
    ) external onlyAdmin {
        bytes32 agentKey = keccak256(bytes(agentId));
        Policy memory policy = policies[agentKey];
        if (!policy.active) revert PolicyInactive();
        if (amount > policy.maxSpendPerTask) revert SpendCapExceeded();

        bytes32 sessionKey = keccak256(abi.encodePacked(agentKey, sessionId, asset));
        uint256 nextSpent = sessionSpent[sessionKey] + amount;
        if (nextSpent > policy.maxSpendPerSession) revert SpendCapExceeded();

        sessionSpent[sessionKey] = nextSpent;
        emit SpendAuthorized(agentId, sessionId, asset, amount);
    }
}
