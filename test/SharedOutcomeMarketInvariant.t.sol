// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {SharedOutcomeMarket, ISharedCollateral} from "../src/SharedOutcomeMarket.sol";
import {SharedTestSource} from "./SharedOutcomeMarket.t.sol";
import {MockCst} from "./utils/Mocks.sol";

contract SharedMarketHandler is Test {
    SharedOutcomeMarket public market;
    SharedTestSource public source;
    MockCst public token;
    address[3] public actors = [address(101), address(102), address(103)];
    uint256 public cashIn;
    uint256 public cashOut;
    uint256 public untrackedDonations;
    uint256 public currentRound = 1;
    uint256 public rolloverCount;
    uint256 public oldRoundClaimCount;
    uint256 public constant MAX_ROUNDS = 8;
    mapping(uint256 => uint8) public known;
    mapping(uint256 => uint8) public values;
    mapping(uint256 => bool) public finalized;

    constructor(SharedOutcomeMarket market_, SharedTestSource source_, MockCst token_) {
        market = market_;
        source = source_;
        token = token_;
        for (uint256 i; i < 3; ++i) {
            token.mint(actors[i], 1_000_000e18);
            vm.prank(actors[i]);
            token.approve(address(market), type(uint256).max);
        }
    }

    function buy(uint256 actor, uint8 question, bool yes, uint256 raw) external {
        question %= 8;
        uint256 id = currentRound;
        if (finalized[id] || (known[id] & (uint256(1) << question)) != 0) return;
        uint256 amount = bound(raw, 1e12, 1e18);
        (uint256 minimum, uint256 maximum) = _reserveRange(id);
        // Pair the two sides. a + a*min/(max+a) preserves each pair's product;
        // half the extra gives a strict numerical margin and leveraged positions.
        uint256 units = amount + amount * minimum / (2 * (maximum + amount));
        vm.prank(actors[actor % 3]);
        market.buy(id, question, yes, amount, units, type(uint256).max);
        cashIn += amount;
    }

    function sell(uint256 actor, uint8 question, bool yes, uint256 raw) external {
        question %= 8;
        uint256 id = currentRound;
        if (finalized[id] || (known[id] & (uint256(1) << question)) != 0) return;
        address who = actors[actor % 3];
        (uint256[8] memory y, uint256[8] memory n) = market.balancesOf(id, who);
        uint256 owned = yes ? y[question] : n[question];
        if (owned < 1e12) return;
        uint256 amount = bound(raw, 1e12, owned);
        (uint256 minimum, uint256 maximum) = _reserveRange(id);
        // c <= q*min/(2*max+q) preserves each reserve pair on a sell.
        uint256 cash = amount * minimum / (2 * (2 * maximum + amount));
        if (cash == 0) return;
        vm.prank(who);
        market.sell(id, question, yes, amount, cash, type(uint256).max);
        cashOut += cash;
    }

    function reveal(uint8 question, bool answer) external {
        question %= 8;
        uint256 id = currentRound;
        uint8 bit = uint8(uint256(1) << question);
        if (finalized[id] || (known[id] & bit) != 0) return;
        known[id] |= bit;
        if (answer) values[id] |= bit;
        source.set(id, true, false, known[id], values[id]);
    }

    function claim(uint256 actor, uint256 roundSeed) external {
        uint256 id = 1 + roundSeed % currentRound;
        vm.prank(actors[actor % 3]);
        uint256 paid = market.claimKnown(id);
        cashOut += paid;
        if (id < currentRound && paid != 0) ++oldRoundClaimCount;
    }

    function sponsor(uint256 raw) external {
        uint256 id = currentRound;
        if (finalized[id] || known[id] == 255) return;
        uint256 amount = bound(raw, 1, 10e18);
        vm.prank(actors[0]);
        market.fundRound(id, amount);
        cashIn += amount;
    }

    function advance(uint8 finalValues) external {
        uint256 id = currentRound;
        if (finalized[id]) return;
        values[id] |= finalValues & ~known[id];
        known[id] = 255;
        finalized[id] = true;
        source.set(id, false, true, 255, values[id]);
        if (id == MAX_ROUNDS) return;
        currentRound = ++id;
        source.set(id, true, false, 0, 0);
        // A new cycle always has its own accounted seed; previous claims persist.
        vm.prank(actors[0]);
        market.fundRound(id, 10e18);
        cashIn += 10e18;
    }

    function rollover(uint256 fromSeed) external {
        uint256 to = currentRound;
        if (to == 1 || finalized[to] || known[to] == 255) return;
        uint256 from = 1 + fromSeed % (to - 1);
        (uint256 cash,,,) = market.roundAccounting(from);
        (uint256[8] memory y, uint256[8] memory n) = market.liabilities(from);
        uint256 owed;
        for (uint256 q; q < 8; ++q) {
            owed += (values[from] & (uint256(1) << q)) != 0 ? y[q] : n[q];
        }
        if (cash == owed) return;
        uint256 beforePoolBalance = token.balanceOf(address(market));
        assertEq(market.rollover(from, to), cash - owed);
        assertEq(token.balanceOf(address(market)), beforePoolBalance, "rollover moved external collateral");
        ++rolloverCount;
    }

    function directDonation(uint256 actor, uint256 raw) external {
        uint256 amount = bound(raw, 1, 10e18);
        vm.prank(actors[actor % 3]);
        token.transfer(address(market), amount);
        untrackedDonations += amount;
    }

    function finish() external {
        for (uint256 id = 1; id <= currentRound; ++id) {
            known[id] = 255;
            finalized[id] = true;
            source.set(id, false, true, 255, values[id]);
            for (uint256 i; i < 3; ++i) {
                vm.prank(actors[i]);
                cashOut += market.claimKnown(id);
            }
        }
    }

    function _reserveRange(uint256 id) private view returns (uint256 minimum, uint256 maximum) {
        (uint256 cash,,,) = market.roundAccounting(id);
        (uint256[8] memory y, uint256[8] memory n) = market.liabilities(id);
        uint256 minDebt;
        uint256 maxDebt;
        for (uint256 q; q < 8; ++q) {
            uint256 bit = uint256(1) << q;
            if ((known[id] & bit) != 0) {
                uint256 owed = (values[id] & bit) != 0 ? y[q] : n[q];
                minDebt += owed;
                maxDebt += owed;
            } else {
                minDebt += y[q] < n[q] ? y[q] : n[q];
                maxDebt += y[q] > n[q] ? y[q] : n[q];
            }
        }
        minimum = cash - maxDebt;
        maximum = cash - minDebt;
    }
}

contract SharedOutcomeMarketInvariantTest is StdInvariant, Test {
    SharedOutcomeMarket internal market;
    SharedTestSource internal source;
    MockCst internal token;
    SharedMarketHandler internal handler;
    uint256 internal constant SEED = 1000e18;

    function setUp() public {
        token = new MockCst();
        source = new SharedTestSource();
        source.set(1, true, false, 0, 0);
        market = new SharedOutcomeMarket(ISharedCollateral(address(token)), source);
        token.mint(address(this), SEED);
        token.approve(address(market), type(uint256).max);
        market.fundRound(1, SEED);
        handler = new SharedMarketHandler(market, source, token);
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.buy.selector;
        selectors[1] = handler.sell.selector;
        selectors[2] = handler.reveal.selector;
        selectors[3] = handler.claim.selector;
        selectors[4] = handler.sponsor.selector;
        selectors[5] = handler.advance.selector;
        selectors[6] = handler.rollover.selector;
        selectors[7] = handler.directDonation.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_exactCustodyAndFlowsAcrossCycles() public view {
        uint256 accounted;
        for (uint256 id = 1; id <= handler.currentRound(); ++id) {
            (uint256 cash,,,) = market.roundAccounting(id);
            accounted += cash;
        }
        assertEq(accounted + handler.untrackedDonations(), token.balanceOf(address(market)));
        assertEq(accounted, SEED + handler.cashIn() - handler.cashOut());
    }

    function invariant_allCycleLiabilitiesEqualUserPositions() public view {
        for (uint256 id = 1; id <= handler.currentRound(); ++id) {
            (uint256[8] memory y, uint256[8] memory n) = market.liabilities(id);
            uint256[8] memory sumY;
            uint256[8] memory sumN;
            for (uint256 a; a < 3; ++a) {
                (uint256[8] memory userY, uint256[8] memory userN) = market.balancesOf(id, handler.actors(a));
                for (uint256 q; q < 8; ++q) {
                    sumY[q] += userY[q];
                    sumN[q] += userN[q];
                }
            }
            for (uint256 q; q < 8; ++q) {
                assertEq(y[q], sumY[q]);
                assertEq(n[q], sumN[q]);
            }
        }
    }

    function invariant_everyFeasibleEndingOfEveryCycleBacked() public view {
        for (uint256 id = 1; id <= handler.currentRound(); ++id) {
            (uint256 cash,,,) = market.roundAccounting(id);
            (uint256[8] memory y, uint256[8] memory n) = market.liabilities(id);
            uint8 mask = handler.known(id);
            uint8 val = handler.values(id);
            for (uint256 s; s < 256; ++s) {
                if ((s & mask) != val) continue;
                uint256 liability;
                for (uint256 q; q < 8; ++q) {
                    liability += (s & (uint256(1) << q)) != 0 ? y[q] : n[q];
                }
                assertGe(cash, liability, "old or current claims lost backing");
                if (!handler.finalized(id)) assertGt(cash, liability, "active reserve was drained");
            }
        }
    }

    function afterInvariant() public {
        handler.finish();
        invariant_exactCustodyAndFlowsAcrossCycles();
        for (uint256 id = 1; id <= handler.currentRound(); ++id) {
            (uint256[8] memory y, uint256[8] memory n) = market.liabilities(id);
            for (uint256 q; q < 8; ++q) {
                assertEq(y[q], 0);
                assertEq(n[q], 0);
            }
        }
    }

    function test_oldWinnersRemainPayableAfterSeveralRolloverGenerations() public {
        handler.buy(0, 0, true, 1e18);
        handler.advance(1);
        handler.rollover(0);
        handler.buy(1, 1, false, 1e18);
        handler.advance(0);
        handler.rollover(1);
        handler.directDonation(2, 3e18);
        handler.claim(0, 0);
        handler.claim(1, 1);
        assertEq(handler.oldRoundClaimCount(), 2);
        assertEq(handler.rolloverCount(), 2);
        invariant_exactCustodyAndFlowsAcrossCycles();
        invariant_allCycleLiabilitiesEqualUserPositions();
        invariant_everyFeasibleEndingOfEveryCycleBacked();
    }
}
