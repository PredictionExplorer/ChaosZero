// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test, Vm} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IndependentOutcomeMarket, IIndependentCollateral, MIN_AUTO_TOP_UP} from "../src/IndependentOutcomeMarket.sol";
import {IIndependentOutcomeSource} from "../src/interfaces/IIndependentOutcomeSource.sol";
import {OutcomeSettlementVault} from "../src/OutcomeSettlementVault.sol";
import {MockCst} from "./utils/Mocks.sol";

contract IndependentOracleSource is IIndependentOutcomeSource {
    struct State {
        bool open;
        bool finalized;
        uint8 known;
        uint8 values;
        uint256 start;
        uint256 end;
    }
    mapping(uint256 => State) public states;
    mapping(uint256 => bool) public unavailable;
    error SourceUnavailable(uint256 roundId);

    function set(uint256 id, bool open, bool finalized, uint8 known, uint8 values, uint256 start, uint256 end)
        external
    {
        states[id] = State(open, finalized, known, values, start, end);
    }

    function setUnavailable(uint256 id, bool value) external {
        unavailable[id] = value;
    }

    function outcomeState(uint256 id) external view returns (bool, bool, uint8, uint8) {
        if (unavailable[id]) revert SourceUnavailable(id);
        State memory s = states[id];
        return (s.open, s.finalized, s.known, s.values);
    }

    function cycleTimes(uint256 id) external view returns (uint256, uint256) {
        if (unavailable[id]) revert SourceUnavailable(id);
        return (states[id].start, states[id].end);
    }
}

/// @dev Fourth invariant actor is a contract wallet. Its callbacks exercise the
/// token boundary without changing the accounting oracle behind its back.
contract IndependentInvariantReceiver is IERC1155Receiver {
    IndependentOutcomeMarket private immutable _market;
    uint256 public callbacks;
    uint256 public lockedCallbacks;

    constructor(IndependentOutcomeMarket market_) {
        _market = market_;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC165).interfaceId || id == type(IERC1155Receiver).interfaceId;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        _check();
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        returns (bytes4)
    {
        _check();
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function _check() private {
        require(msg.sender == address(_market), "unexpected position token");
        ++callbacks;
        (bool ok, bytes memory reason) = address(_market).call(abi.encodeCall(_market.mergePosition, (0, 0, 0)));
        require(!ok, "zero merge unexpectedly succeeded");
        if (bytes4(reason) == IndependentOutcomeMarket.ReentrantCall.selector) ++lockedCallbacks;
    }
}

contract IndependentMarketHandler is Test {
    uint256 public constant INITIAL_WALLET = 1e30;
    uint256 public constant MAX_CYCLES = 6;
    IndependentOutcomeMarket public immutable market;
    IndependentOracleSource public immutable source;
    MockCst public immutable token;
    IndependentInvariantReceiver public immutable receiver;
    address[4] public actors;
    uint256[4] public wallets;
    bool[4][4] public approvals;

    struct ModelQuestion {
        uint256 cash;
        uint256 yes;
        uint256 no;
        uint256 escrow;
        uint16 weight;
    }

    struct ModelRound {
        bool initialized;
        bool funded;
        bool settled;
        bool gameClosed;
        uint8 known;
        uint8 values;
        uint64 start;
        uint64 end;
        ModelQuestion[8] questions;
    }

    struct Holdings {
        uint256[8] yes;
        uint256[8] no;
    }
    mapping(uint256 => ModelRound) private _model;
    mapping(uint256 => mapping(uint256 => Holdings)) private _holdings;
    uint256 public currentCycle = 1;
    uint256 public lastFundedCycle;
    uint256 public activeCash;
    uint256 public carry;
    uint256 public vaultCash;
    uint256 public marketDonations;
    /// @dev Plain market transfers not yet absorbed into any pool or carry.
    uint256 public unallocated;
    uint256 public absorptions;
    /// @dev Cycles started by a buy or sell rather than by fundRound.
    uint256 public autoStarts;
    /// @dev Held transfers placed into a trading cycle by a buy or sell.
    uint256 public tradeAbsorptions;
    /// @dev Bare `fundRound(cycle, 0)` calls that distributed held transfers.
    uint256 public triggerAbsorptions;
    /// @dev Bare triggers below MIN_AUTO_TOP_UP that correctly moved nothing.
    uint256 public idleTriggers;
    /// @dev RoundFunded events the engine emitted, each matched field by field.
    uint256 public fundingEvents;
    bool private _expectFunding;
    uint256 private _expectDonated;
    uint256 private _expectTransfers;
    uint256 private _expectCarry;
    uint256 public vaultDonations;
    uint256 public carryOnlyFundings;
    uint256 public lateClaims;
    uint256 public postCloseMerges;
    uint256 public settledCycles;
    uint256 public knownAnswerTrades;

    constructor(IndependentOutcomeMarket m, IndependentOracleSource s, MockCst t) {
        market = m;
        source = s;
        token = t;
        receiver = new IndependentInvariantReceiver(m);
        actors = [address(101), address(102), address(103), address(receiver)];
        for (uint256 a; a < 4; ++a) {
            token.mint(actors[a], INITIAL_WALLET);
            wallets[a] = INITIAL_WALLET;
            vm.prank(actors[a]);
            token.approve(address(market), type(uint256).max);
        }
        _open(1);
    }

    function modelRound(uint256 id) external view returns (ModelRound memory) {
        return _model[id];
    }

    function holdings(uint256 id, uint256 actor) external view returns (Holdings memory) {
        return _holdings[id][actor];
    }

    function fund(uint256 actor, uint256 raw) external {
        if (_model[currentCycle].gameClosed) return;
        _fund(actor % 4, bound(raw, market.MIN_FUNDING(), 1000e18));
    }

    function fundFromCarry(uint256 actor) external {
        ModelRound storage r = _model[currentCycle];
        if (r.gameClosed || r.funded || !_startable()) return;
        _fund(actor % 4, 0);
        ++carryOnlyFundings;
    }

    /// @dev Bare `fundRound(cycle, 0)`: distributes held transfers into a trading
    /// cycle, and moves nothing (InvalidParameters) below MIN_AUTO_TOP_UP.
    function trigger(uint256 actor) external {
        ModelRound storage r = _model[currentCycle];
        if (r.gameClosed || !r.funded) return;
        if (unallocated < MIN_AUTO_TOP_UP) {
            vm.prank(actors[actor % 4]);
            vm.expectRevert(IndependentOutcomeMarket.InvalidParameters.selector);
            market.fundRound(currentCycle, 0);
            ++idleTriggers;
            return;
        }
        _fund(actor % 4, 0);
        ++triggerAbsorptions;
    }

    function _fund(uint256 actor, uint256 amount) private {
        unallocated += amount; // Pulled first; then absorbed like any held CST.
        wallets[actor] -= amount;
        require(_modelAbsorb(amount), "model expected no funding");
        vm.recordLogs();
        vm.prank(actors[actor]);
        market.fundRound(currentCycle, amount);
        _checkFunding(actors[actor]);
    }

    /// @dev The engine emitted RoundFunded exactly when the model absorbed, with the
    /// model's caller, donated/transfers/carry split and eight-way allocations.
    function _checkFunding(address caller) private {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        uint256 total = _expectDonated + _expectTransfers + _expectCarry;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != address(market) || logs[i].topics[0] != IndependentOutcomeMarket.RoundFunded.selector
            ) {
                continue;
            }
            ++seen;
            assertEq(uint256(logs[i].topics[1]), currentCycle);
            assertEq(address(uint160(uint256(logs[i].topics[2]))), caller);
            (uint256 donated, uint256 transfersUsed, uint256 carryUsed, uint256[8] memory allocations) =
                abi.decode(logs[i].data, (uint256, uint256, uint256, uint256[8]));
            assertEq(donated, _expectDonated, "donated");
            assertEq(transfersUsed, _expectTransfers, "transfersUsed");
            assertEq(carryUsed, _expectCarry, "carryUsed");
            for (uint8 q; q < 8; ++q) {
                assertEq(allocations[q], total / 8 + (q < total % 8 ? 1 : 0));
            }
        }
        assertEq(seen, _expectFunding ? 1 : 0, "engine and model disagree on absorption");
        fundingEvents += seen;
        _expectFunding = false;
    }

    /// @dev Whether a first funding of the current cycle can collect MIN_FUNDING.
    function _startable() private view returns (bool) {
        uint256 available = carry + unallocated;
        if (lastFundedCycle != 0 && !_model[lastFundedCycle].settled) {
            if (!_model[lastFundedCycle].gameClosed) return false;
            (, uint256 residue) = _settlementAmounts(lastFundedCycle);
            available += residue;
        }
        return available >= market.MIN_FUNDING();
    }

    /// @dev Independent model of `_absorb`: carry only at first funding, held
    /// transfers always, nothing below the threshold. Capacity never binds here.
    /// `donated` is the caller's pulled CST, already counted in `unallocated`.
    function _modelAbsorb(uint256 donated) private returns (bool) {
        ModelRound storage r = _model[currentCycle];
        bool initial = !r.funded;
        _expectFunding = false;
        if (initial) {
            if (!_startable()) return false;
            if (lastFundedCycle != 0 && !_model[lastFundedCycle].settled) _modelSettle(lastFundedCycle);
        }
        uint256 carryUsed = initial ? carry : 0;
        uint256 total = unallocated + carryUsed;
        if (total < (initial ? market.MIN_FUNDING() : (donated != 0 ? 1 : MIN_AUTO_TOP_UP))) return false;
        (_expectFunding, _expectDonated) = (true, donated);
        (_expectTransfers, _expectCarry) = (unallocated - donated, carryUsed);
        if (initial) {
            if (!r.initialized) {
                (uint16[8] memory seeds,) = market.seedPreview(currentCycle);
                for (uint8 q; q < 8; ++q) {
                    r.questions[q].weight = seeds[q];
                }
                r.initialized = true;
            }
            carry = 0;
            r.funded = true;
            lastFundedCycle = currentCycle;
        }
        for (uint8 q; q < 8; ++q) {
            r.questions[q].cash += total / 8 + (q < total % 8 ? 1 : 0);
        }
        activeCash += total;
        unallocated = 0;
        ++absorptions;
        return true;
    }

    function buy(uint256 actor, uint8 question, bool yes, uint256 raw) external {
        uint256 a = actor % 4;
        uint8 q = question % 8;
        ModelRound storage r = _model[currentCycle];
        if (r.gameClosed || (!r.funded && !_startable())) return;
        bool starting = !r.funded;
        bool absorbed = _modelAbsorb(0);
        if (starting) ++autoStarts;
        else if (absorbed) ++tradeAbsorptions;
        ModelQuestion storage p = r.questions[q];
        uint256 cash = bound(raw, 1e12, 1e18);
        uint256 selected = p.cash - (yes ? p.yes : p.no);
        uint256 other = p.cash - (yes ? p.no : p.yes);
        uint256 weight = yes ? p.weight : 10_000 - p.weight;
        uint256 units = cash + (10_000 - weight) * cash * selected / (2 * (weight * other + 10_000 * cash));
        bytes32 untouched = _otherQuestions(currentCycle, q);
        vm.recordLogs();
        vm.prank(actors[a]);
        market.buy(currentCycle, q, yes, cash, units, type(uint256).max);
        _checkFunding(actors[a]);
        if (!absorbed) {
            assertEq(_otherQuestions(currentCycle, q), untouched, "single-question buy leaked into another question");
        }
        p.cash += cash;
        if (yes) {
            p.yes += units;
            _holdings[currentCycle][a].yes[q] += units;
        } else {
            p.no += units;
            _holdings[currentCycle][a].no[q] += units;
        }
        activeCash += cash;
        wallets[a] -= cash;
        if ((r.known & (uint8(1) << q)) != 0) ++knownAnswerTrades;
    }

    function sell(uint256 actor, uint8 question, bool yes, uint256 raw) external {
        uint256 a = actor % 4;
        uint8 q = question % 8;
        ModelRound storage r = _model[currentCycle];
        if (r.gameClosed || (!r.funded && !_startable())) return;
        ModelQuestion storage p = r.questions[q];
        Holdings storage h = _holdings[currentCycle][a];
        uint256 owned = yes ? h.yes[q] : h.no[q];
        if (owned < 1e12) return;
        bool starting = !r.funded; // Split-only pairs: the sell starts the cycle first.
        bool absorbed = _modelAbsorb(0);
        uint256 units = bound(raw, 1e12, owned);
        uint256 selected = p.cash - (yes ? p.yes : p.no);
        uint256 other = p.cash - (yes ? p.no : p.yes);
        uint256 weight = yes ? p.weight : 10_000 - p.weight;
        uint256 cash = weight * units * other / (2 * (weight * other + (10_000 - weight) * selected + 10_000 * units));
        if (cash == 0) {
            if (absorbed) {
                vm.recordLogs();
                vm.prank(actors[a]); // Same threshold as the skipped sell: keep engine and model in step.
                market.fundRound(currentCycle, 0);
                _checkFunding(actors[a]);
            }
            return;
        }
        if (starting) ++autoStarts;
        else if (absorbed) ++tradeAbsorptions;
        bytes32 untouched = _otherQuestions(currentCycle, q);
        vm.recordLogs();
        vm.prank(actors[a]);
        market.sell(currentCycle, q, yes, units, cash, type(uint256).max);
        _checkFunding(actors[a]);
        if (!absorbed) {
            assertEq(_otherQuestions(currentCycle, q), untouched, "single-question sell leaked into another question");
        }
        p.cash -= cash;
        if (yes) {
            p.yes -= units;
            h.yes[q] -= units;
        } else {
            p.no -= units;
            h.no[q] -= units;
        }
        activeCash -= cash;
        wallets[a] += cash;
        if ((r.known & (uint8(1) << q)) != 0) ++knownAnswerTrades;
    }

    function split(uint256 actor, uint8 question, uint256 raw) external {
        if (_model[currentCycle].gameClosed) return;
        uint256 a = actor % 4;
        uint8 q = question % 8;
        uint256 amount = bound(raw, 1, 10e18);
        vm.prank(actors[a]);
        market.splitPosition(currentCycle, q, amount);
        _touch(currentCycle);
        ModelQuestion storage p = _model[currentCycle].questions[q];
        p.cash += amount;
        p.yes += amount;
        p.no += amount;
        _holdings[currentCycle][a].yes[q] += amount;
        _holdings[currentCycle][a].no[q] += amount;
        activeCash += amount;
        wallets[a] -= amount;
    }

    function merge(uint256 actor, uint256 roundSeed, uint256 mask, uint256 raw) external {
        uint256 a = actor % 4;
        uint256 id = 1 + roundSeed % currentCycle;
        ModelRound storage r = _model[id];
        if (!r.initialized) return;
        Holdings storage h = _holdings[id][a];
        uint256[8] memory amounts;
        uint256 total;
        for (uint8 q; q < 8; ++q) {
            if ((mask & (uint256(1) << q)) == 0) continue;
            uint256 matched = h.yes[q] < h.no[q] ? h.yes[q] : h.no[q];
            if (matched != 0) {
                amounts[q] = 1 + raw % matched;
                total += amounts[q];
            }
        }
        if (total == 0) return;
        vm.prank(actors[a]);
        assertEq(market.mergePositions(id, amounts), total);
        for (uint8 q; q < 8; ++q) {
            uint256 amount = amounts[q];
            h.yes[q] -= amount;
            h.no[q] -= amount;
            r.questions[q].yes -= amount;
            r.questions[q].no -= amount;
            if (r.settled) r.questions[q].escrow -= amount;
            else r.questions[q].cash -= amount;
        }
        if (r.settled) {
            vaultCash -= total;
        } else {
            activeCash -= total;
            if (r.gameClosed) ++postCloseMerges;
        }
        wallets[a] += total;
    }

    function approve(uint256 actor, uint256 operator, bool allowed) external {
        uint256 a = actor % 4;
        uint256 o = operator % 4;
        if (a == o) return;
        vm.prank(actors[a]);
        market.setApprovalForAll(actors[o], allowed);
        approvals[a][o] = allowed;
    }

    function transfer(
        uint256 actor,
        uint256 recipient,
        uint256 roundSeed,
        uint8 question,
        bool yes,
        uint256 raw,
        bool operator
    ) external {
        uint256 a = actor % 4;
        uint256 b = recipient % 4;
        uint256 id = 1 + roundSeed % currentCycle;
        uint8 q = question % 8;
        uint256 owned = yes ? _holdings[id][a].yes[q] : _holdings[id][a].no[q];
        if (owned == 0) return;
        uint256 sender = operator ? (a + 1) % 4 : a;
        if (operator && !approvals[a][sender]) return;
        uint256 amount = 1 + raw % owned;
        uint256 tokenId = market.positionId(id, q, yes);
        vm.prank(actors[sender]);
        market.safeTransferFrom(actors[a], actors[b], tokenId, amount, "invariant transfer");
        if (yes) {
            _holdings[id][a].yes[q] -= amount;
            _holdings[id][b].yes[q] += amount;
        } else {
            _holdings[id][a].no[q] -= amount;
            _holdings[id][b].no[q] += amount;
        }
    }

    function reveal(uint8 question, bool answer) external {
        ModelRound storage r = _model[currentCycle];
        uint8 bit = uint8(1) << (question % 8);
        if (r.gameClosed || (r.known & bit) != 0) return;
        r.known |= bit;
        if (answer) r.values |= bit;
        _writeSource(currentCycle);
    }

    function tick(uint32 seconds_) external {
        vm.warp(block.timestamp + 1 + uint256(seconds_) % 300);
    }

    function closeAndAdvance(uint8 finalValues) external {
        if (!_model[currentCycle].gameClosed) _close(currentCycle, finalValues);
        if (currentCycle < MAX_CYCLES) {
            ++currentCycle;
            vm.warp(block.timestamp + 1);
            _open(currentCycle);
        }
    }

    function settle(uint256 roundSeed) external {
        uint256 id = 1 + roundSeed % currentCycle;
        if (!_model[id].initialized || !_model[id].gameClosed || _model[id].settled) return;
        (uint256 expectedDebt, uint256 expectedCarry) = _modelSettle(id);
        (uint256 actualDebt, uint256 actualCarry) = market.settleRound(id);
        assertEq(actualDebt, expectedDebt);
        assertEq(actualCarry, expectedCarry);
    }

    function claim(uint256 actor, uint256 roundSeed) external {
        uint256 id = 1 + roundSeed % currentCycle;
        if (!_model[id].initialized || !_model[id].gameClosed) return;
        _claim(actor % 4, id);
    }

    function _claim(uint256 actor, uint256 id) private {
        ModelRound storage r = _model[id];
        if (!r.settled) _modelSettle(id);
        Holdings storage h = _holdings[id][actor];
        uint256 expected;
        for (uint8 q; q < 8; ++q) {
            uint256 paid = (r.values & (uint8(1) << q)) != 0 ? h.yes[q] : h.no[q];
            expected += paid;
            r.questions[q].yes -= h.yes[q];
            r.questions[q].no -= h.no[q];
            r.questions[q].escrow -= paid;
            h.yes[q] = 0;
            h.no[q] = 0;
        }
        vm.prank(actors[actor]);
        assertEq(market.claimKnown(id), expected);
        vaultCash -= expected;
        wallets[actor] += expected;
        if (id < currentCycle && expected != 0) ++lateClaims;
    }

    function offline(uint256 roundSeed) external {
        uint256 id = 1 + roundSeed % currentCycle;
        if (_model[id].settled) source.setUnavailable(id, true);
    }

    function donate(uint256 actor, uint256 raw, bool toVault) external {
        uint256 a = actor % 4;
        uint256 amount = bound(raw, 1, 10e18);
        address target = toVault ? address(market.settlementVault()) : address(market);
        vm.prank(actors[a]);
        token.transfer(target, amount);
        if (toVault) vaultDonations += amount;
        else marketDonations += amount;
        if (!toVault) unallocated += amount;
        wallets[a] -= amount;
    }

    /// @dev Teardown step: from whatever state the campaign reached, a direct transfer
    /// then the first buy of a fresh cycle settles the last funded cycle and starts
    /// the pools from carry plus held CST, with no fundRound.
    function startFreshCycleWithABuy() external {
        if (!_model[currentCycle].gameClosed) _close(currentCycle, 0);
        ++currentCycle;
        vm.warp(block.timestamp + 1);
        _open(currentCycle);
        this.donate(0, 2e18, false); // Makes any reachable state startable.
        uint256 before = autoStarts;
        this.buy(1, 2, currentCycle % 2 == 0, 1e18);
        assertEq(autoStarts, before + 1, "the first buy did not start the cycle");
        assertEq(unallocated, 0);
        assertEq(carry, 0);
    }

    /// @dev R1 end to end: a direct transfer of at least MIN_AUTO_TOP_UP, then the
    /// next buy, which must absorb it (or start the cycle with it) before pricing.
    function transferThenBuy(uint256 actor, uint256 raw, uint8 question, bool yes, uint256 rawCash) external {
        this.donate(actor, bound(raw, MIN_AUTO_TOP_UP, 10e18), false);
        this.buy(actor % 4 + 1, question, yes, rawCash); // Usually another actor.
    }

    function finish() external {
        if (!_model[currentCycle].gameClosed) _close(currentCycle, 0);
        for (uint256 id = 1; id <= currentCycle; ++id) {
            if (!_model[id].initialized) continue;
            if (!_model[id].settled) {
                (uint256 debt, uint256 residue) = _modelSettle(id);
                (uint256 actualDebt, uint256 actualResidue) = market.settleRound(id);
                assertEq(actualDebt, debt);
                assertEq(actualResidue, residue);
            }
            for (uint256 a; a < 4; ++a) {
                _claim(a, id);
            }
        }
    }

    function _modelSettle(uint256 id) private returns (uint256 debt, uint256 residue) {
        ModelRound storage r = _model[id];
        require(r.gameClosed && !r.settled, "invalid oracle settlement");
        for (uint8 q; q < 8; ++q) {
            ModelQuestion storage p = r.questions[q];
            p.escrow = (r.values & (uint8(1) << q)) != 0 ? p.yes : p.no;
            debt += p.escrow;
            residue += p.cash - p.escrow;
            p.cash = 0;
        }
        activeCash -= debt + residue;
        vaultCash += debt;
        carry += residue;
        r.settled = true;
        ++settledCycles;
    }

    function _settlementAmounts(uint256 id) private view returns (uint256 debt, uint256 residue) {
        ModelRound storage r = _model[id];
        for (uint8 q; q < 8; ++q) {
            ModelQuestion storage p = r.questions[q];
            uint256 owed = (r.values & (uint8(1) << q)) != 0 ? p.yes : p.no;
            debt += owed;
            residue += p.cash - owed;
        }
    }

    function _touch(uint256 id) private {
        ModelRound storage r = _model[id];
        if (r.initialized) return;
        // A seed is immutable configuration; all balances and cash below are
        // independently derived from action inputs, never copied from the engine.
        uint16[8] memory weights = market.initialPrices(id);
        for (uint8 q; q < 8; ++q) {
            assertGe(weights[q], 1);
            assertLe(weights[q], 9999);
            r.questions[q].weight = weights[q];
        }
        r.initialized = true;
    }

    function _open(uint256 id) private {
        _model[id].start = uint64(block.timestamp);
        _writeSource(id);
    }

    function _close(uint256 id, uint8 values_) private {
        ModelRound storage r = _model[id];
        vm.warp(block.timestamp + 5);
        r.values |= values_ & ~r.known;
        r.known = 255;
        r.gameClosed = true;
        r.end = uint64(block.timestamp);
        _writeSource(id);
    }

    function _writeSource(uint256 id) private {
        ModelRound storage r = _model[id];
        source.set(id, !r.gameClosed, r.gameClosed, r.known, r.values, r.start, r.end);
    }

    function _otherQuestions(uint256 id, uint8 changed) private view returns (bytes32 hash) {
        for (uint8 q; q < 8; ++q) {
            if (q == changed) continue;
            IndependentOutcomeMarket.QuestionView memory p = market.questionState(id, q);
            hash = keccak256(
                abi.encode(
                    hash,
                    p.activeCollateral,
                    p.yesSupply,
                    p.noSupply,
                    p.escrowRemaining,
                    p.initialYesBps,
                    p.currentYesBps
                )
            );
        }
    }
}

contract IndependentMarketInvariantTest is StdInvariant, Test {
    IndependentOutcomeMarket private market;
    IndependentOracleSource private source;
    MockCst private token;
    IndependentMarketHandler private handler;

    function setUp() public {
        vm.warp(100_000);
        source = new IndependentOracleSource();
        token = new MockCst();
        market = new IndependentOutcomeMarket(IIndependentCollateral(address(token)), source);
        handler = new IndependentMarketHandler(market, source, token);
        handler.fund(0, 800e18 + 5);
        bytes4[] memory selectors = new bytes4[](17);
        selectors[0] = handler.fund.selector;
        selectors[1] = handler.fundFromCarry.selector;
        selectors[2] = handler.buy.selector;
        selectors[3] = handler.sell.selector;
        selectors[4] = handler.split.selector;
        selectors[5] = handler.merge.selector;
        selectors[6] = handler.transfer.selector;
        selectors[7] = handler.approve.selector;
        selectors[8] = handler.reveal.selector;
        selectors[9] = handler.tick.selector;
        selectors[10] = handler.closeAndAdvance.selector;
        selectors[11] = handler.settle.selector;
        selectors[12] = handler.claim.selector;
        selectors[13] = handler.donate.selector;
        selectors[14] = handler.offline.selector;
        selectors[15] = handler.trigger.selector;
        selectors[16] = handler.transferThenBuy.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_cashAndWalletsMatchIndependentFlows() public view {
        OutcomeSettlementVault vault = market.settlementVault();
        assertEq(market.totalActiveCollateral(), handler.activeCash());
        assertEq(market.pendingCarry(), handler.carry());
        assertEq(token.balanceOf(address(market)), handler.activeCash() + handler.carry() + handler.unallocated());
        assertEq(vault.totalEscrowed(), handler.vaultCash());
        assertEq(token.balanceOf(address(vault)), handler.vaultCash() + handler.vaultDonations());
        uint256 total = token.balanceOf(address(market)) + token.balanceOf(address(vault));
        for (uint256 a; a < 4; ++a) {
            uint256 balance = token.balanceOf(handler.actors(a));
            assertEq(balance, handler.wallets(a), "wallet received or lost unmodeled CST");
            total += balance;
        }
        assertEq(total, 4 * handler.INITIAL_WALLET());
    }

    function invariant_questionBackingAndEscrowsMatchTheOracle() public view {
        uint256 active;
        uint256 escrow;
        for (uint256 id = 1; id <= handler.currentCycle(); ++id) {
            IndependentMarketHandler.ModelRound memory expected = handler.modelRound(id);
            IndependentOutcomeMarket.RoundView memory round = market.roundState(id);
            assertEq(round.initialized, expected.initialized);
            assertEq(round.funded, expected.funded);
            assertEq(round.settled, expected.settled);
            IndependentOutcomeMarket.QuestionView[8] memory actual = market.questionStates(id);
            for (uint8 q; q < 8; ++q) {
                IndependentMarketHandler.ModelQuestion memory p = expected.questions[q];
                assertEq(actual[q].activeCollateral, p.cash);
                assertEq(actual[q].yesSupply, p.yes);
                assertEq(actual[q].noSupply, p.no);
                assertEq(actual[q].escrowRemaining, p.escrow);
                assertEq(actual[q].initialYesBps, p.weight);
                active += p.cash;
                escrow += p.escrow;
                if (expected.settled) {
                    assertEq(p.cash, 0);
                    assertEq(p.escrow, (expected.values & (uint8(1) << q)) != 0 ? p.yes : p.no);
                } else {
                    uint256 largest = p.yes > p.no ? p.yes : p.no;
                    if (expected.funded) {
                        assertGt(p.cash, largest, "funded reserve depleted");
                        uint256 weightedYes = uint256(p.weight) * (p.cash - p.no);
                        uint256 weightedNo = (10_000 - uint256(p.weight)) * (p.cash - p.yes);
                        assertEq(actual[q].currentYesBps, weightedYes * 10_000 / (weightedYes + weightedNo));
                    } else {
                        assertGe(p.cash, largest, "split-only claims unbacked");
                    }
                }
            }
        }
        assertEq(active, handler.activeCash());
        assertEq(escrow, handler.vaultCash());
    }

    function invariant_allIssuedUnitsBelongToTheFourActors() public view {
        for (uint256 id = 1; id <= handler.currentCycle(); ++id) {
            uint256[8] memory sumY;
            uint256[8] memory sumN;
            for (uint256 a; a < 4; ++a) {
                IndependentMarketHandler.Holdings memory expected = handler.holdings(id, a);
                (uint256[8] memory yes, uint256[8] memory no) = market.balancesOf(id, handler.actors(a));
                for (uint8 q; q < 8; ++q) {
                    assertEq(yes[q], expected.yes[q]);
                    assertEq(no[q], expected.no[q]);
                    sumY[q] += yes[q];
                    sumN[q] += no[q];
                }
            }
            for (uint8 q; q < 8; ++q) {
                assertEq(market.totalSupply(market.positionId(id, q, true)), sumY[q]);
                assertEq(market.totalSupply(market.positionId(id, q, false)), sumN[q]);
            }
        }
        for (uint256 a; a < 4; ++a) {
            for (uint256 o; o < 4; ++o) {
                assertEq(market.isApprovedForAll(handler.actors(a), handler.actors(o)), handler.approvals(a, o));
            }
        }
    }

    function test_heldTransfersAbsorbAndCyclesAutoStartWithoutFundRound() public {
        handler.donate(0, 5e18, false);
        handler.buy(1, 0, true, 1e18); // Absorbs the held transfer before pricing.
        assertEq(handler.unallocated(), 0);
        handler.donate(1, 1e17, false);
        handler.buy(2, 1, false, 1e18); // Below threshold: held.
        assertEq(handler.unallocated(), 1e17);
        handler.closeAndAdvance(0);
        handler.donate(2, 3e18, false); // No cycle trading: waits.
        handler.buy(0, 2, true, 1e18); // First trade settles cycle 1 and starts cycle 2.
        assertEq(handler.autoStarts(), 1);
        assertEq(handler.tradeAbsorptions(), 1);
        handler.trigger(3); // Nothing held: the bare trigger moves nothing.
        assertEq(handler.idleTriggers(), 1);
        handler.donate(3, 2e18, false);
        handler.trigger(3);
        assertEq(handler.triggerAbsorptions(), 1);
        assertEq(handler.fundingEvents(), handler.absorptions());
        assertEq(handler.unallocated(), 0);
        assertEq(market.pendingCarry(), 0);
        assertTrue(market.roundState(1).settled);
        assertTrue(market.roundState(2).funded);
        invariant_cashAndWalletsMatchIndependentFlows();
        invariant_questionBackingAndEscrowsMatchTheOracle();
        afterInvariant();
    }

    /// @dev Statistics over the run, then a deterministic teardown start. A run's
    /// own counts are logged, not asserted: a 64-call run need not reach a trade
    /// on a startable cycle. Every absorption the model predicted was matched by
    /// exactly one engine RoundFunded event, field by field, at the call itself.
    function afterInvariant() public {
        emit log_named_uint("absorptions (all funding paths)", handler.absorptions());
        emit log_named_uint("trade absorptions into trading cycles", handler.tradeAbsorptions());
        emit log_named_uint("bare-trigger absorptions", handler.triggerAbsorptions());
        emit log_named_uint("idle bare triggers below threshold", handler.idleTriggers());
        emit log_named_uint("cycles auto-started by a trade", handler.autoStarts());
        assertEq(handler.fundingEvents(), handler.absorptions(), "unmatched RoundFunded events");
        assertLe(
            handler.tradeAbsorptions() + handler.triggerAbsorptions() + handler.autoStarts(), handler.absorptions()
        );
        uint256 starts = handler.autoStarts();
        handler.startFreshCycleWithABuy();
        assertEq(handler.autoStarts(), starts + 1);
        assertEq(handler.fundingEvents(), handler.absorptions());
        handler.finish();
        invariant_cashAndWalletsMatchIndependentFlows();
        invariant_questionBackingAndEscrowsMatchTheOracle();
        invariant_allIssuedUnitsBelongToTheFourActors();
        assertEq(handler.activeCash(), 0);
        assertEq(handler.vaultCash(), 0);
        assertEq(market.settlementVault().totalEscrowed(), 0);
    }

    function test_aSellOfSplitOnlyPairsAutoStartsTheNextCycleFromCarryAndHeldCst() public {
        handler.buy(0, 0, true, 1e18);
        handler.closeAndAdvance(1);
        handler.split(2, 4, 3e18); // Positions in cycle 2; splits never start a cycle.
        handler.donate(1, 5e18, false);
        assertFalse(market.roundState(2).funded);
        handler.sell(2, 4, true, 1e18); // Settles cycle 1, starts cycle 2, then sells.
        assertEq(handler.autoStarts(), 1);
        assertTrue(market.roundState(1).settled && market.roundState(2).funded);
        assertEq(handler.unallocated(), 0);
        assertEq(market.pendingCarry(), 0);
        invariant_cashAndWalletsMatchIndependentFlows();
        invariant_questionBackingAndEscrowsMatchTheOracle();
        afterInvariant();
    }

    function test_oldAndSplitOnlyCyclesDrainAfterLaterCarryFundingAndSourceFailure() public {
        handler.split(0, 0, 5e18);
        handler.buy(1, 1, true, 1e18);
        handler.reveal(1, true);
        handler.buy(3, 1, true, 1e18); // A known answer remains tradable.
        handler.closeAndAdvance(2);
        handler.merge(0, 0, 1, 5e18 - 1); // After actual close, before booking.
        handler.split(2, 4, 3e18); // Cycle2 has positions but no sponsor.
        handler.closeAndAdvance(16);
        handler.fundFromCarry(1); // Cycle3 auto-settles cycle1; cycle2 remains separate.
        handler.offline(0);
        handler.claim(1, 0);
        handler.settle(1);
        handler.offline(1);
        handler.merge(2, 1, 16, 3e18 - 1);
        handler.donate(0, 17, false);
        handler.donate(1, 19, true);
        assertEq(handler.carryOnlyFundings(), 1);
        assertGt(handler.postCloseMerges(), 0);
        assertGt(handler.lateClaims(), 0);
        assertGt(handler.knownAnswerTrades(), 0);
        assertGt(handler.receiver().lockedCallbacks(), 0);
        invariant_cashAndWalletsMatchIndependentFlows();
        invariant_questionBackingAndEscrowsMatchTheOracle();
        invariant_allIssuedUnitsBelongToTheFourActors();
        afterInvariant();
    }
}
