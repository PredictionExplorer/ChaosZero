// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {GameFundedOutcomeMarket} from "../../src/GameFundedOutcomeMarket.sol";
import {IIndependentCollateral} from "../../src/IndependentOutcomeMarket.sol";
import {IIndependentOutcomeSource} from "../../src/interfaces/IIndependentOutcomeSource.sol";
import {OutcomeSettlementVault} from "../../src/OutcomeSettlementVault.sol";
import {MockCst} from "../utils/Mocks.sol";

contract SymbolicCst is MockCst {
    address public immutable game = msg.sender;
}

/// @dev Models only external observations of a truthful V4 ledger and a closing game.
/// The AMM, ERC-1155 positions, settlement vault, pricing and transfers all execute.
contract GameFundedSymbolicTest is Test, IIndependentOutcomeSource {
    uint256 private constant GRANT = 8000 ether;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    SymbolicCst public token;
    GameFundedOutcomeMarket private market;
    OutcomeSettlementVault private vault;
    uint256 private current = 1;
    mapping(uint256 => uint8) private answers;
    mapping(address => mapping(uint256 => uint256)) private issued;

    function setUp() public {
        token = new SymbolicCst();
        market = new GameFundedOutcomeMarket(IIndependentCollateral(address(token)), this, address(this));
        vault = market.settlementVault();
        token.mint(ALICE, 1 << 100);
        token.mint(BOB, 1 << 100);
        vm.prank(ALICE);
        token.approve(address(market), type(uint256).max);
        vm.prank(BOB);
        token.approve(address(market), type(uint256).max);
    }

    function game() external view returns (address) {
        return address(this);
    }

    function cst() external view returns (address) {
        return address(token);
    }

    function chaosZeroFunding(address target, uint256 cycle)
        external
        view
        returns (uint256 amount, uint256 cumulative)
    {
        cumulative = issued[target][cycle];
        amount = cumulative == 0 ? 0 : GRANT;
    }

    function outcomeState(uint256 cycle) external view returns (bool, bool, uint8, uint8) {
        if (cycle < current) return (false, true, 0xff, answers[cycle]);
        return (cycle == current, false, 0, 0);
    }

    function _issue(address target, uint256 cycle, uint256 delta) private {
        issued[target][cycle] = cycle * GRANT;
        token.mint(target, delta * GRANT);
    }

    function _advance(uint256 cycles, uint8 mask) private {
        answers[current] = mask;
        current += cycles;
        _issue(address(market), current, cycles);
    }

    /// @dev Halmos normally discards reverting paths. The outer assertion also catches
    /// an unexpected revert in the token, outcome source, view, or test arithmetic.
    function _mustComplete(bytes memory data) private {
        (bool ok,) = address(this).call(data);
        assert(ok);
    }

    function _expectFundingError(uint256 cycle, bytes4 expected) private {
        vm.prank(BOB);
        (bool ok, bytes memory reason) = address(market).call(abi.encodeCall(market.syncFunding, (cycle)));
        assert(!ok && bytes4(reason) == expected);
    }

    function _sync(uint256 cycle) private {
        vm.prank(BOB);
        market.syncFunding(cycle);
    }

    function check_onlyAuthenticatedGrant(uint96 raw) public {
        _mustComplete(abi.encodeCall(this.onlyAuthenticatedGrant, (raw)));
    }

    function onlyAuthenticatedGrant(uint96 raw) external {
        vm.prank(ALICE);
        assert(token.transfer(address(market), raw));
        _issue(BOB, 1, 1);
        _expectFundingError(1, GameFundedOutcomeMarket.NotFunded.selector);
        assert(market.consumedGameFunding() == 0);
        _issue(address(market), 1, 1);
        _sync(1);
        _sync(1);
        assert(market.consumedGameFunding() == GRANT);
        assert(market.totalActiveCollateral() == GRANT);
        assert(token.balanceOf(address(market)) == GRANT + raw);
        for (uint8 q; q < 8; ++q) {
            assert(market.questionState(1, q).activeCollateral == GRANT / 8);
        }
    }

    function check_reusedLedgerCannotFundAnotherCycle(uint64 dust) public {
        _mustComplete(abi.encodeCall(this.reusedLedgerCannotFundAnotherCycle, (dust)));
    }

    function reusedLedgerCannotFundAnotherCycle(uint64 dust) external {
        _issue(address(market), 1, 1);
        _sync(1);
        vm.prank(ALICE);
        assert(token.transfer(address(market), dust));
        current = 2;
        issued[address(market)][2] = GRANT;
        _expectFundingError(2, GameFundedOutcomeMarket.InvalidGameFunding.selector);
        // Even an increased record cannot be consumed without enough new backing.
        issued[address(market)][2] = 2 * GRANT;
        _expectFundingError(2, GameFundedOutcomeMarket.InvalidGameFunding.selector);
        assert(market.consumedGameFunding() == GRANT);
        assert(market.totalActiveCollateral() == GRANT);
        assert(!market.roundState(2).funded);
    }

    function _buy(uint256 cycle, uint8 q, bool yes) private {
        vm.prank(ALICE);
        market.buy(cycle, q, yes, 100 ether, 150 ether, block.timestamp);
    }

    function _split(address actor, uint256 cycle, uint8 q, uint256 amount) private {
        vm.prank(actor);
        market.splitPosition(cycle, q, amount);
    }

    function check_allOpeningPathsCreditOnce(uint8 first) public {
        vm.assume(first < 3);
        _mustComplete(abi.encodeCall(this.allOpeningPathsCreditOnce, (first)));
    }

    function allOpeningPathsCreditOnce(uint8 first) external {
        _issue(address(market), 1, 1);
        if (first == 0) _sync(1);
        if (first == 1) _buy(1, 3, false);
        if (first == 2) _split(ALICE, 1, 3, 100 ether);
        for (uint8 q; q < 8; ++q) {
            uint256 extra = q == 3 && first != 0 ? 100 ether : 0;
            assert(market.questionState(1, q).activeCollateral == GRANT / 8 + extra);
        }
        assert(market.consumedGameFunding() == GRANT);
        _sync(1);
        _split(BOB, 1, 6, 1 ether);
        _buy(1, 2, true);
        _sync(1);
        assert(market.consumedGameFunding() == GRANT);
        assert(market.totalActiveCollateral() == GRANT + (first == 0 ? 0 : 100 ether) + 101 ether);
    }

    function check_quietGrantsConsumedExactlyOnce(uint8 skipped, uint64 unsolicited) public {
        _mustComplete(abi.encodeCall(this.quietGrantsConsumedExactlyOnce, (skipped, unsolicited)));
    }

    function quietGrantsConsumedExactlyOnce(uint8 skipped, uint64 unsolicited) external {
        _issue(address(market), 1, 1);
        _sync(1);
        vm.prank(ALICE);
        assert(token.transfer(address(market), unsolicited));
        uint256 elapsed = 1 + uint256(skipped);
        _advance(elapsed, 0);
        _sync(current);
        uint256 expected = (1 + elapsed) * GRANT;
        assert(market.consumedGameFunding() == expected);
        assert(market.totalActiveCollateral() == expected);
        assert(token.balanceOf(address(market)) == expected + unsolicited);
        for (uint8 q; q < 8; ++q) {
            assert(market.questionState(current, q).activeCollateral == expected / 8);
        }
        _sync(current);
        assert(market.consumedGameFunding() == expected);
        assert(market.totalActiveCollateral() == expected);
    }

    function check_carryAtCapacitySurvivesRepeatedSync(uint8 extraGrants) public {
        _mustComplete(abi.encodeCall(this.carryAtCapacitySurvivesRepeatedSync, (extraGrants)));
    }

    function carryAtCapacitySurvivesRepeatedSync(uint8 extraGrants) external {
        uint256 cap = market.MAX_INITIAL_QUESTION_FUNDING() * 8;
        current = cap / GRANT + 1 + uint256(extraGrants);
        uint256 minted = current * GRANT;
        _issue(address(market), current, current);
        _sync(current);
        assert(market.consumedGameFunding() == minted);
        assert(market.totalActiveCollateral() == cap);
        assert(market.pendingCarry() == minted - cap);
        _sync(current);
        assert(market.totalActiveCollateral() == cap);
        assert(market.pendingCarry() == minted - cap);
        assert(market.consumedGameFunding() == minted);
    }

    function check_everyOutcomeEscrowsAllWinningUnits(uint8 mask) public {
        _mustComplete(abi.encodeCall(this.everyOutcomeEscrowsAllWinningUnits, (mask)));
    }

    function everyOutcomeEscrowsAllWinningUnits(uint8 mask) external {
        _issue(address(market), 1, 1);
        for (uint8 q; q < 8; ++q) {
            _buy(1, q, true);
            _split(BOB, 1, q, (1 + uint256(q)) * 1 ether);
        }
        _advance(1, mask);
        _sync(2);
        uint256 total;
        for (uint8 q; q < 8; ++q) {
            uint256 expected = (1 + uint256(q)) * 1 ether + uint256((mask >> q) & 1) * 150 ether;
            assert(vault.remaining(1, q) == expected);
            total += expected;
        }
        assert(vault.totalEscrowed() == total);
        assert(token.balanceOf(address(vault)) == total);
        // Old positions added 8 * 100 CST in buys and (1 + ... + 8) CST in splits.
        assert(market.totalActiveCollateral() == 2 * GRANT + 836 ether - total);
        _sync(2);
        assert(token.balanceOf(address(vault)) == total);
        assert(market.consumedGameFunding() == 2 * GRANT);
    }

    function check_lateClaimsSurviveNewCycles(uint64 rawMerge, uint64 remainder, uint64 vaultGift, bool yesWins)
        public
    {
        _mustComplete(abi.encodeCall(this.lateClaimsSurviveNewCycles, (rawMerge, remainder, vaultGift, yesWins)));
    }

    function lateClaimsSurviveNewCycles(uint64 rawMerge, uint64 remainder, uint64 vaultGift, bool yesWins) external {
        uint256 mergeUnits = 1 + uint256(rawMerge);
        uint256 pairs = mergeUnits + 1 + uint256(remainder);
        _issue(address(market), 1, 1);
        _buy(1, 3, true);
        _split(BOB, 1, 3, pairs);
        _advance(1, yesWins ? 8 : 0);
        _split(ALICE, 2, 6, 4 ether);
        uint256 directional = yesWins ? 150 ether : 0;
        vm.prank(ALICE);
        assert(token.transfer(address(vault), vaultGift));
        uint256 firstOwed = pairs + directional;
        assert(vault.remaining(1, 3) == firstOwed);
        assert(token.balanceOf(address(vault)) == firstOwed + vaultGift);
        _advance(1, 0xff);
        _sync(3);
        uint256 pool = 3 * GRANT + 100 ether - directional;
        assert(market.totalActiveCollateral() == pool);
        assert(vault.remaining(1, 3) == firstOwed);
        assert(vault.remaining(2, 6) == 4 ether);
        assert(vault.totalEscrowed() == firstOwed + 4 ether);
        assert(token.balanceOf(address(vault)) == vault.totalEscrowed() + vaultGift);
        uint256 bobBefore = token.balanceOf(BOB);
        vm.prank(BOB);
        assert(market.mergePosition(1, 3, mergeUnits) == mergeUnits);
        assert(token.balanceOf(BOB) == bobBefore + mergeUnits);
        assert(vault.remaining(1, 3) == firstOwed - mergeUnits);
        uint256 aliceBefore = token.balanceOf(ALICE);
        vm.prank(ALICE);
        assert(market.claimKnown(1) == directional);
        assert(token.balanceOf(ALICE) == aliceBefore + directional);
        assert(vault.remaining(1, 3) == pairs - mergeUnits);
        assert(token.balanceOf(address(vault)) == 4 ether + pairs - mergeUnits + vaultGift);
        vm.prank(BOB);
        assert(market.claimKnown(1) == pairs - mergeUnits);
        assert(token.balanceOf(BOB) == bobBefore + pairs);
        assert(vault.remaining(1, 3) == 0);
        assert(vault.totalEscrowed() == 4 ether);
        assert(vault.remaining(2, 6) == 4 ether);
        vm.prank(ALICE);
        assert(market.claimKnown(2) == 4 ether);
        assert(token.balanceOf(ALICE) == aliceBefore + directional + 4 ether);
        assert(vault.totalEscrowed() == 0);
        assert(token.balanceOf(address(vault)) == vaultGift);
        assert(token.balanceOf(address(market)) == pool);
        assert(market.totalActiveCollateral() == pool);
        assert(market.consumedGameFunding() == 3 * GRANT);
    }
}
