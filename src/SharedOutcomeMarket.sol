// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IOutcomeSource} from "./interfaces/IOutcomeSource.sol";
import {Log2Bounds} from "./libraries/Log2Bounds.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

interface ISharedCollateral {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

/// @notice A sponsor-funded joint fixed-product market over eight binary answers.
/// @dev There are no owner permissions, minting permissions, LP shares or fees.
/// For each feasible ending s, the virtual pool reserve is collateral minus
/// outstanding winning binary claims in s. Sponsorship supplies equal initial
/// reserves to all 256 endings. Exact-amount trades are accepted only when every
/// feasible reserve stays positive and rigorous log bounds prove that their
/// product cannot decrease. A wallet may solve quotes off-chain; it is never a
/// trusted price oracle. Outcomes come exclusively from the immutable source.
contract SharedOutcomeMarket is ERC1155 {
    uint256 public constant QUESTION_COUNT = 8;
    uint256 public constant MAX_COLLATERAL = 1 << 120;
    uint256 public constant MIN_FUNDING = 1e12;
    uint256 public constant MAX_ROUND_ID = type(uint256).max >> 4;

    ISharedCollateral public immutable cst;
    IOutcomeSource public immutable source;
    uint256 private _lock = 1;

    struct Round {
        uint256 collateral;
        bool initialized;
        bool funded;
        uint8 knownMask;
        uint8 values;
        bool closed;
        bool finalized;
        uint256[8] yes;
        uint256[8] no;
    }
    mapping(uint256 => Round) private _rounds;

    event RoundFunded(uint256 indexed roundId, address indexed sponsor, uint256 amount);
    event AnswersSynced(uint256 indexed roundId, uint8 knownMask, uint8 values);
    event Trade(
        uint256 indexed roundId,
        address indexed user,
        uint8 indexed question,
        bool yes,
        bool buy,
        uint256 cash,
        uint256 units
    );
    event Claimed(uint256 indexed roundId, address indexed user, uint8 knownMask, uint256 amount);
    event ResidualRolled(uint256 indexed fromRound, uint256 indexed toRound, uint256 amount);
    event PositionSplit(uint256 indexed roundId, address indexed user, uint8 indexed question, uint256 amount);
    event PositionsMerged(uint256 indexed roundId, address indexed user, uint256[8] amounts, uint256 collateralOut);

    error InvalidParameters();
    error RoundNotOpen();
    error NotFunded();
    error NotInitialized();
    error AnswerKnown();
    error InvalidSourceState();
    error NotFinalized();
    error DeadlineExpired();
    error InsufficientPosition();
    error Insolvent();
    error ProductWouldDecrease();
    error TransferFailed();
    error ReentrantCall();

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(ISharedCollateral token_, IOutcomeSource source_) ERC1155("") {
        if (address(token_).code.length == 0 || address(source_).code.length == 0) revert InvalidParameters();
        cst = token_;
        source = source_;
    }

    /// @notice Irrevocably sponsor a cycle, initially or with an additional gift.
    /// @dev Additive gifts increase every virtual reserve equally and can change
    /// prices toward even odds. Exact proposed trade amounts remain invariant-checked.
    function fundRound(uint256 roundId, uint256 amount) external nonReentrant {
        _validateRound(roundId);
        if (amount == 0 || amount > MAX_COLLATERAL) revert InvalidParameters();
        Round storage r = _rounds[roundId];
        if (!r.funded && amount < MIN_FUNDING) revert InvalidParameters();
        (bool open,) = _sync(roundId, r);
        if (!open || r.knownMask == type(uint8).max) revert RoundNotOpen();
        if (r.collateral + amount > MAX_COLLATERAL) revert InvalidParameters();
        r.funded = true;
        r.initialized = true;
        r.collateral += amount;
        _pull(msg.sender, amount);
        emit RoundFunded(roundId, msg.sender, amount);
    }

    function buy(uint256 roundId, uint8 question, bool yes, uint256 cstIn, uint256 tokensOut, uint256 deadline)
        external
        nonReentrant
    {
        Round storage r = _prepare(roundId, question, cstIn, tokensOut, deadline);
        uint256 nextCash = r.collateral + cstIn;
        if (nextCash > MAX_COLLATERAL || tokensOut > MAX_COLLATERAL) revert InvalidParameters();
        uint256[8] memory nextYes = r.yes;
        uint256[8] memory nextNo = r.no;
        if (yes) nextYes[question] += tokensOut;
        else nextNo[question] += tokensOut;
        _verify(r, nextCash, nextYes, nextNo);
        r.collateral = nextCash;
        if (yes) {
            r.yes[question] = nextYes[question];
        } else {
            r.no[question] = nextNo[question];
        }
        _pull(msg.sender, cstIn);
        // All collateral and aggregate accounting is complete before a recipient
        // callback. ERC1155 forwarding is allowed; economic re-entry is guarded.
        _mint(msg.sender, positionId(roundId, question, yes), tokensOut, "");
        emit Trade(roundId, msg.sender, question, yes, true, cstIn, tokensOut);
    }

    function sell(uint256 roundId, uint8 question, bool yes, uint256 tokensIn, uint256 cstOut, uint256 deadline)
        external
        nonReentrant
    {
        Round storage r = _prepare(roundId, question, cstOut, tokensIn, deadline);
        uint256 id = positionId(roundId, question, yes);
        if (tokensIn > balanceOf(msg.sender, id)) revert InsufficientPosition();
        if (cstOut >= r.collateral) revert Insolvent();
        uint256 nextCash = r.collateral - cstOut;
        uint256[8] memory nextYes = r.yes;
        uint256[8] memory nextNo = r.no;
        if (yes) nextYes[question] -= tokensIn;
        else nextNo[question] -= tokensIn;
        _verify(r, nextCash, nextYes, nextNo);
        r.collateral = nextCash;
        if (yes) {
            r.yes[question] = nextYes[question];
        } else {
            r.no[question] = nextNo[question];
        }
        _burn(msg.sender, id, tokensIn);
        _push(msg.sender, cstOut);
        emit Trade(roundId, msg.sender, question, yes, false, cstOut, tokensIn);
    }

    /// @notice Retrieve all currently known winning positions. Other claims remain.
    function claimKnown(uint256 roundId) external nonReentrant returns (uint256 amount) {
        _validateRound(roundId);
        Round storage r = _rounds[roundId];
        if (!r.initialized) revert NotInitialized();
        // Finalized answers are permanently bound to this cycle. Later source
        // outages must not prevent a current ERC1155 holder from redeeming them.
        if (!r.finalized) _sync(roundId, r);
        uint256[] memory ids = new uint256[](16);
        uint256[] memory amounts = new uint256[](16);
        uint256 count;
        for (uint8 i; i < QUESTION_COUNT; ++i) {
            uint8 bit = uint8(1) << i;
            if ((r.knownMask & bit) == 0) continue;
            uint256 yesId = positionId(roundId, i, true);
            uint256 noId = positionId(roundId, i, false);
            uint256 yesBalance = balanceOf(msg.sender, yesId);
            uint256 noBalance = balanceOf(msg.sender, noId);
            amount += (r.values & bit) != 0 ? yesBalance : noBalance;
            r.yes[i] -= yesBalance;
            r.no[i] -= noBalance;
            if (yesBalance != 0) {
                ids[count] = yesId;
                amounts[count++] = yesBalance;
            }
            if (noBalance != 0) {
                ids[count] = noId;
                amounts[count++] = noBalance;
            }
        }
        r.collateral -= amount;
        if (count != 0) {
            // Both arrays have capacity16 and count is at most two entries per
            // question. Truncate only their lengths, retaining their allocations.
            assembly ("memory-safe") {
                mstore(ids, count)
                mstore(amounts, count)
            }
            _burnBatch(msg.sender, ids, amounts);
        }
        if (amount != 0) _push(msg.sender, amount);
        emit Claimed(roundId, msg.sender, r.knownMask, amount);
    }

    /// @notice Recycle only finalized sponsor residue; every unpaid winner stays backed.
    function rollover(uint256 fromRound, uint256 toRound) external nonReentrant returns (uint256 amount) {
        _validateRound(fromRound);
        _validateRound(toRound);
        if (toRound <= fromRound) revert InvalidParameters();
        Round storage from = _rounds[fromRound];
        if (!from.funded) revert NotFunded();
        (, bool finalized) = _sync(fromRound, from);
        if (!finalized) revert NotFinalized();
        uint256 owed = _liability(from.yes, from.no, from.values);
        amount = from.collateral - owed;
        if (amount == 0) revert InvalidParameters();
        Round storage to = _rounds[toRound];
        (bool open,) = _sync(toRound, to);
        if (!open || to.knownMask == type(uint8).max) revert RoundNotOpen();
        if (!to.funded && amount < MIN_FUNDING) revert InvalidParameters();
        if (to.collateral + amount > MAX_COLLATERAL) revert InvalidParameters();
        from.collateral = owed;
        to.collateral += amount;
        to.funded = true;
        to.initialized = true;
        emit RoundFunded(toRound, address(this), amount);
        emit ResidualRolled(fromRound, toRound, amount);
    }

    function roundAccounting(uint256 roundId)
        external
        view
        returns (uint256 collateral, bool funded, uint8 knownMask, uint8 values)
    {
        _validateRound(roundId);
        Round storage r = _rounds[roundId];
        return (r.collateral, r.funded, r.knownMask, r.values);
    }

    function liabilities(uint256 roundId) external view returns (uint256[8] memory yes, uint256[8] memory no) {
        _validateRound(roundId);
        Round storage r = _rounds[roundId];
        return (r.yes, r.no);
    }

    function balancesOf(uint256 roundId, address user)
        external
        view
        returns (uint256[8] memory yes, uint256[8] memory no)
    {
        _validateRound(roundId);
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            yes[q] = balanceOf(user, positionId(roundId, q, true));
            no[q] = balanceOf(user, positionId(roundId, q, false));
        }
    }

    /// @notice Deposit CST for an equal YES/NO pair on one unresolved question.
    /// @dev This neither sponsors the AMM nor changes any virtual reserve.
    function splitPosition(uint256 roundId, uint8 question, uint256 amount) external nonReentrant {
        _validateRound(roundId);
        if (question >= QUESTION_COUNT || amount == 0 || amount > MAX_COLLATERAL) revert InvalidParameters();
        Round storage r = _rounds[roundId];
        (bool open,) = _sync(roundId, r);
        if (!open) revert RoundNotOpen();
        if ((r.knownMask & (uint8(1) << question)) != 0) revert AnswerKnown();
        if (r.collateral + amount > MAX_COLLATERAL) revert InvalidParameters();
        r.initialized = true;
        r.collateral += amount;
        r.yes[question] += amount;
        r.no[question] += amount;
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = positionId(roundId, question, true);
        ids[1] = positionId(roundId, question, false);
        amounts[0] = amount;
        amounts[1] = amount;
        _pull(msg.sender, amount);
        _mintBatch(msg.sender, ids, amounts, "");
        emit PositionSplit(roundId, msg.sender, question, amount);
    }

    /// @notice Burn a matched pair for exactly its CST backing, in any phase.
    /// @dev This exit deliberately does not call the outcome source.
    function mergePosition(uint256 roundId, uint8 question, uint256 amount)
        external
        nonReentrant
        returns (uint256 collateralOut)
    {
        if (question >= QUESTION_COUNT || amount == 0) revert InvalidParameters();
        uint256[8] memory amounts;
        amounts[question] = amount;
        return _mergePositions(roundId, amounts);
    }

    /// @notice Merge independent same-question pairs; outputs sum exactly once.
    function mergePositions(uint256 roundId, uint256[8] calldata amounts)
        external
        nonReentrant
        returns (uint256 collateralOut)
    {
        return _mergePositions(roundId, amounts);
    }

    function _mergePositions(uint256 roundId, uint256[8] memory amounts) private returns (uint256 collateralOut) {
        _validateRound(roundId);
        Round storage r = _rounds[roundId];
        if (!r.initialized) revert NotInitialized();
        uint256 count;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            uint256 amount = amounts[q];
            if (amount == 0) continue;
            if (
                amount > balanceOf(msg.sender, positionId(roundId, q, true))
                    || amount > balanceOf(msg.sender, positionId(roundId, q, false))
            ) revert InsufficientPosition();
            collateralOut += amount;
            count += 2;
        }
        if (collateralOut == 0) revert InvalidParameters();
        uint256[] memory ids = new uint256[](count);
        uint256[] memory burnAmounts = new uint256[](count);
        uint256 index;
        for (uint8 q; q < QUESTION_COUNT; ++q) {
            uint256 amount = amounts[q];
            if (amount == 0) continue;
            r.yes[q] -= amount;
            r.no[q] -= amount;
            ids[index] = positionId(roundId, q, true);
            burnAmounts[index++] = amount;
            ids[index] = positionId(roundId, q, false);
            burnAmounts[index++] = amount;
        }
        r.collateral -= collateralOut;
        _burnBatch(msg.sender, ids, burnAmounts);
        _push(msg.sender, collateralOut);
        emit PositionsMerged(roundId, msg.sender, amounts, collateralOut);
    }

    function isInitialized(uint256 roundId) external view returns (bool) {
        _validateRound(roundId);
        return _rounds[roundId].initialized;
    }

    function positionId(uint256 roundId, uint8 question, bool yes) public pure returns (uint256) {
        _validateRound(roundId);
        if (question >= QUESTION_COUNT) revert InvalidParameters();
        return (roundId << 4) | (uint256(question) << 1) | (yes ? 1 : 0);
    }

    function decodePositionId(uint256 id) public pure returns (uint256 roundId, uint8 question, bool yes) {
        // The bit mask bounds the question to0..7 before conversion.
        // forge-lint: disable-next-line(unsafe-typecast)
        return (id >> 4, uint8((id >> 1) & 7), (id & 1) != 0);
    }

    /// @notice Supply of the issued binary position, excluding virtual AMM reserves.
    function totalSupply(uint256 id) public view returns (uint256) {
        (uint256 roundId, uint8 question, bool yes) = decodePositionId(id);
        return yes ? _rounds[roundId].yes[question] : _rounds[roundId].no[question];
    }

    function uri(uint256 id) public view override returns (string memory) {
        (uint256 roundId, uint8 question, bool yes) = decodePositionId(id);
        string memory side = yes ? "YES" : "NO";
        string memory json = string.concat(
            '{"name":"Chaos Zero cycle ',
            Strings.toString(roundId),
            " question ",
            Strings.toString(uint256(question) + 1),
            " ",
            side,
            '","description":"A binary CST position. A matched YES/NO pair for the same question redeems for one CST per unit.",',
            '"decimals":18,"properties":{"round":"',
            Strings.toString(roundId),
            '","question":',
            Strings.toString(question),
            ',"side":"',
            side,
            '","outcomeSource":"',
            Strings.toHexString(address(source)),
            '","collateralToken":"',
            Strings.toHexString(address(cst)),
            '"}}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _validateRound(uint256 roundId) private pure {
        if (roundId > MAX_ROUND_ID) revert InvalidParameters();
    }

    function _prepare(uint256 roundId, uint8 question, uint256 cash, uint256 units, uint256 deadline)
        private
        returns (Round storage r)
    {
        _validateRound(roundId);
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (question >= QUESTION_COUNT || cash == 0 || units == 0 || cash > MAX_COLLATERAL || units > MAX_COLLATERAL) {
            revert InvalidParameters();
        }
        r = _rounds[roundId];
        if (!r.funded) revert NotFunded();
        (bool open,) = _sync(roundId, r);
        if (!open) revert RoundNotOpen();
        if ((r.knownMask & uint8(1 << question)) != 0) revert AnswerKnown();
    }

    function _sync(uint256 roundId, Round storage r) private returns (bool open, bool finalized) {
        uint8 known;
        uint8 values;
        (open, finalized, known, values) = source.outcomeState(roundId);
        if (
            (values & ~known) != 0 || (known & r.knownMask) != r.knownMask || ((values ^ r.values) & r.knownMask) != 0
                || (r.closed && open) || (r.finalized && !finalized)
                || (finalized && (open || known != type(uint8).max))
        ) revert InvalidSourceState();
        if (!open && r.initialized) r.closed = true;
        if (finalized) r.finalized = true;
        if (known != r.knownMask) {
            r.knownMask = known;
            r.values = values;
            emit AnswersSynced(roundId, known, values);
        }
    }

    function _liability(uint256[8] memory yes, uint256[8] memory no, uint8 ending)
        private
        pure
        returns (uint256 result)
    {
        for (uint256 i; i < QUESTION_COUNT; ++i) {
            result += (ending & (1 << i)) != 0 ? yes[i] : no[i];
        }
    }

    function _verify(Round storage r, uint256 nextCash, uint256[8] memory nextYes, uint256[8] memory nextNo)
        private
        view
    {
        uint256[8] memory oldYes = r.yes;
        uint256[8] memory oldNo = r.no;
        uint256 oldUpper;
        uint256 newLower;
        // The loop counter is intentionally wider than uint8: 256 is its exit.
        for (uint256 s; s < 256; ++s) {
            if ((uint8(s) & r.knownMask) != r.values) continue;
            uint256 newDebt = _liability(nextYes, nextNo, uint8(s));
            if (newDebt >= nextCash) revert Insolvent();
            uint256 oldDebt = _liability(oldYes, oldNo, uint8(s));
            uint256 oldReserve = r.collateral - oldDebt;
            uint256 newReserve = nextCash - newDebt;
            if (oldReserve == newReserve) continue;
            (, uint256 upper) = Log2Bounds.bounds(oldReserve);
            (uint256 lower,) = Log2Bounds.bounds(newReserve);
            oldUpper += upper;
            newLower += lower;
        }
        if (newLower < oldUpper) revert ProductWouldDecrease();
    }

    function _pull(address sender, uint256 amount) private {
        uint256 beforeBalance = cst.balanceOf(address(this));
        if (!cst.transferFrom(sender, address(this), amount) || cst.balanceOf(address(this)) - beforeBalance != amount) revert TransferFailed();
    }

    function _push(address recipient, uint256 amount) private {
        uint256 beforeRecipient = cst.balanceOf(recipient);
        uint256 beforePool = cst.balanceOf(address(this));
        if (
            !cst.transfer(recipient, amount) || cst.balanceOf(recipient) - beforeRecipient != amount
                || beforePool - cst.balanceOf(address(this)) != amount
        ) revert TransferFailed();
    }
}
