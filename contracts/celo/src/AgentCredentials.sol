// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentCredentials
/// @notice Credential management for Cal-AgentKit agents — grants scoped,
///         time-limited credentials that gate access to services.
contract AgentCredentials {
    struct Credential {
        string scope;
        uint256 grantedAt;
        uint256 expiresAt;
        bool active;
    }

    address public immutable admin;

    /// keccak256(abi.encodePacked(agentId, service)) => Credential
    mapping(bytes32 => Credential) private credentials;

    event CredentialGranted(string indexed agentId, string service, string scope, uint256 expiresAt);
    event CredentialRevoked(string indexed agentId, string service);

    error NotAdmin();
    error CredentialNotFound();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        admin = admin_;
    }

    /// @notice Grant a credential to an agent for a specific service.
    /// @param agentId  The agent identifier.
    /// @param service  The service this credential authorizes (e.g. "defi", "oracle").
    /// @param scope    Scope descriptor (e.g. "read", "read+write").
    /// @param expiry   Unix timestamp when the credential expires (0 = no expiry).
    function grantCredential(
        string calldata agentId,
        string calldata service,
        string calldata scope,
        uint256 expiry
    ) external onlyAdmin {
        bytes32 key = keccak256(abi.encodePacked(agentId, service));
        credentials[key] = Credential({
            scope: scope,
            grantedAt: block.timestamp,
            expiresAt: expiry,
            active: true
        });

        emit CredentialGranted(agentId, service, scope, expiry);
    }

    /// @notice Revoke a credential.
    function revokeCredential(
        string calldata agentId,
        string calldata service
    ) external onlyAdmin {
        bytes32 key = keccak256(abi.encodePacked(agentId, service));
        if (!credentials[key].active) revert CredentialNotFound();

        credentials[key].active = false;

        emit CredentialRevoked(agentId, service);
    }

    /// @notice Check if an agent has a valid (active + not expired) credential.
    function hasCredential(
        string calldata agentId,
        string calldata service
    ) external view returns (bool) {
        bytes32 key = keccak256(abi.encodePacked(agentId, service));
        Credential storage cred = credentials[key];
        if (!cred.active) return false;
        if (cred.expiresAt != 0 && block.timestamp > cred.expiresAt) return false;
        return true;
    }

    /// @notice Get full credential details.
    function getCredential(
        string calldata agentId,
        string calldata service
    ) external view returns (string memory scope, uint256 grantedAt, uint256 expiresAt, bool active) {
        bytes32 key = keccak256(abi.encodePacked(agentId, service));
        Credential storage cred = credentials[key];
        return (cred.scope, cred.grantedAt, cred.expiresAt, cred.active);
    }
}
