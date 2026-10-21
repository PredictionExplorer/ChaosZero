// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @dev Only compiled explicitly by the local deployment integration test.
contract DeploymentGame {
    address public immutable token;
    uint256 public roundNum = 3;

    constructor(address token_) {
        token = token_;
    }

    function setRound(uint256 nextRound) external {
        roundNum = nextRound;
    }

    function roundStats(uint256 round)
        external
        pure
        returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return (round == 2 ? 1257 : 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }

    function tryGetCurrentChampions() external pure returns (address, uint256, address, uint256) {
        return (address(0), 0, address(0), 0);
    }
}
