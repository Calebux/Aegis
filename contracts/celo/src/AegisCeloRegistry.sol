// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AegisCeloRegistry
/// @notice EVM/Celo counterpart to the Aegis identity registry.
contract AegisCeloRegistry {
    struct AgentIdentity {
        string name;
        string capability;
        bytes32 manifestHash;
        uint256 reputation;
        uint256 tasksCompleted;
        uint256 tasksFailed;
        uint256 registeredAt;
        bool registered;
    }

    address public immutable admin;
    mapping(bytes32 => AgentIdentity) private agents;
    string[] private agentIds;

    event AgentRegistered(string indexed agentId, string name, string capability);
    event ManifestHashSet(string indexed agentId, bytes32 manifestHash);
    event ReputationUpdated(string indexed agentId, uint256 reputation, bool success);

    error NotAdmin();
    error AlreadyRegistered();
    error AgentNotFound();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        admin = admin_;
    }

    function registerAgent(
        string calldata agentId,
        string calldata name,
        string calldata capability,
        bytes32 manifestHash
    ) external onlyAdmin {
        bytes32 key = keccak256(bytes(agentId));
        if (agents[key].registered) revert AlreadyRegistered();

        agents[key] = AgentIdentity({
            name: name,
            capability: capability,
            manifestHash: manifestHash,
            reputation: 0,
            tasksCompleted: 0,
            tasksFailed: 0,
            registeredAt: block.timestamp,
            registered: true
        });
        agentIds.push(agentId);

        emit AgentRegistered(agentId, name, capability);
        emit ManifestHashSet(agentId, manifestHash);
    }

    function setManifestHash(string calldata agentId, bytes32 manifestHash) external onlyAdmin {
        AgentIdentity storage agent = _agent(agentId);
        agent.manifestHash = manifestHash;
        emit ManifestHashSet(agentId, manifestHash);
    }

    function recordSuccess(string calldata agentId) external onlyAdmin {
        AgentIdentity storage agent = _agent(agentId);
        agent.tasksCompleted += 1;
        agent.reputation += 10;
        emit ReputationUpdated(agentId, agent.reputation, true);
    }

    function recordFailure(string calldata agentId) external onlyAdmin {
        AgentIdentity storage agent = _agent(agentId);
        agent.tasksFailed += 1;
        agent.reputation = agent.reputation > 5 ? agent.reputation - 5 : 0;
        emit ReputationUpdated(agentId, agent.reputation, false);
    }

    function getAgent(string calldata agentId) external view returns (AgentIdentity memory) {
        return _agentView(agentId);
    }

    function getManifestHash(string calldata agentId) external view returns (bytes32) {
        return _agentView(agentId).manifestHash;
    }

    function listAgents() external view returns (string[] memory) {
        return agentIds;
    }

    function _agent(string calldata agentId) private view returns (AgentIdentity storage) {
        bytes32 key = keccak256(bytes(agentId));
        if (!agents[key].registered) revert AgentNotFound();
        return agents[key];
    }

    function _agentView(string calldata agentId) private view returns (AgentIdentity memory) {
        bytes32 key = keccak256(bytes(agentId));
        if (!agents[key].registered) revert AgentNotFound();
        return agents[key];
    }
}
