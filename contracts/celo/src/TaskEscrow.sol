// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ERC-20 interface for escrow transfers.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title TaskEscrow
/// @notice USDm escrow for agent tasks with conditional release on verified receipt.
contract TaskEscrow {
    struct Escrow {
        address depositor;
        string agentId;
        uint256 amount;
        bytes32 taskHash;
        bool released;
        uint256 deadline;
    }

    address public immutable admin;
    IERC20 public immutable token;

    uint256 public nextEscrowId;
    mapping(uint256 => Escrow) private escrows;

    event EscrowCreated(uint256 indexed escrowId, address indexed depositor, string agentId, uint256 amount, bytes32 taskHash, uint256 deadline);
    event EscrowReleased(uint256 indexed escrowId, bytes32 receiptHash);
    event EscrowRefunded(uint256 indexed escrowId);

    error NotAdmin();
    error EscrowAlreadyReleased();
    error DeadlineNotPassed();
    error DeadlinePassed();
    error TransferFailed();
    error InvalidEscrow();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_, address tokenAddress_) {
        admin = admin_;
        token = IERC20(tokenAddress_);
    }

    /// @notice Create an escrow. Caller deposits USDm for a task.
    function createEscrow(
        bytes32 taskHash,
        string calldata agentId,
        uint256 amount,
        uint256 deadline
    ) external returns (uint256 escrowId) {
        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        escrowId = nextEscrowId++;
        escrows[escrowId] = Escrow({
            depositor: msg.sender,
            agentId: agentId,
            amount: amount,
            taskHash: taskHash,
            released: false,
            deadline: deadline
        });

        emit EscrowCreated(escrowId, msg.sender, agentId, amount, taskHash, deadline);
    }

    /// @notice Admin releases escrowed funds to agent after verifying receipt.
    function releaseEscrow(uint256 escrowId, bytes32 receiptHash) external onlyAdmin {
        Escrow storage e = escrows[escrowId];
        if (e.amount == 0) revert InvalidEscrow();
        if (e.released) revert EscrowAlreadyReleased();
        if (block.timestamp > e.deadline) revert DeadlinePassed();

        e.released = true;

        // In a production system the agent address would be resolved from agentId.
        // Here we send to admin who distributes to the agent off-chain.
        bool ok = token.transfer(admin, e.amount);
        if (!ok) revert TransferFailed();

        emit EscrowReleased(escrowId, receiptHash);
    }

    /// @notice Refund escrowed funds to depositor if deadline has passed and not released.
    function refundEscrow(uint256 escrowId) external {
        Escrow storage e = escrows[escrowId];
        if (e.amount == 0) revert InvalidEscrow();
        if (e.released) revert EscrowAlreadyReleased();
        if (block.timestamp <= e.deadline) revert DeadlineNotPassed();

        e.released = true;

        bool ok = token.transfer(e.depositor, e.amount);
        if (!ok) revert TransferFailed();

        emit EscrowRefunded(escrowId);
    }

    /// @notice Get escrow details.
    function getEscrow(uint256 escrowId)
        external
        view
        returns (
            address depositor,
            string memory agentId,
            uint256 amount,
            bytes32 taskHash,
            bool released,
            uint256 deadline
        )
    {
        Escrow storage e = escrows[escrowId];
        return (e.depositor, e.agentId, e.amount, e.taskHash, e.released, e.deadline);
    }
}
