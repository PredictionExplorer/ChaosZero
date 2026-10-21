// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice The deployed Cosmic Signature V3 getters used by the independent markets.
/// @dev Field order matches the public `roundStats` getter, including unused fields.
interface ICosmicGameV3 {
    struct RoundStats {
        uint256 numBids;
        uint256 numCstBids;
        uint256 totalSpentEthAmount;
        uint256 totalSpentCstAmount;
        uint256 maxEthBidPrice;
        uint256 maxCstBidPrice;
        uint256 enduranceChampionDuration;
        uint256 chronoWarriorDuration;
        uint256 flags;
    }

    function roundNum() external view returns (uint256);
    function token() external view returns (address);
    function roundStats(uint256 roundId) external view returns (RoundStats memory);
    function tryGetCurrentChampions() external view returns (address, uint256, address, uint256);
}
