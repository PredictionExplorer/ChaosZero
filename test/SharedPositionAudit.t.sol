// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {SharedOutcomeMarket, ISharedCollateral} from "../src/SharedOutcomeMarket.sol";
import {IOutcomeSource} from "../src/interfaces/IOutcomeSource.sol";
import {MockCst} from "./utils/Mocks.sol";

contract PositionAuditSource is IOutcomeSource {
    struct State {
        bool open;
        bool finalized;
        uint8 known;
        uint8 values;
    }
    mapping(uint256 => State) private _states;
    bool public unavailable;
    error SourceUnavailable();

    function set(uint256 round, bool open, bool finalized, uint8 known, uint8 values) external {
        _states[round] = State(open, finalized, known, values);
    }

    function setUnavailable(bool value) external {
        unavailable = value;
    }

    function outcomeState(uint256 round) external view returns (bool, bool, uint8, uint8) {
        if (unavailable) revert SourceUnavailable();
        State memory s = _states[round];
        return (s.open, s.finalized, s.known, s.values);
    }
}

/// @dev Financial re-entry must fail, but a standard receiver can immediately
/// forward the newly received positions and give its operator approval.
contract AuditForwardingReceiver is IERC1155Receiver {
    SharedOutcomeMarket public immutable market;
    address public immutable recipient;
    uint256 public blocked;
    uint256 public callbacks;

    constructor(SharedOutcomeMarket market_, MockCst token_, address recipient_) {
        market = market_;
        recipient = recipient_;
        token_.approve(address(market_), type(uint256).max);
    }

    function buy() external {
        market.buy(1, 1, true, 10e18, 15e18, type(uint256).max);
    }

    function split() external {
        market.splitPosition(2, 7, 37);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC165).interfaceId || id == type(IERC1155Receiver).interfaceId;
    }

    function onERC1155Received(address, address, uint256 id, uint256 value, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(market), "unexpected token");
        _attack();
        market.safeTransferFrom(address(this), recipient, id, value, "forwarded");
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata ids, uint256[] calldata values, bytes calldata)
        external
        returns (bytes4)
    {
        require(msg.sender == address(market), "unexpected token");
        _attack();
        market.safeBatchTransferFrom(address(this), recipient, ids, values, "forwarded");
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function _attack() private {
        ++callbacks;
        uint256[8] memory amounts;
        amounts[0] = 1;
        bytes[8] memory calls = [
            abi.encodeCall(market.fundRound, (1, 1e12)),
            abi.encodeCall(market.buy, (1, 0, true, 1, 1, type(uint256).max)),
            abi.encodeCall(market.sell, (1, 0, true, 1, 1, type(uint256).max)),
            abi.encodeCall(market.claimKnown, (1)),
            abi.encodeCall(market.rollover, (1, 2)),
            abi.encodeCall(market.splitPosition, (1, 0, 1)),
            abi.encodeCall(market.mergePosition, (1, 0, 1)),
            abi.encodeCall(market.mergePositions, (1, amounts))
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool success, bytes memory reason) = address(market).call(calls[i]);
            require(!success && bytes4(reason) == SharedOutcomeMarket.ReentrantCall.selector, "economic reentry");
            ++blocked;
        }
        market.setApprovalForAll(recipient, true);
    }
}

contract AuditRejectingReceiver is IERC1155Receiver {
    SharedOutcomeMarket public immutable market;

    constructor(SharedOutcomeMarket market_, MockCst token_) {
        market = market_;
        token_.approve(address(market_), type(uint256).max);
    }

    function split() external {
        market.splitPosition(2, 0, 9e18);
    }

    function buy() external {
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC1155Receiver).interfaceId;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0);
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return bytes4(0);
    }
}

/// @dev A transfer receiver may redeem what it now owns. The ERC1155 transfer
/// has already updated every balance before this callback, and must not write a
/// stale balance after the nested financial operation returns.
contract AuditRedeemingReceiver is IERC1155Receiver {
    SharedOutcomeMarket private immutable _market;
    uint256 public receivedCollateral;

    constructor(SharedOutcomeMarket market_) {
        _market = market_;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC165).interfaceId || id == type(IERC1155Receiver).interfaceId;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(_market), "unexpected token");
        receivedCollateral += _market.claimKnown(1);
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata amounts, bytes calldata)
        external
        returns (bytes4)
    {
        require(msg.sender == address(_market), "unexpected token");
        receivedCollateral += _market.mergePosition(1, 0, amounts[0]);
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }
}

contract SharedPositionAuditTest is Test {
    SharedOutcomeMarket private market;
    PositionAuditSource private source;
    MockCst private token;
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    address private constant OPERATOR = address(0xcafe);
    uint256 private constant SEED = 1000e18;

    function setUp() public {
        source = new PositionAuditSource();
        source.set(1, true, false, 0, 0);
        source.set(2, true, false, 0, 0);
        token = new MockCst();
        market = new SharedOutcomeMarket(ISharedCollateral(address(token)), source);
        token.mint(address(this), SEED);
        token.approve(address(market), type(uint256).max);
        market.fundRound(1, SEED);
        token.mint(ALICE, market.MAX_COLLATERAL());
        vm.prank(ALICE);
        token.approve(address(market), type(uint256).max);
    }

    function testFuzz_pairOperationsPreserveEveryJointReserve(uint8 rawQuestion, uint256 rawAmount) public {
        uint8 question = rawQuestion % 8;
        uint256 amount = bound(rawAmount, 1, market.MAX_COLLATERAL() - SEED);
        uint256 beforeWallet = token.balanceOf(ALICE);
        vm.prank(ALICE);
        market.splitPosition(1, question, amount);
        _assertUniformReserves(1, SEED);
        assertEq(market.totalSupply(market.positionId(1, question, true)), amount);
        assertEq(market.totalSupply(market.positionId(1, question, false)), amount);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, question, amount), amount);
        assertEq(token.balanceOf(ALICE), beforeWallet);
        _assertUniformReserves(1, SEED);
        assertEq(market.totalSupply(market.positionId(1, question, true)), 0);
        assertEq(market.totalSupply(market.positionId(1, question, false)), 0);
    }

    function test_unfundedPairsInitializeWithoutBypassingTheSponsorMinimum() public {
        vm.prank(ALICE);
        market.splitPosition(2, 0, 1);
        assertTrue(market.isInitialized(2));
        (uint256 cash, bool funded,,) = market.roundAccounting(2);
        assertEq(cash, 1);
        assertFalse(funded);
        _assertUniformReserves(2, 0);
        vm.prank(ALICE);
        vm.expectRevert(SharedOutcomeMarket.NotFunded.selector);
        market.buy(2, 1, true, 1, 1, type(uint256).max);
        vm.prank(ALICE);
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        market.fundRound(2, 1);
        vm.prank(ALICE);
        market.mergePosition(2, 0, 1);
        assertTrue(market.isInitialized(2));
        (cash, funded,,) = market.roundAccounting(2);
        assertEq(cash, 0);
        assertFalse(funded);
    }

    function test_mergeRemainsAvailableWhenSourceRevertsAndAfterCachedClosure() public {
        vm.startPrank(ALICE);
        market.splitPosition(2, 0, 13);
        market.splitPosition(2, 7, 29);
        vm.stopPrank();
        source.set(2, false, false, 0, 0);
        assertEq(market.claimKnown(2), 0); // Successfully observe a closed, unfunded cycle.
        source.setUnavailable(true);
        uint256 beforeWallet = token.balanceOf(ALICE);
        uint256[8] memory amounts;
        amounts[0] = 13;
        amounts[7] = 29;
        vm.prank(ALICE);
        assertEq(market.mergePositions(2, amounts), 42);
        assertEq(token.balanceOf(ALICE) - beforeWallet, 42);
        _assertUniformReserves(2, 0);
        source.setUnavailable(false);
        source.set(2, true, false, 0, 0);
        vm.prank(ALICE);
        vm.expectRevert(SharedOutcomeMarket.InvalidSourceState.selector);
        market.splitPosition(2, 0, 1);
    }

    function test_receivingOnlyOppositeSidesOfDifferentQuestionsCannotCreateAPair() public {
        vm.startPrank(ALICE);
        market.splitPosition(1, 0, 7);
        market.splitPosition(1, 1, 11);
        market.safeTransferFrom(ALICE, BOB, market.positionId(1, 0, true), 7, "");
        market.safeTransferFrom(ALICE, BOB, market.positionId(1, 1, false), 11, "");
        vm.stopPrank();
        uint256[8] memory amounts;
        amounts[0] = 7;
        amounts[1] = 11;
        vm.prank(BOB);
        vm.expectRevert(SharedOutcomeMarket.InsufficientPosition.selector);
        market.mergePositions(1, amounts);
        _assertUniformReserves(1, SEED);
        vm.startPrank(ALICE);
        market.safeTransferFrom(ALICE, BOB, market.positionId(1, 0, false), 7, "");
        market.safeTransferFrom(ALICE, BOB, market.positionId(1, 1, true), 11, "");
        vm.stopPrank();
        uint256 beforeWallet = token.balanceOf(BOB);
        vm.prank(BOB);
        assertEq(market.mergePositions(1, amounts), 18);
        assertEq(token.balanceOf(BOB) - beforeWallet, 18);
        _assertUniformReserves(1, SEED);
    }

    function test_operatorAuthorityTransfersPositionsButCannotRedeemTheOwnersBalanceDirectly() public {
        vm.startPrank(ALICE);
        market.splitPosition(1, 5, 8e18);
        market.setApprovalForAll(OPERATOR, true);
        vm.stopPrank();
        vm.prank(OPERATOR);
        vm.expectRevert(SharedOutcomeMarket.InsufficientPosition.selector);
        market.mergePosition(1, 5, 8e18);
        source.set(1, false, true, 255, 32);
        vm.prank(OPERATOR);
        assertEq(market.claimKnown(1), 0);
        uint256 yesId = market.positionId(1, 5, true);
        assertEq(market.balanceOf(ALICE, yesId), 8e18);
        vm.prank(OPERATOR);
        market.safeTransferFrom(ALICE, BOB, yesId, 8e18, "authorized transfer");
        vm.prank(BOB);
        assertEq(market.claimKnown(1), 8e18);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 0);
        assertEq(market.totalSupply(yesId), 0);
        assertEq(market.totalSupply(market.positionId(1, 5, false)), 0);
        assertEq(token.balanceOf(OPERATOR), 0);
    }

    function test_duplicateBatchIdsAreSequentialAndCannotSpendTheSamePositionTwice() public {
        vm.prank(ALICE);
        market.splitPosition(1, 3, 10);
        uint256 id = market.positionId(1, 3, true);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = id;
        ids[1] = id;
        amounts[0] = 6;
        amounts[1] = 5;
        vm.prank(ALICE);
        vm.expectRevert();
        market.safeBatchTransferFrom(ALICE, BOB, ids, amounts, "");
        assertEq(market.balanceOf(ALICE, id), 10);
        assertEq(market.balanceOf(BOB, id), 0);
        amounts[1] = 4;
        vm.prank(ALICE);
        market.safeBatchTransferFrom(ALICE, BOB, ids, amounts, "");
        assertEq(market.balanceOf(ALICE, id), 0);
        assertEq(market.balanceOf(BOB, id), 10);
        assertEq(market.totalSupply(id), 10);
        amounts[0] = 10;
        amounts[1] = 10;
        vm.prank(BOB);
        market.safeBatchTransferFrom(BOB, BOB, ids, amounts, "self transfer");
        assertEq(market.balanceOf(BOB, id), 10);
        _assertUniformReserves(1, SEED);
    }

    function test_batchFailureAndOversizedAmountsRollBackEveryPosition() public {
        vm.startPrank(ALICE);
        market.splitPosition(1, 0, 7);
        market.splitPosition(1, 1, 11);
        vm.stopPrank();
        uint256[8] memory amounts;
        amounts[0] = 7;
        amounts[1] = 12;
        vm.prank(ALICE);
        vm.expectRevert(SharedOutcomeMarket.InsufficientPosition.selector);
        market.mergePositions(1, amounts);
        amounts[1] = type(uint256).max;
        vm.prank(ALICE);
        vm.expectRevert(SharedOutcomeMarket.InsufficientPosition.selector);
        market.mergePositions(1, amounts);
        assertEq(market.balanceOf(ALICE, market.positionId(1, 0, true)), 7);
        assertEq(market.balanceOf(ALICE, market.positionId(1, 0, false)), 7);
        assertEq(market.balanceOf(ALICE, market.positionId(1, 1, true)), 11);
        assertEq(market.balanceOf(ALICE, market.positionId(1, 1, false)), 11);
        _assertUniformReserves(1, SEED);
    }

    function test_lastTokenIdDoesNotAliasAnotherRoundAndOversizedRoundsReject() public {
        uint256 maximum = market.MAX_ROUND_ID();
        source.set(maximum, true, false, 0, 0);
        vm.prank(ALICE);
        market.splitPosition(maximum, 7, 1);
        uint256 id = market.positionId(maximum, 7, true);
        assertEq(id, type(uint256).max);
        (uint256 round, uint8 question, bool yes) = market.decodePositionId(id);
        assertEq(round, maximum);
        assertEq(question, 7);
        assertTrue(yes);
        assertEq(market.balanceOf(ALICE, id), 1);
        assertEq(market.balanceOf(ALICE, market.positionId(0, 7, true)), 0);
        bytes[7] memory calls = [
            abi.encodeCall(market.positionId, (maximum + 1, 0, false)),
            abi.encodeCall(market.fundRound, (maximum + 1, 1e12)),
            abi.encodeCall(market.splitPosition, (maximum + 1, 0, 1)),
            abi.encodeCall(market.mergePosition, (maximum + 1, 0, 1)),
            abi.encodeCall(market.claimKnown, (maximum + 1)),
            abi.encodeCall(market.roundAccounting, (maximum + 1)),
            abi.encodeCall(market.rollover, (1, maximum + 1))
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory reason) = address(market).call(calls[i]);
            assertFalse(ok);
            assertEq(bytes4(reason), SharedOutcomeMarket.InvalidParameters.selector);
        }
        vm.prank(ALICE);
        assertEq(market.mergePosition(maximum, 7, 1), 1);
        assertEq(market.totalSupply(id), 0);
        assertTrue(market.supportsInterface(type(IERC1155).interfaceId));
    }

    function test_singleReceiverMayForwardButCannotReenterFinancialMethods() public {
        AuditForwardingReceiver receiver = new AuditForwardingReceiver(market, token, BOB);
        token.mint(address(receiver), 10e18);
        receiver.buy();
        uint256 id = market.positionId(1, 1, true);
        assertEq(receiver.callbacks(), 1);
        assertEq(receiver.blocked(), 8);
        assertTrue(market.isApprovedForAll(address(receiver), BOB));
        assertEq(market.balanceOf(address(receiver), id), 0);
        assertEq(market.balanceOf(BOB, id), 15e18);
        assertEq(market.totalSupply(id), 15e18);
        source.set(1, false, true, 255, 2);
        vm.prank(BOB);
        assertEq(market.claimKnown(1), 15e18);
    }

    function test_batchReceiverMayForwardBothNewSidesAndTheRecipientMayMerge() public {
        AuditForwardingReceiver receiver = new AuditForwardingReceiver(market, token, BOB);
        token.mint(address(receiver), 37);
        receiver.split();
        assertEq(receiver.callbacks(), 1);
        assertEq(receiver.blocked(), 8);
        assertEq(market.balanceOf(BOB, market.positionId(2, 7, true)), 37);
        assertEq(market.balanceOf(BOB, market.positionId(2, 7, false)), 37);
        source.setUnavailable(true);
        vm.prank(BOB);
        assertEq(market.mergePosition(2, 7, 37), 37);
        assertEq(token.balanceOf(BOB), 37);
        _assertUniformReserves(2, 0);
    }

    function test_rejectingReceiversRevertThePullAndDoNotCreateGhostSupply() public {
        AuditRejectingReceiver receiver = new AuditRejectingReceiver(market, token);
        token.mint(address(receiver), 20e18);
        vm.expectRevert();
        receiver.split();
        assertFalse(market.isInitialized(2));
        assertEq(market.totalSupply(market.positionId(2, 0, true)), 0);
        assertEq(market.totalSupply(market.positionId(2, 0, false)), 0);
        vm.expectRevert();
        receiver.buy();
        assertEq(token.balanceOf(address(receiver)), 20e18);
        assertEq(token.balanceOf(address(market)), SEED);
        assertEq(market.totalSupply(market.positionId(1, 0, true)), 0);
        vm.prank(ALICE);
        market.splitPosition(1, 0, 1); // The reverted receiver did not leave the lock set.
    }

    function test_topLevelBatchTransferCanRedeemInsideTheReceiverWithoutGhostBalances() public {
        AuditRedeemingReceiver receiver = new AuditRedeemingReceiver(market);
        vm.prank(ALICE);
        market.splitPosition(1, 0, 37);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = market.positionId(1, 0, true);
        ids[1] = market.positionId(1, 0, false);
        amounts[0] = 37;
        amounts[1] = 37;
        source.setUnavailable(true);
        vm.prank(ALICE);
        market.safeBatchTransferFrom(ALICE, address(receiver), ids, amounts, "atomic exit");
        assertEq(receiver.receivedCollateral(), 37);
        assertEq(token.balanceOf(address(receiver)), 37);
        for (uint256 i; i < ids.length; ++i) {
            assertEq(market.balanceOf(ALICE, ids[i]), 0);
            assertEq(market.balanceOf(address(receiver), ids[i]), 0);
            assertEq(market.totalSupply(ids[i]), 0);
        }
        _assertUniformReserves(1, SEED);
    }

    function test_transferredWinnerCanClaimDuringReceiptAfterSponsorRollover() public {
        AuditRedeemingReceiver receiver = new AuditRedeemingReceiver(market);
        vm.prank(ALICE);
        market.splitPosition(1, 0, 37);
        source.set(1, false, true, 255, 1);
        assertEq(market.rollover(1, 2), SEED);
        source.setUnavailable(true);
        uint256 winningId = market.positionId(1, 0, true);
        vm.prank(ALICE);
        market.safeTransferFrom(ALICE, address(receiver), winningId, 37, "atomic winning claim");
        assertEq(receiver.receivedCollateral(), 37);
        assertEq(token.balanceOf(address(receiver)), 37);
        assertEq(market.balanceOf(address(receiver), winningId), 0);
        assertEq(market.totalSupply(winningId), 0);
        (uint256 oldCash,,,) = market.roundAccounting(1);
        assertEq(oldCash, 0);
        (uint256 newCash,,,) = market.roundAccounting(2);
        assertEq(newCash, SEED);
        assertEq(token.balanceOf(address(market)), newCash);
    }

    function test_partialOrMerelyAllKnownAnswersStillRequireTheSourceForClaims() public {
        vm.prank(ALICE);
        market.splitPosition(1, 0, 37);
        uint8[2] memory masks = [uint8(1), uint8(255)];
        for (uint256 i; i < masks.length; ++i) {
            source.setUnavailable(false);
            source.set(1, true, false, masks[i], 1);
            assertEq(market.claimKnown(1), 0); // Cache answers without finalization.
            source.setUnavailable(true);
            vm.prank(ALICE);
            vm.expectRevert(PositionAuditSource.SourceUnavailable.selector);
            market.claimKnown(1);
            assertEq(market.balanceOf(ALICE, market.positionId(1, 0, true)), 37);
            assertEq(market.balanceOf(ALICE, market.positionId(1, 0, false)), 37);
        }
    }

    function _assertUniformReserves(uint256 round, uint256 expected) private view {
        (uint256 cash,,,) = market.roundAccounting(round);
        (uint256[8] memory yes, uint256[8] memory no) = market.liabilities(round);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.totalSupply(market.positionId(round, q, true)), yes[q]);
            assertEq(market.totalSupply(market.positionId(round, q, false)), no[q]);
        }
        for (uint256 ending; ending < 256; ++ending) {
            uint256 liability;
            for (uint8 q; q < 8; ++q) {
                liability += (ending & (uint256(1) << q)) != 0 ? yes[q] : no[q];
            }
            assertEq(cash - liability, expected, "pair operation changed a virtual reserve");
        }
    }
}
