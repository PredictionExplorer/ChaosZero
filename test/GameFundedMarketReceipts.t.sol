// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test, Vm} from "forge-std/Test.sol";
import {GameFundedOutcomeMarket} from "../src/GameFundedOutcomeMarket.sol";
import {IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {OutcomeSettlementVault} from "../src/OutcomeSettlementVault.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalCst} from "../src/local/LocalCst.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";

/// @dev Check the external receipt ABI independently of the contract event declarations.
contract GameFundedMarketReceiptsTest is Test {
    uint256 private constant GRANT = 8000 ether;
    bytes32 private constant TRANSFER = keccak256("Transfer(address,address,uint256)");
    bytes32 private constant CLAIMED = keccak256("Claimed(uint256,address,uint256[8],uint256)");
    LocalCosmicGame private game;
    LocalOutcomeSource private source;
    LocalCst private token;
    GameFundedOutcomeMarket private market;
    OutcomeSettlementVault private vault;
    address private alice;
    address private bob;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(100_000);
        vm.deal(address(this), 1 ether);
        game = new LocalCosmicGame();
        source = new LocalOutcomeSource(game);
        token = game.token();
        market = new GameFundedOutcomeMarket(IIndependentCollateral(address(token)), source, address(game));
        vault = market.settlementVault();
        game.setChaosZeroMarket(address(market));
        alice = makeAddr("Alice");
        bob = makeAddr("Bob");
        _fundHolder(alice);
        _fundHolder(bob);
    }

    function _fundHolder(address holder) private {
        vm.startPrank(holder);
        token.faucet(100 ether);
        token.approve(address(market), type(uint256).max);
        vm.stopPrank();
    }

    function _advance() private {
        game.bidEth{value: game.nextEthPrice()}();
        vm.warp(game.mainPrizeTime());
        game.closeCycle();
    }

    function _assertLog(Vm.Log memory entry, address emitter, bytes memory topics, bytes memory data) private pure {
        assertEq(entry.emitter, emitter, "log emitter");
        assertEq(abi.encodePacked(entry.topics), topics, "log signature and indexed fields");
        assertEq(entry.data, data, "log payload");
    }

    function _assertOpening(Vm.Log[] memory logs, uint256 offset, uint256 cycle, uint256 cumulative, uint256 carry)
        private
        view
    {
        uint256 total = GRANT + carry;
        uint256[8] memory allocations;
        for (uint8 q; q < 8; ++q) {
            allocations[q] = total / 8 + (q < total % 8 ? 1 : 0);
            assertEq(market.questionState(cycle, q).activeCollateral, allocations[q]);
        }
        _assertLog(logs[offset], address(market), abi.encode(keccak256("RoundInitialized(uint256)"), cycle), "");
        _assertLog(
            logs[offset + 1],
            address(market),
            abi.encode(keccak256("GameFundingSynced(uint256,uint256,uint256,uint256,uint256[8])"), cycle),
            abi.encode(GRANT, cumulative, carry, allocations)
        );
        assertEq(market.consumedGameFunding(), cumulative);
        assertEq(market.totalActiveCollateral(), total);
    }

    function test_firstGrantHasEightEqualAllocationsAndOneReceiptAcrossCallers() public {
        vm.prank(alice);
        assertTrue(token.transfer(address(market), 17));
        vm.recordLogs();
        vm.prank(bob);
        market.syncFunding(1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2);
        _assertOpening(logs, 0, 1, GRANT, 0);
        assertEq(token.balanceOf(address(market)), GRANT + 17);

        vm.recordLogs();
        vm.prank(alice);
        market.syncFunding(1);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(market.consumedGameFunding(), GRANT);
    }

    function test_unaffordableFirstTradeRollsBackSettlementAndCreditsOnceOnRetry() public {
        vm.prank(bob);
        market.splitPosition(1, 2, 3 ether);
        _advance();
        uint256 cash = token.balanceOf(alice) + 1;
        vm.startPrank(alice);
        vm.expectRevert(LocalCst.InsufficientBalance.selector);
        market.buy(2, 4, false, cash, cash, block.timestamp);
        assertFalse(vault.registered(1));
        assertEq(market.consumedGameFunding(), GRANT);
        token.faucet(1);
        token.approve(address(market), cash - 1);
        vm.expectRevert(LocalCst.InsufficientAllowance.selector);
        market.buy(2, 4, false, cash, cash, block.timestamp);
        assertFalse(vault.registered(1));
        assertFalse(market.roundState(2).initialized);
        assertEq(market.consumedGameFunding(), GRANT);
        assertEq(token.balanceOf(alice), cash);

        token.approve(address(market), cash);
        vm.recordLogs();
        market.buy(2, 4, false, cash, cash, block.timestamp);
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 9);
        _assertLog(logs[6], address(token), abi.encode(TRANSFER, alice, market), abi.encode(cash));
        _assertLog(
            logs[8],
            address(market),
            abi.encode(keccak256("Trade(uint256,address,uint8,bool,bool,uint256,uint256)"), 2, alice, 4),
            abi.encode(false, true, cash, cash)
        );
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.allowance(alice, address(market)), 0);
        assertEq(market.consumedGameFunding(), 2 * GRANT);
        assertEq(market.totalActiveCollateral(), 2 * GRANT + cash);
        assertEq(vault.remaining(1, 2), 3 ether);
        assertEq(token.balanceOf(address(vault)), 3 ether);
    }

    function testFuzz_quietCycleRolloverReceiptsPreserveEarlierClaims(uint64 rawPremium, uint64 rawPairs, uint8 rawGap)
        public
    {
        uint256 premium = bound(rawPremium, 1, 0.5 ether);
        uint256 pairs = bound(rawPairs, 1, 10 ether);
        uint256 quiet = bound(rawGap, 1, 4);
        uint256 cycle = quiet + 2;
        // Question 5 settles YES on the single game gesture. Bob holds both sides of question 2.
        vm.prank(alice);
        market.buy(1, 5, true, 1 ether, 1 ether + premium, block.timestamp);
        vm.prank(bob);
        market.splitPosition(1, 2, pairs);
        for (uint256 closed = 1; closed < cycle; ++closed) {
            _advance();
        }

        (,,, uint8 answers) = source.outcomeState(1);
        assertTrue((answers & (1 << 5)) != 0);
        uint256[8] memory owed;
        owed[5] = 1 ether + premium;
        owed[2] = pairs;
        uint256 liability = owed[2] + owed[5];
        uint256 surplus = GRANT - premium;
        uint256 marketBefore = token.balanceOf(address(market));
        vm.recordLogs();
        market.syncFunding(cycle);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 6);
        _assertLog(
            logs[0],
            address(market),
            abi.encode(keccak256("AnswersObserved(uint256,uint8,uint8)"), 1),
            abi.encode(type(uint8).max, answers)
        );
        _assertLog(logs[1], address(token), abi.encode(TRANSFER, market, vault), abi.encode(liability));
        _assertLog(
            logs[2], address(vault), abi.encode(keccak256("CycleEscrowed(uint256,uint256[8])"), 1), abi.encode(owed)
        );
        _assertLog(
            logs[3],
            address(market),
            abi.encode(keccak256("RoundSettled(uint256,uint8,uint256[8],uint256)"), 1),
            abi.encode(answers, owed, surplus)
        );
        _assertOpening(logs, 4, cycle, GRANT * cycle, surplus + quiet * GRANT);
        assertEq(marketBefore - token.balanceOf(address(market)), liability);
        assertEq(token.balanceOf(address(vault)), liability);
        assertEq(vault.totalEscrowed(), liability);
        for (uint8 q; q < 8; ++q) {
            assertEq(vault.remaining(1, q), owed[q]);
        }

        vm.recordLogs();
        market.settleRound(1);
        market.syncFunding(cycle);
        assertEq(vm.getRecordedLogs().length, 0);
        _claim(alice, 5, owed[5]);
        assertEq(vault.remaining(1, 2), pairs);
        assertEq(token.balanceOf(address(vault)), pairs);
        assertEq(vault.totalEscrowed(), pairs);
        _claim(bob, 2, pairs);
        assertEq(vault.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(token.balanceOf(address(market)), market.totalActiveCollateral());
    }

    function _claim(address holder, uint8 question, uint256 payment) private {
        uint256 before = token.balanceOf(holder);
        vm.recordLogs();
        vm.prank(holder);
        assertEq(market.claimKnown(1), payment);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 4); // ERC-1155 burn followed by the CST transfer, the vault payment and its receipt.
        _assertLog(logs[1], address(token), abi.encode(TRANSFER, vault, holder), abi.encode(payment));
        _assertLog(
            logs[2],
            address(vault),
            abi.encode(keccak256("Paid(uint256,uint8,address,uint256)"), 1, question, holder),
            abi.encode(payment)
        );
        uint256[8] memory amounts;
        amounts[question] = payment;
        _assertLog(logs[3], address(market), abi.encode(CLAIMED, 1, holder), abi.encode(amounts, payment));
        assertEq(token.balanceOf(holder) - before, payment);
        assertEq(vault.remaining(1, question), 0);

        vm.recordLogs();
        vm.prank(holder);
        assertEq(market.claimKnown(1), 0);
        logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        amounts[question] = 0;
        _assertLog(logs[0], address(market), abi.encode(CLAIMED, 1, holder), abi.encode(amounts, 0));
        assertEq(token.balanceOf(holder) - before, payment);
    }
}
