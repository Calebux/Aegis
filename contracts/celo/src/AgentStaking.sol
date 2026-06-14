// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ERC-20 interface for staking.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title AgentStaking
/// @notice USDm (ERC-20) staking for Cal-AgentKit agents with slash/reward mechanics.
contract AgentStaking {
    struct StakeInfo {
        uint256 amount;
        uint256 unstakeRequestedAt;
        uint256 unstakeAmount;
    }

    address public immutable admin;
    IERC20 public immutable token;
    uint256 public immutable cooldownSeconds;

    mapping(bytes32 => StakeInfo) private stakes;

    event Staked(string indexed agentId, uint256 amount, uint256 totalStake);
    event Unstaked(string indexed agentId, uint256 amount, uint256 totalStake);
    event UnstakeRequested(string indexed agentId, uint256 amount, uint256 availableAt);
    event Slashed(string indexed agentId, uint256 amount, string reason, uint256 totalStake);
    event Rewarded(string indexed agentId, uint256 amount, uint256 totalStake);

    error NotAdmin();
    error InsufficientStake();
    error CooldownNotElapsed();
    error NoUnstakePending();
    error TransferFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_, address tokenAddress_, uint256 cooldownSeconds_) {
        admin = admin_;
        token = IERC20(tokenAddress_);
        cooldownSeconds = cooldownSeconds_;
    }

    /// @notice Stake USDm for an agent. Caller must have approved this contract.
    function stake(string calldata agentId, uint256 amount) external {
        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        bytes32 key = keccak256(bytes(agentId));
        stakes[key].amount += amount;

        emit Staked(agentId, amount, stakes[key].amount);
    }

    /// @notice Request an unstake. Must wait cooldown before calling `unstake`.
    function requestUnstake(string calldata agentId, uint256 amount) external onlyAdmin {
        bytes32 key = keccak256(bytes(agentId));
        if (stakes[key].amount < amount) revert InsufficientStake();

        stakes[key].unstakeRequestedAt = block.timestamp;
        stakes[key].unstakeAmount = amount;

        emit UnstakeRequested(agentId, amount, block.timestamp + cooldownSeconds);
    }

    /// @notice Withdraw staked tokens after cooldown has elapsed.
    function unstake(string calldata agentId) external onlyAdmin {
        bytes32 key = keccak256(bytes(agentId));
        if (stakes[key].unstakeAmount == 0) revert NoUnstakePending();
        if (block.timestamp < stakes[key].unstakeRequestedAt + cooldownSeconds) {
            revert CooldownNotElapsed();
        }

        uint256 amount = stakes[key].unstakeAmount;
        stakes[key].amount -= amount;
        stakes[key].unstakeAmount = 0;
        stakes[key].unstakeRequestedAt = 0;

        bool ok = token.transfer(admin, amount);
        if (!ok) revert TransferFailed();

        emit Unstaked(agentId, amount, stakes[key].amount);
    }

    /// @notice Admin slashes an agent's stake for misbehavior.
    function slash(string calldata agentId, uint256 amount, string calldata reason) external onlyAdmin {
        bytes32 key = keccak256(bytes(agentId));
        if (stakes[key].amount < amount) revert InsufficientStake();

        stakes[key].amount -= amount;

        emit Slashed(agentId, amount, reason, stakes[key].amount);
    }

    /// @notice Admin rewards an agent by adding to their stake.
    function reward(string calldata agentId, uint256 amount) external onlyAdmin {
        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        bytes32 key = keccak256(bytes(agentId));
        stakes[key].amount += amount;

        emit Rewarded(agentId, amount, stakes[key].amount);
    }

    /// @notice Get the current stake for an agent.
    function getStake(string calldata agentId) external view returns (uint256) {
        return stakes[keccak256(bytes(agentId))].amount;
    }

    /// @notice Check if an agent meets a minimum stake threshold.
    function isStaked(string calldata agentId, uint256 minAmount) external view returns (bool) {
        return stakes[keccak256(bytes(agentId))].amount >= minAmount;
    }
}
