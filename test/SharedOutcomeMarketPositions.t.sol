// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {SharedOutcomeMarket, ISharedCollateral} from "../src/SharedOutcomeMarket.sol";
import {IOutcomeSource} from "../src/interfaces/IOutcomeSource.sol";
import {MockCst} from "./utils/Mocks.sol";

contract PositionOutcomeSource is IOutcomeSource {
    struct State {
        bool open;
        bool final_;
        uint8 mask;
        uint8 values;
    }
    mapping(uint256 => State) private _states;
    bool public offline;
    error SourceOffline();

    function set(uint256 round, bool open, bool final_, uint8 mask, uint8 values) external {
        _states[round] = State(open, final_, mask, values);
    }

    function setOffline(bool value) external {
        offline = value;
    }

    function outcomeState(uint256 round) external view returns (bool, bool, uint8, uint8) {
        if (offline) revert SourceOffline();
        State memory s = _states[round];
        return (s.open, s.final_, s.mask, s.values);
    }
}

contract SharedOutcomeMarketPositionsTest is Test, ERC1155Holder {
    SharedOutcomeMarket private market;
    PositionOutcomeSource private source;
    MockCst private token;
    address private constant ALICE = address(101);
    address private constant BOB = address(102);

    function setUp() public {
        token = new MockCst();
        source = new PositionOutcomeSource();
        source.set(1, true, false, 0, 0);
        market = new SharedOutcomeMarket(ISharedCollateral(address(token)), source);
        token.mint(address(this), 100_000e18);
        token.mint(ALICE, 100_000e18);
        token.approve(address(market), type(uint256).max);
        vm.prank(ALICE);
        token.approve(address(market), type(uint256).max);
    }

    function _split(uint8 q, uint256 amount) private {
        vm.prank(ALICE);
        market.splitPosition(1, q, amount);
    }

    function test_splitBeforeSponsorshipIsBackedButCannotTrade() public {
        _split(0, 10e18);
        (uint256 cash, bool funded,,) = market.roundAccounting(1);
        assertEq(cash, 10e18);
        assertFalse(funded);
        assertTrue(market.isInitialized(1));
        vm.prank(ALICE);
        vm.expectRevert(SharedOutcomeMarket.NotFunded.selector);
        market.buy(1, 0, true, 1e18, 1e18, type(uint256).max);
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        market.fundRound(1, 1);
        market.fundRound(1, 1000e18);
        (cash, funded,,) = market.roundAccounting(1);
        assertEq(cash, 1010e18);
        assertTrue(funded);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, 0, 10e18), 10e18);
        (cash,,,) = market.roundAccounting(1);
        assertEq(cash, 1000e18);
    }

    function test_splitOnlyCycleCanClaimWithoutEverSponsoringPool() public {
        _split(3, 7e18);
        source.set(1, false, true, 255, 0);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 7e18);
        (uint256 cash, bool funded,,) = market.roundAccounting(1);
        assertEq(cash, 0);
        assertFalse(funded);
        assertEq(market.totalSupply(market.positionId(1, 3, true)), 0);
        assertEq(market.totalSupply(market.positionId(1, 3, false)), 0);
    }

    function test_allEightPairsBatchMergePaysSumAndSurvivesSourceFailure() public {
        uint256[8] memory amounts;
        uint256 sum;
        for (uint8 q; q < 8; ++q) {
            amounts[q] = (uint256(q) + 1) * 1e18;
            sum += amounts[q];
            _split(q, amounts[q]);
        }
        source.setOffline(true);
        uint256 beforeAlice = token.balanceOf(ALICE);
        vm.prank(ALICE);
        assertEq(market.mergePositions(1, amounts), sum);
        assertEq(token.balanceOf(ALICE), beforeAlice + sum);
        (uint256 cash,,,) = market.roundAccounting(1);
        assertEq(cash, 0);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.totalSupply(market.positionId(1, q, true)), 0);
            assertEq(market.totalSupply(market.positionId(1, q, false)), 0);
        }
    }

    function test_crossQuestionSidesCannotBeMerged() public {
        _split(0, 1e18);
        _split(1, 1e18);
        vm.startPrank(ALICE);
        market.safeTransferFrom(ALICE, BOB, market.positionId(1, 0, false), 1e18, "");
        market.safeTransferFrom(ALICE, BOB, market.positionId(1, 1, true), 1e18, "");
        vm.expectRevert(SharedOutcomeMarket.InsufficientPosition.selector);
        market.mergePosition(1, 0, 1e18);
        vm.expectRevert(SharedOutcomeMarket.InsufficientPosition.selector);
        market.mergePosition(1, 1, 1e18);
        uint256[8] memory amounts;
        amounts[0] = 1e18;
        amounts[1] = 1e18;
        vm.expectRevert(SharedOutcomeMarket.InsufficientPosition.selector);
        market.mergePositions(1, amounts);
        vm.stopPrank();
        assertEq(token.balanceOf(address(market)), 2e18);
    }

    function test_mergesRemainAvailableAfterFinalizationAndResidualRollover() public {
        market.fundRound(1, 1000e18);
        _split(2, 10e18);
        source.set(1, false, true, 255, 4);
        source.set(2, true, false, 0, 0);
        assertEq(market.rollover(1, 2), 1000e18);
        source.setOffline(true);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, 2, 10e18), 10e18);
        (uint256 oldCash,,,) = market.roundAccounting(1);
        (uint256 newCash,,,) = market.roundAccounting(2);
        assertEq(oldCash, 0);
        assertEq(newCash, 1000e18);
    }

    function test_partialClaimClearsOnlyKnownPairsAndOtherPairsStillMergeOffline() public {
        _split(0, 7e18);
        _split(1, 11e18);
        source.set(1, true, false, 1, 1);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 7e18);
        source.setOffline(true);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, 1, 11e18), 11e18);
        assertEq(token.balanceOf(address(market)), 0);
    }

    function test_cachedFinalizationAllowsClaimsWithoutSourceAndNeverPaysTwice() public {
        _split(0, 7e18);
        source.set(1, false, true, 255, 1);
        assertEq(market.claimKnown(1), 0); // Cache answers without touching Alice.
        source.setOffline(true);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 7e18);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 0);
        assertEq(token.balanceOf(address(market)), 0);
    }

    function test_winnerTransferredAfterRolloverClaimsWithSourceOffline() public {
        market.fundRound(1, 1000e18);
        _split(0, 8e18);
        source.set(1, false, true, 255, 1);
        source.set(2, true, false, 0, 0);
        market.rollover(1, 2);
        source.setOffline(true);
        uint256 yesId = market.positionId(1, 0, true);
        vm.prank(ALICE);
        market.safeTransferFrom(ALICE, BOB, yesId, 8e18, "after rollover");
        vm.prank(BOB);
        assertEq(market.claimKnown(1), 8e18);
        vm.prank(BOB);
        assertEq(market.claimKnown(1), 0);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 0);
        assertEq(token.balanceOf(address(market)), 1000e18);
    }

    function test_partialCachedAnswersStillSyncAndRejectChangedOrOfflineSource() public {
        _split(0, 3e18);
        source.set(1, true, false, 1, 1);
        market.claimKnown(1);
        source.setOffline(true);
        vm.prank(ALICE);
        vm.expectRevert(PositionOutcomeSource.SourceOffline.selector);
        market.claimKnown(1);
        source.setOffline(false);
        source.set(1, true, false, 1, 0);
        vm.prank(ALICE);
        vm.expectRevert(SharedOutcomeMarket.InvalidSourceState.selector);
        market.claimKnown(1);
        assertEq(market.balanceOf(ALICE, market.positionId(1, 0, true)), 3e18);
    }

    function test_transferredWinnerPaysCurrentHolderAndSupplyTracksBurns() public {
        _split(0, 9e18);
        uint256 yesId = market.positionId(1, 0, true);
        vm.prank(ALICE);
        market.safeTransferFrom(ALICE, BOB, yesId, 9e18, "position transfer");
        assertEq(market.totalSupply(yesId), 9e18);
        source.set(1, false, true, 255, 1);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 0);
        vm.prank(BOB);
        assertEq(market.claimKnown(1), 9e18);
        assertEq(market.totalSupply(yesId), 0);
        assertEq(token.balanceOf(BOB), 9e18);
    }

    function test_splitAndMergePreserveAll256ReservesWithExistingExposure() public {
        market.fundRound(1, 1000e18);
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        uint256[256] memory before_ = _reserves();
        uint256[8] memory amounts;
        for (uint8 q; q < 8; ++q) {
            amounts[q] = (uint256(q) + 1) * 1e18;
            _split(q, amounts[q]);
        }
        uint256[256] memory afterSplit = _reserves();
        vm.prank(ALICE);
        market.mergePositions(1, amounts);
        uint256[256] memory afterMerge = _reserves();
        for (uint256 s; s < 256; ++s) {
            assertEq(afterSplit[s], before_[s]);
            assertEq(afterMerge[s], before_[s]);
        }
    }

    function test_eventsInterfacesAndMetadataDescribeIssuedPositions() public {
        vm.recordLogs();
        _split(3, 4e18);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool mintSeen;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != address(market)
                    || logs[i].topics[0] != keccak256("TransferBatch(address,address,address,uint256[],uint256[])")
            ) continue;
            (uint256[] memory ids, uint256[] memory quantities) = abi.decode(logs[i].data, (uint256[], uint256[]));
            assertEq(ids.length, 2);
            assertEq(ids[0], market.positionId(1, 3, true));
            assertEq(ids[1], market.positionId(1, 3, false));
            assertEq(quantities[0], 4e18);
            assertEq(quantities[1], 4e18);
            assertEq(logs[i].topics[2], bytes32(0));
            assertEq(address(uint160(uint256(logs[i].topics[3]))), ALICE);
            mintSeen = true;
        }
        assertTrue(mintSeen);
        assertTrue(market.supportsInterface(0x01ffc9a7));
        assertTrue(market.supportsInterface(0xd9b67a26));
        assertTrue(market.supportsInterface(0x0e89341c));
        assertFalse(market.supportsInterface(0xffffffff));
        bytes memory encoded = bytes(market.uri(market.positionId(1, 3, true)));
        bytes memory payload = new bytes(encoded.length - 29);
        for (uint256 i; i < payload.length; ++i) {
            payload[i] = encoded[i + 29];
        }
        string memory json = string(Base64.decode(string(payload)));
        assertEq(vm.parseJsonUint(json, ".decimals"), 18);
        assertEq(vm.parseJsonString(json, ".properties.round"), "1");
        assertEq(vm.parseJsonUint(json, ".properties.question"), 3);
        assertEq(vm.parseJsonString(json, ".properties.side"), "YES");
        assertEq(vm.parseJsonAddress(json, ".properties.outcomeSource"), address(source));
    }

    function test_maxRoundDoesNotCollideAndOverflowCannotTrapCollateral() public {
        uint256 maximum = market.MAX_ROUND_ID();
        assertEq(market.positionId(maximum, 7, true), type(uint256).max);
        source.set(maximum, true, false, 0, 0);
        vm.prank(ALICE);
        market.splitPosition(maximum, 7, 1e18);
        assertEq(market.balanceOf(ALICE, type(uint256).max), 1e18);
        uint256 balance = token.balanceOf(address(market));
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        market.fundRound(maximum + 1, 1e18);
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        market.splitPosition(maximum + 1, 0, 1e18);
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        market.positionId(maximum + 1, 0, false);
        assertEq(token.balanceOf(address(market)), balance);
        assertEq(market.totalSupply(0), 0);
    }

    function testFuzz_splitMergeHasNoProfitAndNoSponsorRights(uint8 question, uint256 raw) public {
        question %= 8;
        uint256 amount = bound(raw, 1, 1e27);
        token.mint(ALICE, amount);
        uint256 beforeAlice = token.balanceOf(ALICE);
        _split(question, amount);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, question, amount), amount);
        assertEq(token.balanceOf(ALICE), beforeAlice);
        (uint256 cash, bool funded,,) = market.roundAccounting(1);
        assertEq(cash, 0);
        assertFalse(funded);
    }

    function _reserves() private view returns (uint256[256] memory result) {
        (uint256 cash,,,) = market.roundAccounting(1);
        (uint256[8] memory yes, uint256[8] memory no) = market.liabilities(1);
        for (uint256 s; s < 256; ++s) {
            uint256 debt;
            for (uint256 q; q < 8; ++q) {
                debt += (s & (uint256(1) << q)) != 0 ? yes[q] : no[q];
            }
            result[s] = cash - debt;
        }
    }
}
