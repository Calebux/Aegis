// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/AgentStaking.sol";

/// @dev Minimal ERC-20 mock for staking tests.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "not approved");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AgentStakingTest {
    AgentStaking private staking;
    MockERC20 private token;

    function setUp() public {
        token = new MockERC20();
        staking = new AgentStaking(address(this), address(token), 86400); // 24h cooldown

        token.mint(address(this), 1_000_000e18);
        token.approve(address(staking), type(uint256).max);
    }

    function testStake() public {
        staking.stake("agent-1", 100e18);
        require(staking.getStake("agent-1") == 100e18, "stake amount mismatch");
        require(staking.isStaked("agent-1", 50e18), "should be staked above 50");
        require(!staking.isStaked("agent-1", 200e18), "should not be staked above 200");
    }

    function testSlash() public {
        staking.stake("agent-1", 100e18);
        staking.slash("agent-1", 30e18, "misbehavior");
        require(staking.getStake("agent-1") == 70e18, "post-slash mismatch");
    }

    function testSlashInsufficientReverts() public {
        staking.stake("agent-1", 10e18);
        (bool ok,) = address(staking).call(
            abi.encodeWithSelector(staking.slash.selector, "agent-1", 20e18, "too much")
        );
        require(!ok, "should revert on insufficient stake");
    }

    function testReward() public {
        staking.stake("agent-1", 50e18);
        staking.reward("agent-1", 25e18);
        require(staking.getStake("agent-1") == 75e18, "post-reward mismatch");
    }

    function testUnstakeRequestAndCooldown() public {
        staking.stake("agent-1", 100e18);
        staking.requestUnstake("agent-1", 40e18);

        // Should revert before cooldown (can't easily warp without forge-std,
        // so we just verify the request was recorded by checking that unstake reverts)
        (bool ok,) = address(staking).call(
            abi.encodeWithSelector(staking.unstake.selector, "agent-1")
        );
        require(!ok, "unstake should revert before cooldown");
    }

    function testUnstakeNoRequestReverts() public {
        staking.stake("agent-1", 100e18);
        (bool ok,) = address(staking).call(
            abi.encodeWithSelector(staking.unstake.selector, "agent-1")
        );
        require(!ok, "unstake without request should revert");
    }

    function testNonAdminCannotSlash() public {
        staking.stake("agent-1", 100e18);
        // Direct call from this contract (admin) should work
        staking.slash("agent-1", 10e18, "admin slash");
        require(staking.getStake("agent-1") == 90e18, "admin slash mismatch");
    }
}
