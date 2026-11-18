// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IIndependentCollateral, IndependentOutcomeMarket} from "./IndependentOutcomeMarket.sol";
import {IIndependentOutcomeSource} from "./interfaces/IIndependentOutcomeSource.sol";
import {OutcomeSettlementVault, ISettlementCollateral} from "./OutcomeSettlementVault.sol";
import {GameFundedMarketViews} from "./GameFundedMarketViews.sol";
import {BinaryMarketMath} from "./libraries/BinaryMarketMath.sol";

interface ICosmicFundingGame {
    function token() external view returns (address);
    function chaosZeroFunding(address market, uint256 roundId)
        external
        view
        returns (uint256 amount, uint256 cumulativeAmount);
}

interface IGameBinding {
    function game() external view returns (address);
}

interface IGameOutcomeBinding is IGameBinding {
    function cst() external view returns (address);
}

/// @notice Eight independent binary pools funded exclusively by authenticated V4 game issuance.
/// @dev The game records the grant and transfers the newly issued CST to this address at each cycle boundary.
/// Synchronization consumes that ledger, never a caller's tokens or unsolicited CST. The prior
/// deployed market stays independently reproducible for its holders and deployment manifests.
contract GameFundedOutcomeMarket is ERC1155 {
    uint256 public constant QUESTION_COUNT = 8;
    uint16 public constant INITIAL_YES_BPS = 5000;
    uint256 public constant MAX_COLLATERAL = 1 << 120;
    uint256 public constant MAX_ROUND_COLLATERAL = MAX_COLLATERAL * QUESTION_COUNT;
    uint256 public constant MAX_INITIAL_QUESTION_FUNDING = MAX_COLLATERAL / 2;
    uint256 public constant CYCLE_FUNDING = 8000 ether;
    ICosmicFundingGame public immutable game;
    uint256 public consumedGameFunding;
    uint256 public constant MAX_ROUND_ID = type(uint256).max >> 4;
    IIndependentCollateral public immutable cst;
    IIndependentOutcomeSource public immutable source;
    OutcomeSettlementVault public immutable settlementVault;
    GameFundedMarketViews private immutable _marketViews;
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

    mapping(uint256 => Round) private _rounds;

    error InvalidParameters();
    error InvalidSourceState();
    error NotInitialized();
    error NotFunded();
    error RoundNotOpen();
    error NotFinalized();
    error OutOfOrderRound();
    error InvalidGameFunding();
    error InsufficientPosition();
    error DeadlineExpired();
    error TransferFailed();
    error ReentrantCall();
    /// @dev Bubbled by the immutable verifier; declared for caller ABI decoders.
    error ProductWouldDecrease();

    event RoundInitialized(uint256 indexed roundId);
    /// @param accumulatedFunding Cumulative game issuance consumed by this market, including quiet cycles.
    /// @param carryUsed Accounted prior surplus and unspent quiet-cycle grants placed alongside this cycle's grant.
    event GameFundingSynced(
        uint256 indexed roundId,
        uint256 cycleAmount,
        uint256 accumulatedFunding,
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

    constructor(IIndependentCollateral token_, IIndependentOutcomeSource source_, address game_) ERC1155("") {
        if (address(token_).code.length == 0 || address(source_).code.length == 0) revert InvalidParameters();
        if (
            game_.code.length == 0 || ICosmicFundingGame(game_).token() != address(token_)
                || IGameBinding(address(token_)).game() != game_ || IGameBinding(address(source_)).game() != game_
                || IGameOutcomeBinding(address(source_)).cst() != address(token_)
        ) revert InvalidParameters();
        game = ICosmicFundingGame(game_);
        cst = token_;
        source = source_;
        settlementVault = new OutcomeSettlementVault(ISettlementCollateral(address(token_)));
        _marketViews = new GameFundedMarketViews();
    }

    /// @notice Immutable read helper, exposed for deployment verification.
    function marketViews() external view returns (GameFundedMarketViews) {
        return _marketViews;
    }

    /// @notice Anyone may materialize the game's already-issued grant, at most once per current cycle.
    function syncFunding(uint256 roundId) external nonReentrant {
        _validRound(roundId);
        Round storage r = _rounds[roundId];
        if (!_sync(roundId, r)) revert RoundNotOpen();
        _applyGameFunding(roundId, r);
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
        _applyGameFunding(roundId, r);
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
    function roundState(uint256 roundId) external view returns (IndependentOutcomeMarket.RoundView memory result) {
        _validRound(roundId);
        Round storage r = _rounds[roundId];
        result = IndependentOutcomeMarket.RoundView(
            r.initialized, r.funded, r.settled, r.closed, r.finalized, r.knownMask, r.values, 0
        );
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            result.activeCollateral += r.questions[q].collateral;
        }
    }

    function questionState(uint256 roundId, uint8 question)
        public
        view
        returns (IndependentOutcomeMarket.QuestionView memory result)
    {
        _validQuestion(roundId, question);
        Round storage r = _rounds[roundId];
        Question storage p = r.questions[question];
        result = IndependentOutcomeMarket.QuestionView(
            p.collateral, p.yes, p.no, r.settled ? settlementVault.remaining(roundId, question) : 0, INITIAL_YES_BPS, 0
        );
        if (r.funded && !r.settled) {
            result.currentYesBps = BinaryMarketMath.marginalYesBps(p.collateral, p.yes, p.no, INITIAL_YES_BPS);
        }
    }

    function questionStates(uint256 roundId) external view returns (IndependentOutcomeMarket.QuestionView[8] memory) {
        _forwardView(abi.encodeCall(_marketViews.questionStates, (IndependentOutcomeMarket(address(this)), roundId)));
    }

    function previewClaim(uint256 roundId, address user) external view returns (bool, uint256, uint256[8] memory) {
        _forwardView(
            abi.encodeCall(_marketViews.previewClaim, (IndependentOutcomeMarket(address(this)), roundId, user))
        );
    }

    /// @notice Preview of synchronization, including automatic synchronization on buy, sell and split.
    /// The second argument is retained for read clients and must be zero. No user-supplied amount is accepted.
    function fundingPreview(uint256 roundId, uint256 newAmount)
        external
        view
        returns (IndependentOutcomeMarket.FundingPreview memory result)
    {
        _validRound(roundId);
        if (newAmount != 0) revert InvalidParameters();
        Round storage r = _rounds[roundId];
        (bool open, bool finalized, uint8 known, uint8 values) = source.outcomeState(roundId);
        _checkSource(r, open, finalized, known, values);
        if (!open || r.funded) return result;
        uint256 accrued = _accruedFunding(roundId);
        if (accrued == 0) return result;
        uint256 carry = pendingCarry;
        if (hasFunded && !_rounds[lastFundedRound].settled) {
            (bool ready,, uint256 carried) =
                _marketViews.previewSettlement(IndependentOutcomeMarket(address(this)), lastFundedRound);
            if (!ready) return result;
            result.needsSettlement = true;
            carry += carried;
        }
        result.availableCarry = carry + (accrued - CYCLE_FUNDING);
        (result.totalFunding, result.deferredCarry) = _openingFunding(result.availableCarry);
        result.carryUsed = result.totalFunding - CYCLE_FUNDING;
        result.allocations = _allocate(result.totalFunding);
        result.canFund = true;
    }

    function previewSettlement(uint256 roundId) external view returns (bool, uint256, uint256) {
        _forwardView(abi.encodeCall(_marketViews.previewSettlement, (IndependentOutcomeMarket(address(this)), roundId)));
    }

    function balancesOf(uint256 roundId, address user) external view returns (uint256[8] memory, uint256[8] memory) {
        _forwardView(abi.encodeCall(_marketViews.balancesOf, (IndependentOutcomeMarket(address(this)), roundId, user)));
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
        _applyGameFunding(roundId, r);
        return r.questions[question];
    }

    /// @dev Used on first sync, trade or split. An unused intervening cycle has no positions or
    /// collateral liabilities, so its entire grant becomes available without a catch-up loop.
    function _applyGameFunding(uint256 roundId, Round storage r) private {
        if (r.funded) return;
        uint256 accrued = _accruedFunding(roundId);
        if (accrued == 0) revert NotFunded();
        if (hasFunded && !_rounds[lastFundedRound].settled) _settleRound(lastFundedRound);

        uint256 carry = pendingCarry + (accrued - CYCLE_FUNDING);
        (uint256 placed, uint256 deferred) = _openingFunding(carry);
        uint256[8] memory allocations = _allocate(placed);
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            r.questions[q].collateral = allocations[q];
        }
        consumedGameFunding += accrued;
        pendingCarry = deferred;
        totalActiveCollateral += placed;
        r.funded = true;
        r.initialized = true;
        hasFunded = true;
        lastFundedRound = roundId;
        emit RoundInitialized(roundId);
        emit GameFundingSynced(roundId, CYCLE_FUNDING, consumedGameFunding, placed - CYCLE_FUNDING, allocations);
    }

    function _accruedFunding(uint256 roundId) private view returns (uint256 accrued) {
        if (hasFunded && roundId <= lastFundedRound) revert OutOfOrderRound();
        (uint256 grant, uint256 cumulative) = game.chaosZeroFunding(address(this), roundId);
        if (grant == 0 && cumulative == 0) return 0;
        if (grant != CYCLE_FUNDING || cumulative <= consumedGameFunding) revert InvalidGameFunding();
        accrued = cumulative - consumedGameFunding;
        if (accrued % CYCLE_FUNDING != 0) revert InvalidGameFunding();
        // The ledger proves origin and amount. The token balance only verifies backing.
        if (cst.balanceOf(address(this)) < totalActiveCollateral + pendingCarry + accrued) revert InvalidGameFunding();
    }

    function _openingFunding(uint256 carry) private pure returns (uint256 placed, uint256 deferred) {
        // Splits and trades require funding, so all eight new pools are empty. Reserve headroom
        // for the fresh grant before placing carry; leave exceptional excess for future cycles.
        uint256 capacityForCarry = MAX_INITIAL_QUESTION_FUNDING * QUESTION_COUNT - CYCLE_FUNDING;
        uint256 carryUsed = carry < capacityForCarry ? carry : capacityForCarry;
        return (CYCLE_FUNDING + carryUsed, carry - carryUsed);
    }

    /// @dev The source's open flag controls the trading/splitting/funding cutoff; knownMask
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
