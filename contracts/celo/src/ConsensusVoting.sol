// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ConsensusVoting
/// @notice On-chain consensus voting for Cal-AgentKit multi-agent pipelines.
contract ConsensusVoting {
    struct Vote {
        string agentId;
        bytes32 outputHash;
        uint256 confidence; // basis points (0–10000)
    }

    struct Round {
        bytes32 taskHash;
        bool finalized;
        bytes32 resultHash;
        uint256 voteCount;
        uint256 createdAt;
    }

    address public immutable admin;
    uint256 public nextRoundId;

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Vote[]) private roundVotes;
    // roundId => agentKey => voted
    mapping(uint256 => mapping(bytes32 => bool)) private hasVoted;

    event RoundOpened(uint256 indexed roundId, bytes32 taskHash);
    event VoteSubmitted(uint256 indexed roundId, string agentId, bytes32 outputHash, uint256 confidence);
    event RoundFinalized(uint256 indexed roundId, bytes32 resultHash, uint256 voteCount);

    error NotAdmin();
    error RoundNotFound();
    error RoundAlreadyFinalized();
    error DuplicateVote();
    error NoVotes();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        admin = admin_;
    }

    /// @notice Open a new voting round for a task.
    function openRound(bytes32 taskHash) external onlyAdmin returns (uint256 roundId) {
        roundId = nextRoundId++;
        rounds[roundId] = Round({
            taskHash: taskHash,
            finalized: false,
            resultHash: bytes32(0),
            voteCount: 0,
            createdAt: block.timestamp
        });

        emit RoundOpened(roundId, taskHash);
    }

    /// @notice Submit a vote for a round. Each agent can vote once.
    function submitVote(
        uint256 roundId,
        string calldata agentId,
        bytes32 outputHash,
        uint256 confidence
    ) external onlyAdmin {
        if (rounds[roundId].createdAt == 0) revert RoundNotFound();
        if (rounds[roundId].finalized) revert RoundAlreadyFinalized();

        bytes32 agentKey = keccak256(bytes(agentId));
        if (hasVoted[roundId][agentKey]) revert DuplicateVote();

        hasVoted[roundId][agentKey] = true;
        roundVotes[roundId].push(Vote({
            agentId: agentId,
            outputHash: outputHash,
            confidence: confidence
        }));
        rounds[roundId].voteCount++;

        emit VoteSubmitted(roundId, agentId, outputHash, confidence);
    }

    /// @notice Finalize a round. Picks the output hash with the most votes.
    function finalizeRound(uint256 roundId) external onlyAdmin {
        Round storage round = rounds[roundId];
        if (round.createdAt == 0) revert RoundNotFound();
        if (round.finalized) revert RoundAlreadyFinalized();
        if (round.voteCount == 0) revert NoVotes();

        // Simple majority: count occurrences of each outputHash
        Vote[] storage votes = roundVotes[roundId];
        bytes32 bestHash;
        uint256 bestCount;

        for (uint256 i = 0; i < votes.length; i++) {
            uint256 count;
            for (uint256 j = 0; j < votes.length; j++) {
                if (votes[j].outputHash == votes[i].outputHash) {
                    count++;
                }
            }
            if (count > bestCount) {
                bestCount = count;
                bestHash = votes[i].outputHash;
            }
        }

        round.resultHash = bestHash;
        round.finalized = true;

        emit RoundFinalized(roundId, bestHash, round.voteCount);
    }

    /// @notice Get the result of a finalized round.
    function getRoundResult(uint256 roundId) external view returns (
        bytes32 outputHash,
        uint256 voteCount,
        bool finalized
    ) {
        Round storage round = rounds[roundId];
        return (round.resultHash, round.voteCount, round.finalized);
    }
}
