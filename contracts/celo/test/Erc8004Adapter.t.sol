// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/Erc8004Adapter.sol";

// ── Mock ERC-8004 Identity Registry ──────────────────────────────────────────

contract MockIdentityRegistry {
    uint256 private _nextId = 1;
    mapping(uint256 => string) private _uris;

    function register(string calldata agentURI) external returns (uint256 tokenId) {
        tokenId = _nextId++;
        _uris[tokenId] = agentURI;
    }

    function setAgentURI(uint256 tokenId, string calldata agentURI) external {
        _uris[tokenId] = agentURI;
    }

    function agentURI(uint256 tokenId) external view returns (string memory) {
        return _uris[tokenId];
    }
}

// ── Mock ERC-8004 Reputation Registry ────────────────────────────────────────

contract MockReputationRegistry {
    struct Feedback {
        uint256 agentId;
        int256 value;
        string tag;
    }

    Feedback[] public feedbacks;

    function giveFeedback(uint256 agentId, int256 value, string calldata tag) external {
        feedbacks.push(Feedback(agentId, value, tag));
    }

    function feedbackCount() external view returns (uint256) {
        return feedbacks.length;
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

contract Erc8004AdapterTest {
    MockIdentityRegistry private identity;
    MockReputationRegistry private reputation;
    Erc8004Adapter private adapter;

    function setUp() public {
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();
        adapter = new Erc8004Adapter(
            address(this),
            address(identity),
            address(reputation)
        );
    }

    function testRegisterAgent() public {
        uint256 id = adapter.registerAgent("celo-scout", "https://example.com/agents/celo-scout/uri");
        require(id == 1, "first agent should get id 1");
        require(adapter.isRegistered("celo-scout"), "agent should be registered");
        require(adapter.getErc8004Id("celo-scout") == 1, "erc8004 id mismatch");

        // Verify URI was stored in identity registry
        string memory uri = identity.agentURI(1);
        require(
            keccak256(bytes(uri)) == keccak256(bytes("https://example.com/agents/celo-scout/uri")),
            "uri mismatch"
        );
    }

    function testRegisterMultipleAgents() public {
        uint256 id1 = adapter.registerAgent("celo-scout", "https://example.com/agents/celo-scout/uri");
        uint256 id2 = adapter.registerAgent("celo-ledger", "https://example.com/agents/celo-ledger/uri");

        require(id1 == 1, "first id mismatch");
        require(id2 == 2, "second id mismatch");
        require(adapter.isRegistered("celo-scout"), "scout not registered");
        require(adapter.isRegistered("celo-ledger"), "ledger not registered");
    }

    function testDuplicateRegisterReverts() public {
        adapter.registerAgent("celo-scout", "https://example.com/agents/celo-scout/uri");

        (bool ok,) = address(adapter).call(
            abi.encodeWithSelector(
                adapter.registerAgent.selector,
                "celo-scout",
                "https://example.com/agents/celo-scout/uri"
            )
        );
        require(!ok, "duplicate register should revert");
    }

    function testSyncReputation() public {
        adapter.registerAgent("celo-scout", "https://example.com/agents/celo-scout/uri");
        adapter.syncReputation("celo-scout", 10, "task-success");

        require(reputation.feedbackCount() == 1, "feedback count mismatch");
        (uint256 agentId, int256 value, string memory tag) = reputation.feedbacks(0);
        require(agentId == 1, "feedback agent id mismatch");
        require(value == 10, "feedback value mismatch");
        require(keccak256(bytes(tag)) == keccak256(bytes("task-success")), "feedback tag mismatch");
    }

    function testSyncReputationUnregisteredReverts() public {
        (bool ok,) = address(adapter).call(
            abi.encodeWithSelector(
                adapter.syncReputation.selector,
                "unknown-agent",
                int256(10),
                "test"
            )
        );
        require(!ok, "sync for unregistered agent should revert");
    }

    function testUpdateAgentURI() public {
        adapter.registerAgent("celo-scout", "https://example.com/old-uri");
        adapter.updateAgentURI("celo-scout", "https://example.com/new-uri");

        string memory uri = identity.agentURI(1);
        require(
            keccak256(bytes(uri)) == keccak256(bytes("https://example.com/new-uri")),
            "updated uri mismatch"
        );
    }

    function testUpdateAgentURIUnregisteredReverts() public {
        (bool ok,) = address(adapter).call(
            abi.encodeWithSelector(
                adapter.updateAgentURI.selector,
                "unknown-agent",
                "https://example.com/uri"
            )
        );
        require(!ok, "update uri for unregistered agent should revert");
    }

    function testNonAdminReverts() public {
        // Deploy a fresh adapter with a different admin
        Erc8004Adapter restricted = new Erc8004Adapter(
            address(0xdead),
            address(identity),
            address(reputation)
        );

        (bool ok,) = address(restricted).call(
            abi.encodeWithSelector(
                restricted.registerAgent.selector,
                "celo-scout",
                "https://example.com/uri"
            )
        );
        require(!ok, "non-admin register should revert");
    }
}
