// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/ConsensusVoting.sol";

contract ConsensusVotingTest {
    ConsensusVoting private voting;

    function setUp() public {
        voting = new ConsensusVoting(address(this));
    }

    function testOpenRound() public {
        bytes32 taskHash = keccak256("task-1");
        uint256 roundId = voting.openRound(taskHash);
        require(roundId == 0, "first round should be 0");

        (bytes32 resultHash, uint256 voteCount, bool finalized) = voting.getRoundResult(roundId);
        require(resultHash == bytes32(0), "result should be empty");
        require(voteCount == 0, "no votes yet");
        require(!finalized, "not finalized");
    }

    function testSubmitVoteAndFinalize() public {
        bytes32 taskHash = keccak256("task-2");
        uint256 roundId = voting.openRound(taskHash);

        bytes32 outputA = keccak256("output-A");
        bytes32 outputB = keccak256("output-B");

        voting.submitVote(roundId, "scout", outputA, 8000);
        voting.submitVote(roundId, "ledger", outputA, 9000);
        voting.submitVote(roundId, "signal", outputB, 7000);

        voting.finalizeRound(roundId);

        (bytes32 resultHash, uint256 voteCount, bool finalized) = voting.getRoundResult(roundId);
        require(resultHash == outputA, "majority should be outputA");
        require(voteCount == 3, "should have 3 votes");
        require(finalized, "should be finalized");
    }

    function testDuplicateVoteReverts() public {
        uint256 roundId = voting.openRound(keccak256("task-3"));
        voting.submitVote(roundId, "scout", keccak256("out"), 8000);

        (bool ok,) = address(voting).call(
            abi.encodeWithSelector(
                voting.submitVote.selector,
                roundId, "scout", keccak256("out2"), 9000
            )
        );
        require(!ok, "duplicate vote should revert");
    }

    function testFinalizeAlreadyFinalizedReverts() public {
        uint256 roundId = voting.openRound(keccak256("task-4"));
        voting.submitVote(roundId, "scout", keccak256("out"), 8000);
        voting.finalizeRound(roundId);

        (bool ok,) = address(voting).call(
            abi.encodeWithSelector(voting.finalizeRound.selector, roundId)
        );
        require(!ok, "already finalized should revert");
    }

    function testFinalizeNoVotesReverts() public {
        uint256 roundId = voting.openRound(keccak256("task-5"));
        (bool ok,) = address(voting).call(
            abi.encodeWithSelector(voting.finalizeRound.selector, roundId)
        );
        require(!ok, "no votes should revert");
    }

    function testVoteOnFinalizedRoundReverts() public {
        uint256 roundId = voting.openRound(keccak256("task-6"));
        voting.submitVote(roundId, "scout", keccak256("out"), 8000);
        voting.finalizeRound(roundId);

        (bool ok,) = address(voting).call(
            abi.encodeWithSelector(
                voting.submitVote.selector,
                roundId, "ledger", keccak256("out2"), 9000
            )
        );
        require(!ok, "vote on finalized round should revert");
    }
}
