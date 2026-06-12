// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/AegisCeloRegistry.sol";
import "../src/AegisCeloPolicy.sol";

contract AegisCeloTest {
    AegisCeloRegistry private registry;
    AegisCeloPolicy private policy;

    function setUp() public {
        registry = new AegisCeloRegistry(address(this));
        policy = new AegisCeloPolicy(address(this));
    }

    function testRegistryLifecycle() public {
        bytes32 manifestHash = bytes32(uint256(0x1234));

        registry.registerAgent("celo-ledger", "Celo Ledger", "celo", manifestHash);

        AegisCeloRegistry.AgentIdentity memory agent = registry.getAgent("celo-ledger");
        require(agent.registered, "agent not registered");
        require(agent.manifestHash == manifestHash, "manifest hash mismatch");
        require(agent.reputation == 0, "initial reputation mismatch");

        registry.recordSuccess("celo-ledger");
        agent = registry.getAgent("celo-ledger");
        require(agent.tasksCompleted == 1, "success count mismatch");
        require(agent.reputation == 10, "success reputation mismatch");

        registry.recordFailure("celo-ledger");
        agent = registry.getAgent("celo-ledger");
        require(agent.tasksFailed == 1, "failure count mismatch");
        require(agent.reputation == 5, "failure reputation mismatch");

        bytes32 nextHash = bytes32(uint256(0x5678));
        registry.setManifestHash("celo-ledger", nextHash);
        require(registry.getManifestHash("celo-ledger") == nextHash, "updated hash mismatch");
    }

    function testRegistryListsAgents() public {
        registry.registerAgent("celo-ledger", "Celo Ledger", "celo", bytes32(uint256(1)));
        registry.registerAgent("celo-notary", "Celo Notary", "proof", bytes32(uint256(2)));

        string[] memory ids = registry.listAgents();
        require(ids.length == 2, "agent list length mismatch");
        require(
            keccak256(bytes(ids[0])) == keccak256(bytes("celo-ledger")),
            "first agent mismatch"
        );
        require(
            keccak256(bytes(ids[1])) == keccak256(bytes("celo-notary")),
            "second agent mismatch"
        );
    }

    function testPolicyAuthorizesSpendWithinCaps() public {
        bytes32 sessionId = keccak256("session-1");
        address asset = address(0x1234);

        policy.setPolicy("celo-ledger", 100, 250);
        policy.authorizeSpend("celo-ledger", sessionId, asset, 100);
        policy.authorizeSpend("celo-ledger", sessionId, asset, 50);

        bytes32 agentKey = keccak256(bytes("celo-ledger"));
        bytes32 sessionKey = keccak256(abi.encodePacked(agentKey, sessionId, asset));
        require(policy.sessionSpent(sessionKey) == 150, "session spend mismatch");
    }

    function testPolicyRejectsInactivePolicy() public {
        (bool ok,) = address(policy).call(
            abi.encodeWithSelector(
                policy.authorizeSpend.selector,
                "unknown",
                keccak256("session"),
                address(0x1234),
                1
            )
        );
        require(!ok, "inactive policy should fail");
    }

    function testPolicyRejectsSpendAboveCaps() public {
        bytes32 sessionId = keccak256("session-2");
        address asset = address(0x1234);
        policy.setPolicy("celo-ledger", 100, 150);

        (bool taskOk,) = address(policy).call(
            abi.encodeWithSelector(
                policy.authorizeSpend.selector,
                "celo-ledger",
                sessionId,
                asset,
                101
            )
        );
        require(!taskOk, "per-task cap should fail");

        policy.authorizeSpend("celo-ledger", sessionId, asset, 100);
        (bool sessionOk,) = address(policy).call(
            abi.encodeWithSelector(
                policy.authorizeSpend.selector,
                "celo-ledger",
                sessionId,
                asset,
                51
            )
        );
        require(!sessionOk, "per-session cap should fail");
    }
}
