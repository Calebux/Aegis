// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ── Canonical ERC-8004 interfaces ────────────────────────────────────────────

interface IErc8004IdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 tokenId);
    function setAgentURI(uint256 tokenId, string calldata agentURI) external;
    function agentURI(uint256 tokenId) external view returns (string memory);
}

interface IErc8004ReputationRegistry {
    function giveFeedback(uint256 agentId, int256 value, string calldata tag) external;
}

/// @title Erc8004Adapter
/// @notice Bridge contract that registers Cal-AgentKit agents on canonical
///         ERC-8004 Identity and Reputation registries on Celo mainnet.
contract Erc8004Adapter {
    // ── State ────────────────────────────────────────────────────────────────

    address public immutable admin;
    IErc8004IdentityRegistry public immutable identityRegistry;
    IErc8004ReputationRegistry public immutable reputationRegistry;

    /// calagentKey (keccak256 of calagentId string) → ERC-8004 NFT token ID
    mapping(bytes32 => uint256) private _erc8004Ids;
    /// ERC-8004 NFT token ID → calagentKey
    mapping(uint256 => bytes32) private _calagentKeys;
    /// calagentKey → registered flag
    mapping(bytes32 => bool) private _registered;

    // ── Events ───────────────────────────────────────────────────────────────

    event AgentRegistered(string indexed calagentId, uint256 erc8004Id, string agentURI);
    event ReputationSynced(string indexed calagentId, uint256 erc8004Id, int256 value, string tag);
    event AgentURIUpdated(string indexed calagentId, uint256 erc8004Id, string newURI);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotAdmin();
    error AlreadyRegistered();
    error AgentNotRegistered();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address admin_,
        address identityRegistry_,
        address reputationRegistry_
    ) {
        admin = admin_;
        identityRegistry = IErc8004IdentityRegistry(identityRegistry_);
        reputationRegistry = IErc8004ReputationRegistry(reputationRegistry_);
    }

    // ── Write ────────────────────────────────────────────────────────────────

    /// @notice Register a Cal-AgentKit agent on the canonical ERC-8004 Identity Registry.
    /// @param calagentId The Cal-AgentKit agent identifier (e.g. "celo-scout").
    /// @param agentURI   The metadata URI for the agent (JSON endpoint).
    /// @return erc8004Id The ERC-8004 NFT token ID assigned to the agent.
    function registerAgent(
        string calldata calagentId,
        string calldata agentURI
    ) external onlyAdmin returns (uint256 erc8004Id) {
        bytes32 key = keccak256(bytes(calagentId));
        if (_registered[key]) revert AlreadyRegistered();

        erc8004Id = identityRegistry.register(agentURI);

        _erc8004Ids[key] = erc8004Id;
        _calagentKeys[erc8004Id] = key;
        _registered[key] = true;

        emit AgentRegistered(calagentId, erc8004Id, agentURI);
    }

    /// @notice Forward a reputation signal to the canonical ERC-8004 Reputation Registry.
    function syncReputation(
        string calldata calagentId,
        int256 value,
        string calldata tag
    ) external onlyAdmin {
        bytes32 key = keccak256(bytes(calagentId));
        if (!_registered[key]) revert AgentNotRegistered();

        uint256 erc8004Id = _erc8004Ids[key];
        reputationRegistry.giveFeedback(erc8004Id, value, tag);

        emit ReputationSynced(calagentId, erc8004Id, value, tag);
    }

    /// @notice Update the agent URI on the canonical ERC-8004 Identity Registry.
    function updateAgentURI(
        string calldata calagentId,
        string calldata newURI
    ) external onlyAdmin {
        bytes32 key = keccak256(bytes(calagentId));
        if (!_registered[key]) revert AgentNotRegistered();

        uint256 erc8004Id = _erc8004Ids[key];
        identityRegistry.setAgentURI(erc8004Id, newURI);

        emit AgentURIUpdated(calagentId, erc8004Id, newURI);
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /// @notice Get the ERC-8004 NFT token ID for a Cal-AgentKit agent.
    function getErc8004Id(string calldata calagentId) external view returns (uint256) {
        bytes32 key = keccak256(bytes(calagentId));
        if (!_registered[key]) revert AgentNotRegistered();
        return _erc8004Ids[key];
    }

    /// @notice Check whether a Cal-AgentKit agent has been registered on ERC-8004.
    function isRegistered(string calldata calagentId) external view returns (bool) {
        return _registered[keccak256(bytes(calagentId))];
    }
}
