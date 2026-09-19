// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IIndependentOutcomeSource} from "./interfaces/IIndependentOutcomeSource.sol";
import {OutcomeSettlementVault, ISettlementCollateral} from "./OutcomeSettlementVault.sol";
import {BinaryMarketMath} from "./libraries/BinaryMarketMath.sol";
import {PriceHistory} from "./libraries/PriceHistory.sol";

interface IIndependentCollateral {
    function balanceOf(address user) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Eight independently funded binary markets with ordinary ERC1155 claims.
/// @dev A question can spend only its own collateral. Known answers do not stop
/// trading before canonical game closure. Closure reserves winning claims 1:1 in
/// an immutable vault, and recycles all remaining capital into a later funded
/// cycle. Sponsorship creates no LP ownership or withdrawal rights.
contract IndependentOutcomeMarket is ERC1155 {
    using PriceHistory for PriceHistory.Data;

    uint256 public constant QUESTION_COUNT = 8;
    uint256 public constant MAX_COLLATERAL = 1 << 120;
    uint256 public constant MAX_ROUND_COLLATERAL = MAX_COLLATERAL * QUESTION_COUNT;
    uint256 public constant MAX_INITIAL_QUESTION_FUNDING = MAX_COLLATERAL / 2;
    uint256 public constant MIN_FUNDING = 8e12;
    uint256 public constant MAX_ROUND_ID = type(uint256).max >> 4;

    IIndependentCollateral public immutable cst;
    IIndependentOutcomeSource public immutable source;
    OutcomeSettlementVault public immutable settlementVault;
    IndependentMarketViews private immutable _marketViews;
    /// @notice Accounted question collateral, including closed cycles awaiting settlement.
    uint256 public totalActiveCollateral;
    uint256 public pendingCarry;
    uint256 public lastFundedRound;
    bool public hasFunded;
    uint256 private _lock = 1;

    struct Question {
        uint256 collateral;
        uint256 yes;
        uint256 no;
        uint16 initialYesBps;
        bool seedUsedHistory;
        PriceHistory.Data history;
    }

    struct Round {
        bool initialized;
        bool funded;
        bool settled;
        bool closed;
        bool finalized;
        uint8 knownMask;
        uint8 values;
        uint64 startedAt;
        uint64 finalizedAt;
        Question[8] questions;
    }

    struct RoundView {
        bool initialized;
        bool funded;
        bool settled;
        bool closed;
        bool finalized;
        uint8 knownMask;
        uint8 values;
        uint64 startedAt;
        uint64 finalizedAt;
        uint256 activeCollateral;
    }

    struct QuestionView {
        uint256 activeCollateral;
        uint256 yesSupply;
        uint256 noSupply;
        uint256 escrowRemaining;
        uint16 initialYesBps;
        uint16 currentYesBps;
        uint256 checkpointCount;
        bool seedUsedHistory;
    }

    struct FundingPreview {
        uint256 availableCarry;
        uint256 carryUsed;
        uint256 deferredCarry;
        uint256 totalFunding;
        uint256 maxNewAmount;
        uint256[8] allocations;
        bool needsSettlement;
        bool canFund;
    }
    mapping(uint256 => Round) private _rounds;

    error InvalidParameters();
    error InvalidTimestamp();
    error InvalidSourceState();
    error NotInitialized();
    error NotFunded();
    error RoundNotOpen();
    error NotFinalized();
    error OutOfOrderRound();
    error FundingCapacity();
    error InsufficientPosition();
    error DeadlineExpired();
    error TransferFailed();
    error ReentrantCall();
    /// @dev Bubbled by the immutable verifier; declared for caller ABI decoders.
    error ProductWouldDecrease();

    event RoundInitialized(uint256 indexed roundId, uint16[8] initialYesBps, bool[8] usedHistory);
    event RoundFunded(
        uint256 indexed roundId, address indexed sponsor, uint256 donated, uint256 carryUsed, uint256[8] allocations
    );
    event Trade(
        uint256 indexed roundId,
        address indexed user,
        uint8 indexed question,
        bool yes,
        bool buy,
        uint256 cash,
        uint256 units
    );
    event PositionSplit(uint256 indexed roundId, address indexed user, uint8 indexed question, uint256 amount);
    event PositionsMerged(uint256 indexed roundId, address indexed user, uint256[8] amounts, uint256 collateralOut);
    event RoundSettled(uint256 indexed roundId, uint8 values, uint256[8] escrowed, uint256 carried);
    event Claimed(uint256 indexed roundId, address indexed user, uint256[8] amounts, uint256 total);
    event AnswersObserved(uint256 indexed roundId, uint8 knownMask, uint8 values);

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IIndependentCollateral token_, IIndependentOutcomeSource source_) ERC1155("") {
        if (address(token_).code.length == 0 || address(source_).code.length == 0) revert InvalidParameters();
        cst = token_;
        source = source_;
        settlementVault = new OutcomeSettlementVault(ISettlementCollateral(address(token_)));
        _marketViews = new IndependentMarketViews();
    }

    /// @notice Irrevocable eight-way sponsorship. Zero new CST may start a carry-funded cycle.
    /// @dev All automatic carry is considered before first funding. Only the
    /// amount fitting the initial headroom cap is used; excess awaits a later
    /// new cycle. Further voluntary gifts never inject pending carry.
    function fundRound(uint256 roundId, uint256 newAmount) external nonReentrant {
        _validRound(roundId);
        if (newAmount > MAX_ROUND_COLLATERAL) revert InvalidParameters();
        Round storage r = _rounds[roundId];
        if (!_sync(roundId, r)) revert RoundNotOpen();
        if (hasFunded && roundId < lastFundedRound) revert OutOfOrderRound();
        if (!r.funded && hasFunded && roundId != lastFundedRound && !_rounds[lastFundedRound].settled) {
            _settleRound(lastFundedRound);
        }
        _initialize(roundId, r);
        uint256 capacity = _capacity(r, !r.funded);
        uint256 carried;
        if (!r.funded) carried = pendingCarry < capacity ? pendingCarry : capacity;
        if (newAmount > capacity - carried) revert FundingCapacity();
        uint256 total = newAmount + carried;
        if (total == 0 || (!r.funded && total < MIN_FUNDING)) revert InvalidParameters();
        if (!r.funded) {
            pendingCarry -= carried;
            r.funded = true;
            hasFunded = true;
            lastFundedRound = roundId;
        }
        uint256[8] memory allocations = _allocate(total);
        totalActiveCollateral += total;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            if (allocations[q] == 0) continue;
            r.questions[q].collateral += allocations[q];
            _observe(r.questions[q]);
        }
        if (newAmount != 0) _pull(msg.sender, newAmount);
        emit RoundFunded(roundId, msg.sender, newAmount, carried, allocations);
    }

    function buy(uint256 roundId, uint8 question, bool yes, uint256 cstIn, uint256 tokensOut, uint256 deadline)
        external
        nonReentrant
    {
        Question storage p = _prepareTrade(roundId, question, cstIn, tokensOut, deadline);
        uint256 nextC = p.collateral + cstIn;
        uint256 nextY = p.yes + (yes ? tokensOut : 0);
        uint256 nextN = p.no + (yes ? 0 : tokensOut);
        _marketViews.verifyProduct(p.collateral, p.yes, p.no, nextC, nextY, nextN, p.initialYesBps);
        p.collateral = nextC;
        p.yes = nextY;
        p.no = nextN;
        totalActiveCollateral += cstIn;
        _observe(p);
        _pull(msg.sender, cstIn);
        _mint(msg.sender, _id(roundId, question, yes), tokensOut, "");
        emit Trade(roundId, msg.sender, question, yes, true, cstIn, tokensOut);
    }

    function sell(uint256 roundId, uint8 question, bool yes, uint256 tokensIn, uint256 cstOut, uint256 deadline)
        external
        nonReentrant
    {
        Question storage p = _prepareTrade(roundId, question, cstOut, tokensIn, deadline);
        uint256 id = _id(roundId, question, yes);
        if (tokensIn > balanceOf(msg.sender, id)) revert InsufficientPosition();
        if (cstOut >= p.collateral) revert InvalidParameters();
        uint256 nextC = p.collateral - cstOut;
        uint256 nextY = p.yes - (yes ? tokensIn : 0);
        uint256 nextN = p.no - (yes ? 0 : tokensIn);
        _marketViews.verifyProduct(p.collateral, p.yes, p.no, nextC, nextY, nextN, p.initialYesBps);
        p.collateral = nextC;
        p.yes = nextY;
        p.no = nextN;
        _observe(p);
        _burn(msg.sender, id, tokensIn);
        totalActiveCollateral -= cstOut;
        _push(msg.sender, cstOut);
        emit Trade(roundId, msg.sender, question, yes, false, cstOut, tokensIn);
    }

    function splitPosition(uint256 roundId, uint8 question, uint256 amount) external nonReentrant {
        _validQuestion(roundId, question);
        if (amount == 0 || amount > MAX_COLLATERAL) revert InvalidParameters();
        Round storage r = _rounds[roundId];
        if (!_sync(roundId, r)) revert RoundNotOpen();
        _initialize(roundId, r);
        Question storage p = r.questions[question];
        if (p.collateral + amount > MAX_COLLATERAL) revert InvalidParameters();
        p.collateral += amount;
        p.yes += amount;
        p.no += amount;
        totalActiveCollateral += amount;
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = _id(roundId, question, true);
        ids[1] = _id(roundId, question, false);
        amounts[0] = amount;
        amounts[1] = amount;
        _pull(msg.sender, amount);
        _mintBatch(msg.sender, ids, amounts, "");
        emit PositionSplit(roundId, msg.sender, question, amount);
    }

    function mergePosition(uint256 roundId, uint8 question, uint256 amount)
        external
        nonReentrant
        returns (uint256 collateralOut)
    {
        _validQuestion(roundId, question);
        if (amount == 0) revert InvalidParameters();
        uint256[8] memory amounts;
        amounts[question] = amount;
        return _merge(roundId, amounts);
    }

    function mergePositions(uint256 roundId, uint256[8] calldata amounts)
        external
        nonReentrant
        returns (uint256 collateralOut)
    {
        _validRound(roundId);
        return _merge(roundId, amounts);
    }

    /// @notice Seal a canonically closed cycle without waiting for any holder.
    /// @return escrowed New winning-claim collateral reserved in the vault.
    /// @return carried New unallocated capital available to a later funded cycle.
    function settleRound(uint256 roundId) external nonReentrant returns (uint256 escrowed, uint256 carried) {
        _validRound(roundId);
        return _settleRound(roundId);
    }

    /// @notice Redeem at 1 CST per winning unit, only after full game closure.
    /// @dev Once settled, neither redemption nor token transfers depend on the source.
    function claimKnown(uint256 roundId) external nonReentrant returns (uint256 total) {
        _validRound(roundId);
        Round storage r = _rounds[roundId];
        if (!r.initialized) revert NotInitialized();
        if (!r.settled) _settleRound(roundId);
        uint256[] memory ids = new uint256[](16);
        uint256[] memory burns = new uint256[](16);
        uint256[8] memory payments;
        uint256 count;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            uint256 yId = _id(roundId, q, true);
            uint256 nId = _id(roundId, q, false);
            uint256 y = balanceOf(msg.sender, yId);
            uint256 n = balanceOf(msg.sender, nId);
            r.questions[q].yes -= y;
            r.questions[q].no -= n;
            payments[q] = (r.values & (uint8(1) << q)) != 0 ? y : n;
            total += payments[q];
            if (y != 0) {
                ids[count] = yId;
                burns[count++] = y;
            }
            if (n != 0) {
                ids[count] = nId;
                burns[count++] = n;
            }
        }
        if (count != 0) {
            assembly ("memory-safe") {
                mstore(ids, count)
                mstore(burns, count)
            }
            _burnBatch(msg.sender, ids, burns);
        }
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            if (payments[q] != 0) settlementVault.pay(roundId, q, msg.sender, payments[q]);
        }
        emit Claimed(roundId, msg.sender, payments, total);
    }

    /// @notice Cached lifecycle; timestamps are canonical snapshots once settled.
    function roundState(uint256 roundId) external view returns (RoundView memory result) {
        _validRound(roundId);
        Round storage r = _rounds[roundId];
        result = RoundView(
            r.initialized,
            r.funded,
            r.settled,
            r.closed,
            r.finalized,
            r.knownMask,
            r.values,
            r.startedAt,
            r.finalizedAt,
            0
        );
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            result.activeCollateral += r.questions[q].collateral;
        }
    }

    function questionState(uint256 roundId, uint8 question) public view returns (QuestionView memory result) {
        _validQuestion(roundId, question);
        Round storage r = _rounds[roundId];
        Question storage p = r.questions[question];
        result = QuestionView(
            p.collateral,
            p.yes,
            p.no,
            r.settled ? settlementVault.remaining(roundId, question) : 0,
            p.initialYesBps,
            0,
            p.history.checkpoints.length,
            p.seedUsedHistory
        );
        if (r.funded && !r.settled) {
            result.currentYesBps = BinaryMarketMath.marginalYesBps(p.collateral, p.yes, p.no, p.initialYesBps);
        }
    }

    function questionStates(uint256 roundId) external view returns (QuestionView[8] memory result) {
        _validRound(roundId);
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            result[q] = questionState(roundId, q);
        }
    }

    function previewClaim(uint256 roundId, address user) external view returns (bool, uint256, uint256[8] memory) {
        _forwardView(abi.encodeCall(_marketViews.previewClaim, (this, roundId, user)));
    }

    function fundingPreview(uint256 roundId, uint256 newAmount) external view returns (FundingPreview memory) {
        _forwardView(abi.encodeCall(_marketViews.fundingPreview, (this, roundId, newAmount)));
    }

    function previewSettlement(uint256 roundId) external view returns (bool, uint256, uint256) {
        _forwardView(abi.encodeCall(_marketViews.previewSettlement, (this, roundId)));
    }

    function seedPreview(uint256 roundId) external view returns (uint16[8] memory prices, bool[8] memory usedHistory) {
        _validRound(roundId);
        return _seeds(roundId);
    }

    function initialPrices(uint256 roundId) external view returns (uint16[8] memory prices) {
        _validRound(roundId);
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            prices[q] = _rounds[roundId].questions[q].initialYesBps;
        }
    }

    function historyLength(uint256 roundId, uint8 question) external view returns (uint256) {
        _validQuestion(roundId, question);
        return _rounds[roundId].questions[question].history.checkpoints.length;
    }

    function historyCheckpoint(uint256 roundId, uint8 question, uint256 index)
        external
        view
        returns (uint128 cumulative, uint64 timestamp, uint16 price)
    {
        _validQuestion(roundId, question);
        PriceHistory.Checkpoint storage p = _rounds[roundId].questions[question].history.checkpoints[index];
        return (p.cumulative, p.timestamp, p.price);
    }

    function balancesOf(uint256 roundId, address user)
        external
        view
        returns (uint256[8] memory yes, uint256[8] memory no)
    {
        _validRound(roundId);
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            yes[q] = balanceOf(user, _id(roundId, q, true));
            no[q] = balanceOf(user, _id(roundId, q, false));
        }
    }

    function positionId(uint256 roundId, uint8 question, bool yes) public pure returns (uint256) {
        _validQuestion(roundId, question);
        return _id(roundId, question, yes);
    }

    /// @dev Callers already checked the round; question comes from a checked input or 0..7 loop.
    function _id(uint256 roundId, uint8 question, bool yes) private pure returns (uint256) {
        return (roundId << 4) | (uint256(question) << 1) | (yes ? 1 : 0);
    }

    function decodePositionId(uint256 id) public pure returns (uint256 roundId, uint8 question, bool yes) {
        // The mask bounds the question to 0..7 before conversion.
        // forge-lint: disable-next-line(unsafe-typecast)
        return (id >> 4, uint8((id >> 1) & 7), (id & 1) != 0);
    }

    function totalSupply(uint256 id) public view returns (uint256) {
        (uint256 round, uint8 q, bool yes) = decodePositionId(id);
        return yes ? _rounds[round].questions[q].yes : _rounds[round].questions[q].no;
    }

    function uri(uint256 id) public view override returns (string memory) {
        return _marketViews.uri(id, address(source));
    }

    function _merge(uint256 roundId, uint256[8] memory amounts) private returns (uint256 total) {
        Round storage r = _rounds[roundId];
        if (!r.initialized) revert NotInitialized();
        uint256 count;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            uint256 amount = amounts[q];
            if (amount == 0) continue;
            if (
                amount > balanceOf(msg.sender, _id(roundId, q, true))
                    || amount > balanceOf(msg.sender, _id(roundId, q, false))
            ) revert InsufficientPosition();
            total += amount;
            count += 2;
        }
        if (total == 0) revert InvalidParameters();
        uint256[] memory ids = new uint256[](count);
        uint256[] memory burns = new uint256[](count);
        uint256 index;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            uint256 amount = amounts[q];
            if (amount == 0) continue;
            Question storage p = r.questions[q];
            p.yes -= amount;
            p.no -= amount;
            if (!r.settled) p.collateral -= amount;
            ids[index] = _id(roundId, q, true);
            burns[index++] = amount;
            ids[index] = _id(roundId, q, false);
            burns[index++] = amount;
        }
        _burnBatch(msg.sender, ids, burns);
        if (!r.settled) {
            totalActiveCollateral -= total;
            _push(msg.sender, total);
        } else {
            for (uint8 q; q < QUESTION_COUNT; ++q) {
                if (amounts[q] != 0) settlementVault.pay(roundId, q, msg.sender, amounts[q]);
            }
        }
        emit PositionsMerged(roundId, msg.sender, amounts, total);
    }

    function _settleRound(uint256 roundId) private returns (uint256 escrowed, uint256 carried) {
        Round storage r = _rounds[roundId];
        if (!r.initialized) revert NotInitialized();
        if (r.settled) return (0, 0);
        _sync(roundId, r);
        if (!r.finalized) revert NotFinalized();
        (uint64 start, uint64 end) = _finalTimes(roundId, r);
        uint256[8] memory owed;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            Question storage p = r.questions[q];
            owed[q] = (r.values & (uint8(1) << q)) != 0 ? p.yes : p.no;
            carried += p.collateral - owed[q];
            escrowed += owed[q];
            p.collateral = 0;
        }
        r.startedAt = start;
        r.finalizedAt = end;
        r.settled = true;
        totalActiveCollateral -= escrowed + carried;
        pendingCarry += carried;
        if (escrowed != 0) _push(address(settlementVault), escrowed);
        settlementVault.register(roundId, owed);
        emit RoundSettled(roundId, r.values, owed, carried);
    }

    function _prepareTrade(uint256 roundId, uint8 question, uint256 cash, uint256 units, uint256 deadline)
        private
        returns (Question storage p)
    {
        _validQuestion(roundId, question);
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (cash == 0 || units == 0 || cash > MAX_COLLATERAL || units > MAX_COLLATERAL) revert InvalidParameters();
        Round storage r = _rounds[roundId];
        if (!r.funded) revert NotFunded();
        if (!_sync(roundId, r)) revert RoundNotOpen();
        return r.questions[question];
    }

    function _initialize(uint256 roundId, Round storage r) private {
        if (r.initialized) return;
        _now64();
        (uint16[8] memory prices, bool[8] memory used) = _seeds(roundId);
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            r.questions[q].initialYesBps = prices[q];
            r.questions[q].seedUsedHistory = used[q];
        }
        r.initialized = true;
        emit RoundInitialized(roundId, prices, used);
    }

    function _seeds(uint256 roundId) private view returns (uint16[8] memory prices, bool[8] memory used) {
        Round storage current = _rounds[roundId];
        if (current.initialized) {
            for (uint8 q; q < QUESTION_COUNT; ++q) {
                prices[q] = current.questions[q].initialYesBps;
                used[q] = current.questions[q].seedUsedHistory;
            }
            return (prices, used);
        }
        if (roundId == 0 || !_rounds[roundId - 1].initialized) {
            for (uint8 q; q < QUESTION_COUNT; ++q) {
                prices[q] = 5000;
            }
            return (prices, used);
        }
        Round storage previous = _rounds[roundId - 1];
        uint64 start;
        uint64 end;
        if (previous.settled) {
            start = previous.startedAt;
            end = previous.finalizedAt;
        } else {
            (bool open, bool finalized, uint8 known, uint8 values) = source.outcomeState(roundId - 1);
            _checkSource(previous, open, finalized, known, values);
            if (!finalized) revert NotFinalized();
            (start, end) = _finalTimes(roundId - 1, previous);
        }
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            Question storage p = previous.questions[q];
            (uint16 price, bool historyUsed) = p.history.average(start, end, p.initialYesBps);
            prices[q] = price == 0 ? 1 : (price >= 10_000 ? 9999 : price);
            used[q] = historyUsed;
        }
    }

    function _sync(uint256 roundId, Round storage r) private returns (bool open) {
        bool finalized;
        uint8 known;
        uint8 values;
        (open, finalized, known, values) = source.outcomeState(roundId);
        _checkSource(r, open, finalized, known, values);
        if (!open && r.initialized) r.closed = true;
        if (finalized) r.finalized = true;
        if (known != r.knownMask) {
            r.knownMask = known;
            r.values = values;
            emit AnswersObserved(roundId, known, values);
        }
    }

    function _checkSource(Round storage r, bool open, bool finalized, uint8 known, uint8 values) private view {
        if (
            (values & ~known) != 0 || (known & r.knownMask) != r.knownMask || ((values ^ r.values) & r.knownMask) != 0
                || (r.closed && open) || (r.finalized && !finalized)
                || (finalized && (open || known != type(uint8).max))
        ) revert InvalidSourceState();
    }

    function _finalTimes(uint256 roundId, Round storage r) private view returns (uint64 start, uint64 end) {
        uint64 now_ = _now64();
        (uint256 first, uint256 last) = source.cycleTimes(roundId);
        if (first > last || last > now_) revert InvalidTimestamp();
        // last<=now_<=uint64.max also bounds first.
        // forge-lint: disable-next-line(unsafe-typecast)
        start = uint64(first);
        // forge-lint: disable-next-line(unsafe-typecast)
        end = uint64(last);
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            PriceHistory.Data storage history = r.questions[q].history;
            uint256 length = history.checkpoints.length;
            if (length != 0 && history.checkpoints[length - 1].timestamp > end) revert InvalidTimestamp();
        }
    }

    function _capacity(Round storage r, bool initial) private view returns (uint256 result) {
        uint256 minimum = type(uint256).max;
        uint256 firstMinimum;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            uint256 headroom = MAX_COLLATERAL - r.questions[q].collateral;
            if (initial && headroom > MAX_INITIAL_QUESTION_FUNDING) headroom = MAX_INITIAL_QUESTION_FUNDING;
            if (headroom < minimum) {
                minimum = headroom;
                firstMinimum = q;
            }
        }
        return minimum * QUESTION_COUNT + firstMinimum;
    }

    function _allocate(uint256 total) private pure returns (uint256[8] memory amounts) {
        uint256 base = total / QUESTION_COUNT;
        uint256 remainder = total % QUESTION_COUNT;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            amounts[q] = base + (q < remainder ? 1 : 0);
        }
    }

    function _observe(Question storage p) private {
        p.history.observe(_now64(), BinaryMarketMath.marginalYesBps(p.collateral, p.yes, p.no, p.initialYesBps));
    }

    function _now64() private view returns (uint64) {
        if (block.timestamp > type(uint64).max) revert InvalidTimestamp();
        // Explicit range check above prevents truncation.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp);
    }

    /// @dev These external preview wrappers and the immutable helper declare
    /// identical output types. Forward its ABI result directly instead of copying
    /// and re-encoding large structs. STATICCALL forbids helper state changes.
    function _forwardView(bytes memory payload) private view {
        address helper = address(_marketViews);
        assembly ("memory-safe") {
            let ok := staticcall(gas(), helper, add(payload, 32), mload(payload), 0, 0)
            let pointer := mload(0x40)
            returndatacopy(pointer, 0, returndatasize())
            if iszero(ok) { revert(pointer, returndatasize()) }
            return(pointer, returndatasize())
        }
    }

    function _validRound(uint256 roundId) private pure {
        if (roundId > MAX_ROUND_ID) revert InvalidParameters();
    }

    function _validQuestion(uint256 roundId, uint8 question) private pure {
        _validRound(roundId);
        if (question >= QUESTION_COUNT) revert InvalidParameters();
    }

    function _pull(address from, uint256 amount) private {
        uint256 beforeHere = cst.balanceOf(address(this));
        uint256 beforeFrom = cst.balanceOf(from);
        if (
            !cst.transferFrom(from, address(this), amount) || cst.balanceOf(address(this)) - beforeHere != amount
                || beforeFrom - cst.balanceOf(from) != amount
        ) revert TransferFailed();
    }

    function _push(address to, uint256 amount) private {
        uint256 beforeHere = cst.balanceOf(address(this));
        uint256 beforeTo = cst.balanceOf(to);
        if (
            !cst.transfer(to, amount) || beforeHere - cst.balanceOf(address(this)) != amount
                || cst.balanceOf(to) - beforeTo != amount
        ) revert TransferFailed();
    }
}

/// @dev Immutable helper for pure product verification, metadata and read-only previews.
contract IndependentMarketViews {
    /// @dev Pure invariant proof is shared by buy/sell without inflating engine bytecode.
    function verifyProduct(
        uint256 beforeC,
        uint256 beforeY,
        uint256 beforeN,
        uint256 afterC,
        uint256 afterY,
        uint256 afterN,
        uint16 initialYesBps
    ) external pure {
        BinaryMarketMath.verifyProduct(beforeC, beforeY, beforeN, afterC, afterY, afterN, initialYesBps);
    }

    function previewSettlement(IndependentOutcomeMarket market, uint256 roundId)
        external
        view
        returns (bool ready, uint256 escrowed, uint256 carried)
    {
        return _settlement(market, roundId);
    }

    function previewClaim(IndependentOutcomeMarket market, uint256 roundId, address user)
        external
        view
        returns (bool claimable, uint256 total, uint256[8] memory amounts)
    {
        IndependentOutcomeMarket.RoundView memory r = market.roundState(roundId);
        if (!r.initialized) return (false, 0, amounts);
        uint8 values = r.values;
        if (!r.settled) {
            (, bool finalized,, uint8 observed) = _source(market, roundId, r);
            if (!finalized) return (false, 0, amounts);
            _times(market, roundId);
            values = observed;
        }
        (uint256[8] memory y, uint256[8] memory n) = market.balancesOf(roundId, user);
        for (uint8 q; q < 8; ++q) {
            amounts[q] = (values & (uint8(1) << q)) != 0 ? y[q] : n[q];
            total += amounts[q];
        }
        return (true, total, amounts);
    }

    function _settlement(IndependentOutcomeMarket market, uint256 roundId)
        private
        view
        returns (bool ready, uint256 escrowed, uint256 carried)
    {
        IndependentOutcomeMarket.RoundView memory r = market.roundState(roundId);
        if (!r.initialized) return (false, 0, 0);
        if (r.settled) return (true, 0, 0);
        (, bool finalized,, uint8 values) = _source(market, roundId, r);
        if (!finalized) return (false, 0, 0);
        _times(market, roundId);
        for (uint8 q; q < 8; ++q) {
            IndependentOutcomeMarket.QuestionView memory p = market.questionState(roundId, q);
            uint256 owed = (values & (uint8(1) << q)) != 0 ? p.yesSupply : p.noSupply;
            escrowed += owed;
            carried += p.activeCollateral - owed;
        }
        return (true, escrowed, carried);
    }

    function _source(IndependentOutcomeMarket market, uint256 roundId, IndependentOutcomeMarket.RoundView memory r)
        private
        view
        returns (bool open, bool finalized, uint8 known, uint8 values)
    {
        (open, finalized, known, values) = market.source().outcomeState(roundId);
        if (
            (values & ~known) != 0 || (known & r.knownMask) != r.knownMask || ((values ^ r.values) & r.knownMask) != 0
                || (r.closed && open) || (r.finalized && !finalized)
                || (finalized && (open || known != type(uint8).max))
        ) revert IndependentOutcomeMarket.InvalidSourceState();
    }

    function _times(IndependentOutcomeMarket market, uint256 roundId) private view {
        (uint256 first, uint256 last) = market.source().cycleTimes(roundId);
        if (first > last || last > block.timestamp || block.timestamp > type(uint64).max) {
            revert IndependentOutcomeMarket.InvalidTimestamp();
        }
        for (uint8 q; q < 8; ++q) {
            uint256 length = market.historyLength(roundId, q);
            if (length != 0) {
                (, uint64 timestamp,) = market.historyCheckpoint(roundId, q, length - 1);
                if (timestamp > last) revert IndependentOutcomeMarket.InvalidTimestamp();
            }
        }
    }

    /// @dev Read-only lens; no funds, permissions or configurable addresses.
    function fundingPreview(IndependentOutcomeMarket market, uint256 roundId, uint256 newAmount)
        external
        view
        returns (IndependentOutcomeMarket.FundingPreview memory result)
    {
        IndependentOutcomeMarket.RoundView memory r = market.roundState(roundId);
        IIndependentOutcomeSource oracle = market.source();
        (bool open, bool finalized, uint8 known, uint8 values) = oracle.outcomeState(roundId);
        if (
            (values & ~known) != 0 || (known & r.knownMask) != r.knownMask || ((values ^ r.values) & r.knownMask) != 0
                || (r.closed && open) || (r.finalized && !finalized)
                || (finalized && (open || known != type(uint8).max))
        ) revert IndependentOutcomeMarket.InvalidSourceState();
        bool hasFunded = market.hasFunded();
        uint256 lastFunded = market.lastFundedRound();
        result.availableCarry = market.pendingCarry();
        bool ready = open && !finalized && !r.settled && (!hasFunded || roundId >= lastFunded);
        if (!r.funded && hasFunded && lastFunded < roundId && !market.roundState(lastFunded).settled) {
            result.needsSettlement = true;
            (bool canSettle,, uint256 carry) = _settlement(market, lastFunded);
            ready = ready && canSettle;
            result.availableCarry += carry;
        }
        if (ready) {
            if (block.timestamp > type(uint64).max) revert IndependentOutcomeMarket.InvalidTimestamp();
            if (!r.initialized) market.seedPreview(roundId);
        }
        uint256 maxC = market.MAX_COLLATERAL();
        uint256 initialCap = market.MAX_INITIAL_QUESTION_FUNDING();
        uint256 minimum = type(uint256).max;
        uint256 firstMinimum;
        for (uint8 q; q < 8; ++q) {
            uint256 room = maxC - market.questionState(roundId, q).activeCollateral;
            if (!r.funded && room > initialCap) room = initialCap;
            if (room < minimum) {
                minimum = room;
                firstMinimum = q;
            }
        }
        uint256 capacity = minimum * 8 + firstMinimum;
        if (!r.funded) result.carryUsed = result.availableCarry < capacity ? result.availableCarry : capacity;
        result.deferredCarry = result.availableCarry - result.carryUsed;
        result.maxNewAmount = capacity - result.carryUsed;
        if (newAmount > result.maxNewAmount) return result;
        result.totalFunding = result.carryUsed + newAmount;
        for (uint8 q; q < 8; ++q) {
            result.allocations[q] = result.totalFunding / 8 + (q < result.totalFunding % 8 ? 1 : 0);
        }
        result.canFund = ready && result.totalFunding != 0 && (r.funded || result.totalFunding >= market.MIN_FUNDING());
    }

    function uri(uint256 id, address outcomeSource) external pure returns (string memory) {
        uint256 round = id >> 4;
        uint256 q = (id >> 1) & 7;
        bool yes = (id & 1) != 0;
        bytes memory json = abi.encodePacked(
            '{"name":"Chaos Zero cycle ',
            Strings.toString(round),
            " question ",
            Strings.toString(uint256(q) + 1),
            yes ? " YES" : " NO",
            '","description":"Independent binary CST position. Winning units and matched same-question pairs redeem 1:1.",',
            '"decimals":18,"properties":{"round":"',
            Strings.toString(round),
            '","question":',
            Strings.toString(q),
            ',"side":"',
            yes ? "YES" : "NO",
            '","outcomeSource":"',
            Strings.toHexString(outcomeSource),
            '"}}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }
}
