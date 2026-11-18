// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {LocalCst} from "./LocalCst.sol";
import {CycleMetrics} from "./CycleMetrics.sol";

interface ILocalGameMarket {
    function game() external view returns (address);
    function cst() external view returns (address);
}

/// @notice Local-only game simulator: V2 payment feedback, champion timing, and cycle closure.
/// @dev Time is the chain clock. Use Anvil's increaseTime/mine controls; no caller can invent results.
/// Durations are shortened for development. ETH allocations, NFTs and selection are out of scope.
contract LocalCosmicGame {
    using CycleMetrics for CycleMetrics.Metrics;

    LocalCst public immutable token;
    address private immutable _deployer = msg.sender;
    address public chaosZeroMarket;
    uint256 public constant CHAOS_ZERO_CYCLE_FUNDING = 8000 ether;
    uint256 public firstChaosZeroCycle;
    uint256 public roundNum = 1;
    uint256 public mainPrizeTime;
    uint256 public constant INITIAL_DURATION = 24 minutes;
    uint256 public constant TIME_INCREMENT = 1 minutes;
    uint256 public constant CLAIM_TIMEOUT = 2 minutes;
    uint256 public nextEthPrice = 0.01 ether;
    uint256 public cstDuration = 12 minutes;
    uint256 public cstOpeningPrice = 400 ether;
    uint256 public cstResetTime;
    address public lastBidder;
    uint256 private _lock = 1;
    mapping(uint256 => CycleMetrics.Metrics) private _stats;

    error LocalChainOnly();
    error InvalidPayment();
    error InvalidMarket();
    error FirstGestureMustBeEth();
    error NotReady();
    error ReentrantCall();
    event Gesture(uint256 indexed roundId, uint256 indexed gestureId, address indexed user, bool withCst, uint256 paid);
    event ChaosZeroCycleFunded(address indexed market, uint256 indexed cycle, uint256 amount, uint256 cumulativeAmount);
    event CycleClosed(uint256 indexed roundId, uint256 closedAt);

    constructor() {
        if (block.chainid != 31337) revert LocalChainOnly();
        token = new LocalCst(address(this));
        // A deterministic, internally replayed baseline makes all eight questions immediately usable.
        uint256 start = block.timestamp > 2100 ? block.timestamp - 2100 : 0;
        // A test chain may start near Unix epoch. Compress the fixture in that
        // case instead of reporting a supposedly finalized cycle in the future.
        uint256 fixtureDuration = block.timestamp - start;
        _stats[0].observe(false, 0.01 ether, start);
        _stats[0].observe(true, 100 ether, start + fixtureDuration * 120 / 2100);
        _stats[0].observe(false, 0.015 ether, start + fixtureDuration * 300 / 2100);
        _stats[0].observe(true, 200 ether, start + fixtureDuration * 900 / 2100);
        _stats[0].observe(false, 0.02 ether, start + fixtureDuration * 1020 / 2100);
        _stats[0].observe(true, 300 ether, start + fixtureDuration * 1500 / 2100);
        _stats[0].finish(block.timestamp);
    }

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @notice Wire the local game once; later cycle transitions require no market transaction.
    function setChaosZeroMarket(address market) external {
        if (
            msg.sender != _deployer || chaosZeroMarket != address(0) || market.code.length == 0
                || ILocalGameMarket(market).game() != address(this) || ILocalGameMarket(market).cst() != address(token)
        ) revert InvalidMarket();
        chaosZeroMarket = market;
        firstChaosZeroCycle = roundNum;
        _issueChaosZeroGrant();
    }

    function chaosZeroFunding(address market, uint256 cycle)
        public
        view
        returns (uint256 amount, uint256 cumulativeAmount)
    {
        if (market == address(0) || market != chaosZeroMarket || cycle < firstChaosZeroCycle || cycle > roundNum) {
            return (0, 0);
        }
        return (CHAOS_ZERO_CYCLE_FUNDING, (cycle - firstChaosZeroCycle + 1) * CHAOS_ZERO_CYCLE_FUNDING);
    }

    function _issueChaosZeroGrant() private {
        address market = chaosZeroMarket;
        if (market == address(0)) return;
        (uint256 amount, uint256 cumulativeAmount) = chaosZeroFunding(market, roundNum);
        token.mint(address(this), amount);
        token.transfer(market, amount);
        emit ChaosZeroCycleFunded(market, roundNum, amount, cumulativeAmount);
    }

    function roundStats(uint256 roundId) public view returns (CycleMetrics.Metrics memory) {
        if (roundId == roundNum) return _stats[roundId].current(block.timestamp);
        return _stats[roundId];
    }

    function getNextEthPrice() external view returns (uint256) {
        return nextEthPrice;
    }

    function getNextCstPrice() public view returns (uint256) {
        if (_stats[roundNum].gestureCount == 0) return cstOpeningPrice;
        uint256 elapsed = block.timestamp - cstResetTime;
        return elapsed >= cstDuration ? 0 : cstOpeningPrice * (cstDuration - elapsed) / cstDuration;
    }

    function bidderAddresses(uint256 roundId) external view returns (uint256) {
        return _stats[roundId].gestureCount;
    }

    function bidEth() external payable nonReentrant {
        if (msg.value != nextEthPrice) revert InvalidPayment();
        _rewardCurrentParticipant();
        cstDuration = (cstDuration + 1) * 250 / 251;
        nextEthPrice += nextEthPrice / 100 + 1;
        _observe(false, msg.value);
    }

    function bidCst(uint256 maxPrice) external nonReentrant {
        if (_stats[roundNum].gestureCount == 0) revert FirstGestureMustBeEth();
        uint256 price = getNextCstPrice();
        if (price > maxPrice) revert InvalidPayment();
        token.burn(msg.sender, price);
        _rewardCurrentParticipant();
        cstResetTime = block.timestamp;
        cstOpeningPrice = price * 2 > 200 ether ? price * 2 : 200 ether;
        cstDuration += cstDuration / 250;
        _observe(true, price);
    }

    /// @notice Local counterpart of claimMainPrize and the only transaction that ends a round (and
    /// therefore its markets). mainPrizeTime and CLAIM_TIMEOUT only decide who may call it and when;
    /// neither closes a market by itself.
    function closeCycle() external nonReentrant {
        if (lastBidder == address(0) || block.timestamp < mainPrizeTime) revert NotReady();
        if (msg.sender != lastBidder && block.timestamp < mainPrizeTime + CLAIM_TIMEOUT) revert NotReady();
        _stats[roundNum].finish(block.timestamp);
        emit CycleClosed(roundNum, block.timestamp);
        ++roundNum;
        _issueChaosZeroGrant();
        lastBidder = address(0);
        mainPrizeTime = 0;
        nextEthPrice = 0.01 ether;
    }

    function _observe(bool withCst, uint256 paid) private {
        if (_stats[roundNum].gestureCount == 0) {
            mainPrizeTime = block.timestamp + INITIAL_DURATION;
            cstResetTime = block.timestamp;
        } else {
            mainPrizeTime += TIME_INCREMENT;
        }
        _stats[roundNum].observe(withCst, paid, block.timestamp);
        lastBidder = msg.sender;
        emit Gesture(roundNum, _stats[roundNum].gestureCount, msg.sender, withCst, paid);
    }

    function _rewardCurrentParticipant() private {
        CycleMetrics.Metrics storage stats = _stats[roundNum];
        if (stats.gestureCount != 0) {
            // V2: square-root reward goes to the new participant. Scale is three CST^2 per second.
            uint256 reward = _sqrt((block.timestamp - stats.lastGestureTime) * 3 ether * 1 ether);
            token.mint(msg.sender, reward);
        }
    }

    function _sqrt(uint256 x) private pure returns (uint256 result) {
        if (x == 0) return 0;
        result = x;
        uint256 next = (x >> 1) + (x & 1);
        while (next < result) {
            result = next;
            next = (x / next + next) / 2;
        }
    }
}
