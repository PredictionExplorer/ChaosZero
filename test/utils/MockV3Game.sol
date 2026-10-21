// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ICosmicGameV3} from "../../src/interfaces/ICosmicGameV3.sol";

contract MockV3Game is ICosmicGameV3 {
    address public token;
    uint256 public roundNum = 3;
    bool public offline;
    uint256 public liveEndurance;
    uint256 public liveChrono;
    address public enduranceAddress = address(101);
    address public chronoAddress = address(101);
    mapping(uint256 => RoundStats) private _stats;

    error Offline();

    constructor(address token_) {
        token = token_;
    }

    function setToken(address value) external {
        token = value;
    }

    function setRound(uint256 value) external {
        roundNum = value;
    }

    function setOffline(bool value) external {
        offline = value;
    }

    function setStats(uint256 id, RoundStats memory value) external {
        _stats[id] = value;
    }

    function setChampions(uint256 endurance, uint256 chrono, bool sameWallet) external {
        liveEndurance = endurance;
        liveChrono = chrono;
        chronoAddress = sameWallet ? enduranceAddress : address(102);
    }

    function roundStats(uint256 id) external view returns (RoundStats memory) {
        if (offline) revert Offline();
        return _stats[id];
    }

    function tryGetCurrentChampions() external view returns (address, uint256, address, uint256) {
        if (offline) revert Offline();
        return (enduranceAddress, liveEndurance, chronoAddress, liveChrono);
    }
}
