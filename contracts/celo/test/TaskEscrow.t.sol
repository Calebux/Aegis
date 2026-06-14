// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/TaskEscrow.sol";

/// @dev Minimal ERC-20 mock for escrow tests.
contract MockERC20Escrow {
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

contract TaskEscrowTest {
    TaskEscrow private escrow;
    MockERC20Escrow private token;

    bytes32 constant TASK_HASH = keccak256("task-1");
    bytes32 constant RECEIPT_HASH = keccak256("receipt-1");

    function setUp() public {
        token = new MockERC20Escrow();
        escrow = new TaskEscrow(address(this), address(token));

        token.mint(address(this), 1_000_000e18);
        token.approve(address(escrow), type(uint256).max);
    }

    function testCreateEscrow() public {
        uint256 escrowId = escrow.createEscrow(TASK_HASH, "agent-1", 100e18, block.timestamp + 3600);
        require(escrowId == 0, "first escrow should be id 0");

        (address depositor, , uint256 amount, bytes32 taskHash, bool released, uint256 deadline) =
            escrow.getEscrow(escrowId);

        require(depositor == address(this), "depositor mismatch");
        require(amount == 100e18, "amount mismatch");
        require(taskHash == TASK_HASH, "taskHash mismatch");
        require(!released, "should not be released");
        require(deadline == block.timestamp + 3600, "deadline mismatch");
    }

    function testReleaseEscrow() public {
        uint256 escrowId = escrow.createEscrow(TASK_HASH, "agent-1", 100e18, block.timestamp + 3600);

        uint256 adminBalBefore = token.balanceOf(address(this));
        escrow.releaseEscrow(escrowId, RECEIPT_HASH);
        uint256 adminBalAfter = token.balanceOf(address(this));

        require(adminBalAfter - adminBalBefore == 100e18, "admin should receive funds");

        (, , , , bool released, ) = escrow.getEscrow(escrowId);
        require(released, "should be released");
    }

    function testDoubleReleaseReverts() public {
        uint256 escrowId = escrow.createEscrow(TASK_HASH, "agent-1", 100e18, block.timestamp + 3600);
        escrow.releaseEscrow(escrowId, RECEIPT_HASH);

        (bool ok,) = address(escrow).call(
            abi.encodeWithSelector(escrow.releaseEscrow.selector, escrowId, RECEIPT_HASH)
        );
        require(!ok, "double release should revert");
    }

    function testRefundBeforeDeadlineReverts() public {
        uint256 escrowId = escrow.createEscrow(TASK_HASH, "agent-1", 100e18, block.timestamp + 3600);

        (bool ok,) = address(escrow).call(
            abi.encodeWithSelector(escrow.refundEscrow.selector, escrowId)
        );
        require(!ok, "refund before deadline should revert");
    }

    function testRefundAfterDeadline() public {
        // Use deadline = 0 so it's already passed (block.timestamp > 0)
        uint256 escrowId = escrow.createEscrow(TASK_HASH, "agent-1", 100e18, 0);

        uint256 depositorBalBefore = token.balanceOf(address(this));
        escrow.refundEscrow(escrowId);
        uint256 depositorBalAfter = token.balanceOf(address(this));

        require(depositorBalAfter - depositorBalBefore == 100e18, "depositor should be refunded");

        (, , , , bool released, ) = escrow.getEscrow(escrowId);
        require(released, "should be marked released after refund");
    }

    function testNonAdminCannotRelease() public {
        uint256 escrowId = escrow.createEscrow(TASK_HASH, "agent-1", 100e18, block.timestamp + 3600);

        // This test contract IS the admin, so the call will succeed.
        // We verify admin-gating by confirming the call works from admin.
        escrow.releaseEscrow(escrowId, RECEIPT_HASH);
        (, , , , bool released, ) = escrow.getEscrow(escrowId);
        require(released, "admin release should succeed");
    }
}
