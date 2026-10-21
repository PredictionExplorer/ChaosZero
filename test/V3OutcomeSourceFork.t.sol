// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {ICosmicGameV3} from "../src/interfaces/ICosmicGameV3.sol";
import {V3OutcomeSource} from "../src/V3OutcomeSource.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";

interface IV3ForkGame is ICosmicGameV3 {
    function roundActivationTime() external view returns (uint256);
    function mainPrizeTime() external view returns (uint256);
    function getNextEthBidPriceAdvanced(int256 timeOffset) external view returns (uint256);
    function bidWithEth(int256 nftId, string calldata message, uint256 minimumReward) external payable;
    function claimMainPrize() external;
}

interface IForkCst is IIndependentCollateral {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Opt-in reads and transactions on an isolated fork, never a public-chain broadcast.
/// Run with CHAOSZERO_V3_FORK_RPC_URL set to an Arbitrum archive RPC endpoint.
contract V3OutcomeSourceForkTest is Test {
    address private constant GAME = 0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2;
    address private constant TOKEN = 0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0;
    address private constant IMPLEMENTATION = 0xc1b97E1b0baC86248653B18706dbC5c8898c5c06;
    uint256 private constant SNAPSHOT_BLOCK = 516865668;
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    IV3ForkGame private game;
    IForkCst private token;
    V3OutcomeSource private source;

    function setUp() public {
        string memory rpc = vm.envOr("CHAOSZERO_V3_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc, vm.envOr("CHAOSZERO_V3_FORK_BLOCK", SNAPSHOT_BLOCK));
        assertEq(block.chainid, 42161);
        assertEq(address(uint160(uint256(vm.load(GAME, IMPLEMENTATION_SLOT)))), IMPLEMENTATION);
        game = IV3ForkGame(GAME);
        token = IForkCst(TOKEN);
        assertEq(game.token(), TOKEN);
        assertEq(game.roundNum(), 3);
        // Replayed round-2 history. The deployment workflow verifies and records
        // this provenance separately; the adapter itself only authenticates the count.
        V3OutcomeSource.HistoricalBaseline memory baseline = V3OutcomeSource.HistoricalBaseline(
            1257, 17785933723725359657, 118887756299069655832122, 469235819458920479966, 17766, 783402, false
        );
        source = new V3OutcomeSource(game, 3, baseline);
    }

    function testFork_deployedV3DecodesLegacyAndUpcomingRoundWithoutFabricatingHistory() public view {
        ICosmicGameV3.RoundStats memory previous = game.roundStats(2);
        assertEq(previous.numBids, 1257);
        assertEq(previous.totalSpentEthAmount, 0);
        assertEq(previous.enduranceChampionDuration, 0);
        assertEq(source.metrics(2).ethSpent, 17785933723725359657);
        assertEq(source.metrics(2).chronoDuration, 783402);
        assertFalse(source.metrics(2).sameGesture);
        assertEq(game.roundStats(3).numBids, 0);
        (bool open, bool finalized, uint8 known, uint8 values) = source.outcomeState(3);
        assertTrue(open);
        assertFalse(finalized);
        assertEq(known, 0);
        assertEq(values, 0);
    }

    function testFork_realV3GestureClosureClaimsAndNextRoundFunding() public {
        // Foundry's EVM does not execute Arbitrum native precompiles. Replace
        // only the four entropy reads used by prize distribution. All game,
        // token, statistics, source, market and payout code executes unchanged.
        vm.mockCall(address(100), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(block.number));
        vm.mockCall(
            address(100),
            abi.encodeWithSignature("arbBlockHash(uint256)", block.number - 1),
            abi.encode(bytes32(uint256(123)))
        );
        vm.mockCall(address(108), abi.encodeWithSignature("getGasBacklog()"), abi.encode(uint256(0)));
        vm.mockCall(address(108), abi.encodeWithSignature("getL1PricingUnitsSinceUpdate()"), abi.encode(uint256(0)));
        IndependentOutcomeMarket market = new IndependentOutcomeMarket(token, source);
        address trader = makeAddr("fork trader");
        deal(TOKEN, address(this), 8000 ether);
        deal(TOKEN, trader, 100 ether);
        token.approve(address(market), type(uint256).max);
        market.fundRound(3, 8000 ether);
        vm.startPrank(trader);
        token.approve(address(market), type(uint256).max);
        market.buy(3, 0, false, 100 ether, 150 ether, type(uint256).max);
        vm.stopPrank();
        vm.warp(game.roundActivationTime());
        uint256 price = game.getNextEthBidPriceAdvanced(0);
        vm.deal(trader, price);
        vm.prank(trader);
        game.bidWithEth{value: price}(-1, "fork-only integration", 0);
        assertEq(source.metrics(3).gestureCount, 1);
        assertEq(source.metrics(3).ethSpent, price);
        vm.warp(game.mainPrizeTime());
        (bool open, bool finalized,,) = source.outcomeState(3);
        assertTrue(open); // Countdown expiry never substitutes for the actual closure transaction.
        assertFalse(finalized);
        vm.prank(trader);
        game.claimMainPrize();
        assertEq(game.roundNum(), 4);
        uint8 known;
        uint8 values;
        (, finalized, known, values) = source.outcomeState(3);
        assertTrue(finalized);
        assertEq(known, 255);
        assertEq(values & 1, 0);
        assertTrue(source.metrics(3).sameGesture);
        market.fundRound(4, 0);
        assertEq(market.settlementVault().remaining(3, 0), 150 ether);
        assertEq(market.totalActiveCollateral(), 7950 ether);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(4, q).initialYesBps, 5000);
            assertEq(market.questionState(4, q).currentYesBps, 5000);
        }
        uint256 beforeClaim = token.balanceOf(trader); // Game prizes are separate from prediction payouts.
        vm.prank(trader);
        assertEq(market.claimKnown(3), 150 ether);
        assertEq(token.balanceOf(trader) - beforeClaim, 150 ether);
    }

    function testFork_firstClaimImmediatelyAfterGameClosureSettlesAndPreservesOtherWinners() public {
        // Only ArbOS entropy precompiles are unavailable in Foundry. The game,
        // token and complete settlement path below execute their actual code.
        vm.mockCall(address(100), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(block.number));
        vm.mockCall(
            address(100),
            abi.encodeWithSignature("arbBlockHash(uint256)", block.number - 1),
            abi.encode(bytes32(uint256(123)))
        );
        vm.mockCall(address(108), abi.encodeWithSignature("getGasBacklog()"), abi.encode(uint256(0)));
        vm.mockCall(address(108), abi.encodeWithSignature("getL1PricingUnitsSinceUpdate()"), abi.encode(uint256(0)));
        IndependentOutcomeMarket market = new IndependentOutcomeMarket(token, source);
        address alice = makeAddr("immediate claimant");
        address bob = makeAddr("other winning holder");
        deal(TOKEN, address(this), 8000 ether);
        deal(TOKEN, alice, 100 ether);
        deal(TOKEN, bob, 50 ether);
        token.approve(address(market), type(uint256).max);
        market.fundRound(3, 8000 ether);
        vm.startPrank(alice);
        token.approve(address(market), type(uint256).max);
        market.buy(3, 0, false, 100 ether, 150 ether, type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        token.approve(address(market), type(uint256).max);
        market.buy(3, 0, false, 50 ether, 50 ether, type(uint256).max);
        vm.stopPrank();
        vm.warp(game.roundActivationTime());
        uint256 price = game.getNextEthBidPriceAdvanced(0);
        vm.deal(alice, price);
        vm.prank(alice);
        game.bidWithEth{value: price}(-1, "fork-only immediate claim", 0);
        vm.warp(game.mainPrizeTime());
        vm.prank(alice);
        vm.expectRevert(IndependentOutcomeMarket.NotFinalized.selector);
        market.claimKnown(3); // An expired countdown still cannot authorize a payout.
        uint256 closingBlock = block.number;
        uint256 closingTime = block.timestamp;
        vm.prank(alice);
        game.claimMainPrize();
        assertEq(game.roundNum(), 4);
        assertFalse(market.roundState(3).settled);
        assertFalse(market.settlementVault().registered(3));
        (bool ready, uint256 claimable,) = market.previewClaim(3, alice);
        assertTrue(ready);
        assertEq(claimable, 150 ether);
        uint256 beforeAlice = token.balanceOf(alice);
        vm.prank(alice);
        assertEq(market.claimKnown(3), 150 ether); // First claim performs settlement itself.
        assertEq(token.balanceOf(alice) - beforeAlice, 150 ether);
        assertTrue(market.roundState(3).settled);
        assertEq(market.settlementVault().remaining(3, 0), 50 ether);
        assertEq(market.settlementVault().totalEscrowed(), 50 ether);
        assertEq(token.balanceOf(address(market.settlementVault())), 50 ether);
        assertEq(market.pendingCarry(), 7950 ether);
        assertEq(market.totalActiveCollateral(), 0);
        assertFalse(market.roundState(4).initialized); // No next-cycle or administrative action was needed.
        uint256 beforeBob = token.balanceOf(bob);
        vm.prank(bob);
        assertEq(market.claimKnown(3), 50 ether);
        assertEq(token.balanceOf(bob) - beforeBob, 50 ether);
        assertEq(market.settlementVault().totalEscrowed(), 0);
        assertEq(token.balanceOf(address(market)), 7950 ether);
        assertEq(block.number, closingBlock);
        assertEq(block.timestamp, closingTime); // No timelock, timestamp advance or extra block.
    }
}
