// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IIndependentOutcomeSource} from "./interfaces/IIndependentOutcomeSource.sol";
import {OutcomeSettlementVault, ISettlementCollateral} from "./OutcomeSettlementVault.sol";
import {BinaryMarketMath} from "./libraries/BinaryMarketMath.sol";

/// @dev Smallest held contribution that an implicit trigger (a buy, a sell or a bare
/// `fundRound(cycle, 0)`) absorbs into an already-funded cycle. Smaller amounts wait
/// for a later absorption, an explicit gift (which sweeps everything held) or the
/// next cycle's first funding (which needs only MIN_FUNDING), so dust transfers
/// cannot force eight pool writes onto traders at negligible cost.
uint256 constant MIN_AUTO_TOP_UP = 1e18;

interface IIndependentCollateral {
    function balanceOf(address user) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Eight independently funded binary markets with ordinary ERC1155 claims.
/// @dev A question can spend only its own collateral. Markets never end early: buy,
/// sell, splitPosition, fundRound and held-CST absorption stay available for as long
/// as the source reports the cycle open, i.e. until the game's round-ending
/// transaction, even when all eight answers are already known or the countdown has
/// elapsed. Settlement and claims wait for finalized. Closure reserves winning claims 1:1 in
/// an immutable vault, and recycles all remaining capital into a later funded
/// cycle. Sponsorship creates no LP ownership or withdrawal rights.
contract IndependentOutcomeMarket is ERC1155 {
    uint256 public constant QUESTION_COUNT = 8;
    uint16 public constant INITIAL_YES_BPS = 5000;
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
    }

    struct Round {
        bool initialized;
        bool funded;
        bool settled;
        bool closed;
        bool finalized;
        uint8 knownMask;
        uint8 values;
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
        uint256 activeCollateral;
    }

    struct QuestionView {
        uint256 activeCollateral;
        uint256 yesSupply;
        uint256 noSupply;
        uint256 escrowRemaining;
        uint16 initialYesBps;
        uint16 currentYesBps;
    }

    /// @dev Preview of `fundRound(roundId, newAmount)`. With `newAmount == 0` it is
    /// exactly what the next buy or sell (or a bare trigger) absorbs before pricing:
    /// `canFund` means that call places CST now, and `allocations` are the per-pool
    /// additions (`totalFunding` in all, computed as if the call ran). `carryUsed`
    /// is the carry placed (first funding only; `availableCarry` includes a previous
    /// cycle that must settle first), `maxNewAmount` the capacity left after carry
    /// and `deferredCarry` the pendingCarry after the call. A larger `newAmount`
    /// reverts FundingCapacity, so only `availableCarry`, `carryUsed`, `maxNewAmount`,
    /// `needsSettlement` and `unallocated` are then set. `unallocated` is the held
    /// unsolicited CST now: `cst.balanceOf(market) - totalActiveCollateral -
    /// pendingCarry`, saturating at zero.
    struct FundingPreview {
        uint256 availableCarry;
        uint256 carryUsed;
        uint256 deferredCarry;
        uint256 totalFunding;
        uint256 maxNewAmount;
        uint256[8] allocations;
        bool needsSettlement;
        bool canFund;
        uint256 unallocated;
    }
    mapping(uint256 => Round) private _rounds;

    error InvalidParameters();
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

    event RoundInitialized(uint256 indexed roundId);
    /// @dev `caller` triggered the absorption (a sponsor, a trader or anyone) and
    /// is never evidence of having given `transfersUsed`. `donated` is the caller's
    /// own pulled CST (zero for trades and bare triggers), `transfersUsed` the held
    /// unsolicited CST placed and `carryUsed` the pending carry placed (first
    /// funding only). Their sum equals the sum of `allocations`; whatever carry or
    /// unsolicited CST did not fit stays in pendingCarry.
    event RoundFunded(
        uint256 indexed roundId,
        address indexed caller,
        uint256 donated,
        uint256 transfersUsed,
        uint256 carryUsed,
        uint256[8] allocations
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

    /// @notice Immutable read helper, exposed for deployment verification.
    function marketViews() external view returns (IndependentMarketViews) {
        return _marketViews;
    }

    /// @notice Irrevocable eight-way sponsorship of `newAmount` CST, which also sweeps
    /// every held contribution into the pools. With zero it is the permissionless
    /// trigger that starts a cycle from carry or distributes held CST without trading.
    /// @dev Pulls first (balance-delta verified); `_absorb`, the only route into pools,
    /// then places carry (first funding only), `newAmount`, then held CST. Reverts
    /// FundingCapacity if `newAmount` exceeds the capacity left after carry, and
    /// InvalidParameters if nothing is placed: a first funding needs MIN_FUNDING and
    /// a bare trigger on a funded cycle needs MIN_AUTO_TOP_UP held.
    function fundRound(uint256 roundId, uint256 newAmount) external nonReentrant {
        _validRound(roundId);
        if (newAmount > MAX_ROUND_COLLATERAL) revert InvalidParameters();
        Round storage r = _rounds[roundId];
        if (!_sync(roundId, r)) revert RoundNotOpen();
        if (newAmount != 0) _pull(msg.sender, newAmount);
        if (_absorb(roundId, r, newAmount) == 0) revert InvalidParameters();
    }

    function buy(uint256 roundId, uint8 question, bool yes, uint256 cstIn, uint256 tokensOut, uint256 deadline)
        external
        nonReentrant
    {
        Question storage p = _prepareTrade(roundId, question, cstIn, tokensOut, deadline);
        uint256 nextC = p.collateral + cstIn;
        uint256 nextY = p.yes + (yes ? tokensOut : 0);
        uint256 nextN = p.no + (yes ? 0 : tokensOut);
        _marketViews.verifyProduct(p.collateral, p.yes, p.no, nextC, nextY, nextN, INITIAL_YES_BPS);
        p.collateral = nextC;
        p.yes = nextY;
        p.no = nextN;
        totalActiveCollateral += cstIn;
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
        _marketViews.verifyProduct(p.collateral, p.yes, p.no, nextC, nextY, nextN, INITIAL_YES_BPS);
        p.collateral = nextC;
        p.yes = nextY;
        p.no = nextN;
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

    /// @notice Cached lifecycle and the sum of all eight active question budgets.
    function roundState(uint256 roundId) external view returns (RoundView memory result) {
        _validRound(roundId);
        Round storage r = _rounds[roundId];
        result = RoundView(r.initialized, r.funded, r.settled, r.closed, r.finalized, r.knownMask, r.values, 0);
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            result.activeCollateral += r.questions[q].collateral;
        }
    }

    function questionState(uint256 roundId, uint8 question) public view returns (QuestionView memory result) {
        _validQuestion(roundId, question);
        Round storage r = _rounds[roundId];
        Question storage p = r.questions[question];
        result = QuestionView(
            p.collateral, p.yes, p.no, r.settled ? settlementVault.remaining(roundId, question) : 0, INITIAL_YES_BPS, 0
        );
        if (r.funded && !r.settled) {
            result.currentYesBps = BinaryMarketMath.marginalYesBps(p.collateral, p.yes, p.no, INITIAL_YES_BPS);
        }
    }

    function questionStates(uint256 roundId) external view returns (QuestionView[8] memory) {
        _forwardView(abi.encodeCall(_marketViews.questionStates, (this, roundId)));
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

    function balancesOf(uint256 roundId, address user) external view returns (uint256[8] memory, uint256[8] memory) {
        _forwardView(abi.encodeCall(_marketViews.balancesOf, (this, roundId, user)));
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

    /// @dev Forwards the helper's raw returndata and ends in an assembly `return`,
    /// so it must never be called internally (OpenZeppelin's ERC1155 does not).
    function uri(uint256 id) public view override returns (string memory) {
        _forwardView(abi.encodeCall(_marketViews.uri, (id, address(source))));
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
        uint256[8] memory owed;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            Question storage p = r.questions[q];
            owed[q] = (r.values & (uint8(1) << q)) != 0 ? p.yes : p.no;
            carried += p.collateral - owed[q];
            escrowed += owed[q];
            p.collateral = 0;
        }
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
        if (!_sync(roundId, r)) revert RoundNotOpen();
        // Held contributions enter before pricing; an unstarted cycle starts here.
        _absorb(roundId, r, 0);
        if (!r.funded) revert NotFunded();
        return r.questions[question];
    }

    /// @dev The single path from "CST arrived" to "CST is in a pool or pendingCarry".
    /// `roundId` is open (the caller synced it). All held, unaccounted CST (direct
    /// transfers, mints, or a sponsor's just-verified pull) always joins; pending
    /// carry joins only at first funding, after the previous funded cycle settles.
    /// Placement priority is carry, then the caller's own just-pulled `donated`, then
    /// unsolicited CST. `donated` that does not fit reverts FundingCapacity; only
    /// carry and unsolicited CST over capacity wait in pendingCarry, so an implicit
    /// absorption (`donated == 0`) never reverts for capacity. Nothing moves below
    /// MIN_FUNDING at first funding, or on a funded cycle below MIN_AUTO_TOP_UP
    /// (implicit) or 1 wei (explicit, so a gift sweeps all held CST with it).
    function _absorb(uint256 roundId, Round storage r, uint256 donated) private returns (uint256 placed) {
        bool initial = !r.funded;
        if (initial && hasFunded) {
            if (roundId < lastFundedRound) revert OutOfOrderRound();
            if (!_rounds[lastFundedRound].settled) _settleRound(lastFundedRound);
        }
        uint256 carry = pendingCarry;
        uint256 accounted = totalActiveCollateral + carry;
        uint256 held = cst.balanceOf(address(this));
        // Saturates if CST was destroyed externally (unsupported): later inflows
        // first restore the missing backing, and a deficit never blocks trading.
        uint256 fresh = held > accounted ? held - accounted : 0;
        // Settling above moved collateral to carry and escrow but left `fresh` unchanged.
        uint256 offered = initial ? carry : 0;
        uint256 minimum = initial ? MIN_FUNDING : (donated != 0 ? 1 : MIN_AUTO_TOP_UP);
        // Gas shortcut for implicit triggers; an explicit gift checks capacity first.
        if (donated == 0 && fresh + offered < minimum) return 0;
        uint256 capacity = _capacity(r, initial);
        uint256 carryUsed = offered < capacity ? offered : capacity;
        if (donated > capacity - carryUsed) revert FundingCapacity();
        placed = fresh + offered < capacity ? fresh + offered : capacity;
        if (placed < minimum) return 0;
        if (initial) {
            _initialize(roundId, r);
            r.funded = true;
            hasFunded = true;
            lastFundedRound = roundId;
        }
        pendingCarry = carry + fresh - placed;
        totalActiveCollateral += placed;
        uint256[8] memory allocations = _allocate(placed);
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            if (allocations[q] == 0) continue;
            r.questions[q].collateral += allocations[q];
        }
        // `fresh >= donated` unless unsupported destruction left a deficit, which the
        // pull restored first; `donated + transfersUsed + carryUsed == placed`.
        if (donated > fresh) donated = fresh;
        emit RoundFunded(roundId, msg.sender, donated, placed - carryUsed - donated, carryUsed, allocations);
    }

    /// @dev Every cycle starts at 50/50, independently of previous prices and outcomes.
    function _initialize(uint256 roundId, Round storage r) private {
        if (r.initialized) return;
        r.initialized = true;
        emit RoundInitialized(roundId);
    }

    /// @dev The source's open flag is the only trading/splitting/funding cutoff; knownMask
    /// never closes a cycle. finalized is the only settlement/claim gate.
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

    /// @dev Forwarded batch getters: identical ABI output, no market bytecode.
    function questionStates(IndependentOutcomeMarket market, uint256 roundId)
        external
        view
        returns (IndependentOutcomeMarket.QuestionView[8] memory result)
    {
        for (uint8 q; q < 8; ++q) {
            result[q] = market.questionState(roundId, q);
        }
    }

    function balancesOf(IndependentOutcomeMarket market, uint256 roundId, address user)
        public
        view
        returns (uint256[8] memory yes, uint256[8] memory no)
    {
        for (uint8 q; q < 8; ++q) {
            yes[q] = market.balanceOf(user, market.positionId(roundId, q, true));
            no[q] = market.balanceOf(user, market.positionId(roundId, q, false));
        }
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
            values = observed;
        }
        (uint256[8] memory y, uint256[8] memory n) = balancesOf(market, roundId, user);
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
        uint256 accounted = market.totalActiveCollateral() + market.pendingCarry();
        uint256 balance = market.cst().balanceOf(address(market));
        result.unallocated = balance > accounted ? balance - accounted : 0;
        uint256 offered = r.funded ? 0 : result.availableCarry;
        result.carryUsed = offered < capacity ? offered : capacity;
        result.maxNewAmount = capacity - result.carryUsed;
        // fundRound reverts FundingCapacity: the caller's own CST ranks after carry only.
        if (newAmount > result.maxNewAmount) return result;
        _absorption(result, balance + newAmount, accounted, offered, capacity);
        result.canFund =
            ready && result.totalFunding >= (r.funded ? (newAmount != 0 ? 1 : MIN_AUTO_TOP_UP) : market.MIN_FUNDING());
    }

    /// @dev Mirrors `_absorb`. fundRound pulls first, so `balance` already holds the
    /// caller's CST. Carry (first funding only) ranks first; held CST fills the
    /// capped remainder, and whatever does not fit stays pending.
    function _absorption(
        IndependentOutcomeMarket.FundingPreview memory result,
        uint256 balance,
        uint256 accounted,
        uint256 offered,
        uint256 capacity
    ) private pure {
        uint256 fresh = balance > accounted ? balance - accounted : 0;
        uint256 available = fresh + offered;
        result.totalFunding = available < capacity ? available : capacity;
        result.deferredCarry = result.availableCarry + fresh - result.totalFunding;
        for (uint8 q; q < 8; ++q) {
            result.allocations[q] = result.totalFunding / 8 + (q < result.totalFunding % 8 ? 1 : 0);
        }
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
