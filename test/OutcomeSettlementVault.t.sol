// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {Vm} from "forge-std/Vm.sol";
import {OutcomeSettlementVault, ISettlementCollateral} from "../src/OutcomeSettlementVault.sol";
import {MockCst} from "./utils/Mocks.sol";

contract SettlementTestToken is MockCst {
    uint8 public failureMode;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes4 public callbackError;
    uint256 public callbackCount;
    error TokenRefused();

    function setFailure(uint8 mode) external {
        failureMode = mode;
    }

    function setCallback(address target, bytes memory data) external {
        callbackTarget = target;
        callbackData = data;
        callbackSucceeded = false;
        callbackError = bytes4(0);
        callbackCount = 0;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failureMode == 1) return false;
        if (failureMode == 2) revert TokenRefused();
        if (failureMode == 6) super.transfer(to, amount - 1);
        else super.transfer(to, amount);
        if (failureMode == 3) --balanceOf[to];
        if (failureMode == 4) --balanceOf[msg.sender];
        if (failureMode == 5) ++balanceOf[to];
        if (callbackTarget != address(0)) {
            ++callbackCount;
            bytes memory data;
            (callbackSucceeded, data) = callbackTarget.call(callbackData);
            if (data.length >= 4) {
                // Extract only the four-byte error selector from revert data.
                // forge-lint: disable-next-line(unsafe-typecast)
                callbackError = bytes4(data);
            }
        }
        return true;
    }
}

/// @dev Models the future engine's exact funding transfer and shared economic
/// reentrancy lock. Deliberately contains no beneficiary-allocation policy.
contract SettlementEngineProbe {
    SettlementTestToken public immutable token;
    OutcomeSettlementVault public immutable vault;
    uint256 private lock = 1;
    error EngineReentrant();
    error DepositFailed();

    modifier guarded() {
        if (lock != 1) revert EngineReentrant();
        lock = 2;
        _;
        lock = 1;
    }

    constructor(SettlementTestToken token_) {
        token = token_;
        vault = new OutcomeSettlementVault(ISettlementCollateral(address(token_)));
    }

    function depositAndRegister(uint256 round, uint256[8] calldata amounts) external guarded {
        uint256 total;
        for (uint256 q; q < 8; ++q) {
            total += amounts[q];
        }
        uint256 beforeEngine = token.balanceOf(address(this));
        uint256 beforeVault = token.balanceOf(address(vault));
        if (
            total != 0
                && (!token.transfer(address(vault), total)
                    || beforeEngine - token.balanceOf(address(this)) != total
                    || token.balanceOf(address(vault)) - beforeVault != total)
        ) revert DepositFailed();
        vault.register(round, amounts);
    }

    function pay(uint256 round, uint8 question, address recipient, uint256 amount) external guarded {
        vault.pay(round, question, recipient, amount);
    }
}

contract OutcomeSettlementVaultTest is Test {
    SettlementTestToken private token;
    OutcomeSettlementVault private vault;
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    address private constant CAROL = address(0xca901);
    uint256 private constant MAX_AMOUNT = 1e24;

    function setUp() public {
        token = new SettlementTestToken();
        vault = new OutcomeSettlementVault(ISettlementCollateral(address(token)));
        token.mint(address(this), 1e30);
    }

    function _deposit(uint256 round, uint256[8] memory amounts) private returns (uint256 total) {
        for (uint256 q; q < 8; ++q) {
            total += amounts[q];
        }
        if (total != 0) assertTrue(token.transfer(address(vault), total));
        vault.register(round, amounts);
    }

    function _single(uint8 q, uint256 amount) private pure returns (uint256[8] memory result) {
        result[q] = amount;
    }

    function test_constructorAndOnlyDeployingMarketAuthorization() public {
        assertEq(vault.market(), address(this));
        assertEq(address(vault.cst()), address(token));
        vm.expectRevert(OutcomeSettlementVault.InvalidDeposit.selector);
        new OutcomeSettlementVault(ISettlementCollateral(address(0)));
        vm.expectRevert(OutcomeSettlementVault.InvalidDeposit.selector);
        new OutcomeSettlementVault(ISettlementCollateral(ALICE));
        uint256[8] memory amounts = _single(0, 10e18);
        vm.prank(ALICE);
        vm.expectRevert(OutcomeSettlementVault.Unauthorized.selector);
        vault.register(1, amounts);
        _deposit(1, amounts);
        vm.prank(ALICE);
        vm.expectRevert(OutcomeSettlementVault.Unauthorized.selector);
        vault.pay(1, 0, ALICE, 1e18);
        assertEq(vault.remaining(1, 0), 10e18);
    }

    function test_eachQuestionAndCycleIsolatedEvenWithSurplusCustody() public {
        _deposit(1, _single(0, 2e18));
        _deposit(2, _single(0, 100e18));
        token.transfer(address(vault), 50e18);
        vm.expectRevert(OutcomeSettlementVault.InvalidPayout.selector);
        vault.pay(1, 0, ALICE, 2e18 + 1);
        vm.expectRevert(OutcomeSettlementVault.InvalidPayout.selector);
        vault.pay(1, 1, ALICE, 1);
        vm.expectRevert(OutcomeSettlementVault.InvalidPayout.selector);
        vault.pay(3, 0, ALICE, 1);
        vault.pay(1, 0, ALICE, 2e18);
        assertEq(vault.remaining(2, 0), 100e18);
        assertEq(vault.totalEscrowed(), 100e18);
        assertEq(token.balanceOf(address(vault)), 150e18);
    }

    function test_registerOnlyOnceIncludingZeroAndFullyPaidCycles() public {
        uint256[8] memory zero;
        vault.register(0, zero);
        vm.expectRevert(OutcomeSettlementVault.InvalidDeposit.selector);
        vault.register(0, zero);
        _deposit(type(uint256).max, _single(7, 1));
        vault.pay(type(uint256).max, 7, ALICE, 1);
        vm.expectRevert(OutcomeSettlementVault.InvalidDeposit.selector);
        vault.register(type(uint256).max, zero);
        assertTrue(vault.registered(type(uint256).max));
        assertEq(vault.totalEscrowed(), 0);
    }

    function test_unbackedRegistrationRestoresEveryPartiallyWrittenSlot() public {
        _deposit(1, _single(3, 10e18));
        token.transfer(address(vault), 5e18);
        uint256[8] memory amounts;
        for (uint256 q; q < 8; ++q) {
            amounts[q] = 1e18;
        }
        vm.expectRevert(OutcomeSettlementVault.InvalidDeposit.selector);
        vault.register(2, amounts);
        assertFalse(vault.registered(2));
        for (uint8 q; q < 8; ++q) {
            assertEq(vault.remaining(2, q), 0);
        }
        assertEq(vault.totalEscrowed(), 10e18);
        assertEq(vault.remaining(1, 3), 10e18);
        assertEq(token.balanceOf(address(vault)), 15e18);
    }

    function test_atomicMarketDepositRollsBackOnDuplicateRegistration() public {
        SettlementEngineProbe engine = new SettlementEngineProbe(token);
        OutcomeSettlementVault escrow = engine.vault();
        token.mint(address(engine), 100e18);
        uint256[8] memory amounts = _single(4, 10e18);
        engine.depositAndRegister(9, amounts);
        uint256 beforeEngine = token.balanceOf(address(engine));
        uint256 beforeVault = token.balanceOf(address(escrow));
        vm.expectRevert(OutcomeSettlementVault.InvalidDeposit.selector);
        engine.depositAndRegister(9, amounts);
        assertEq(token.balanceOf(address(engine)), beforeEngine);
        assertEq(token.balanceOf(address(escrow)), beforeVault);
        assertEq(escrow.totalEscrowed(), 10e18);
    }

    function test_invalidPayoutParametersAreAtomic() public {
        _deposit(1, _single(1, 10e18));
        vm.expectRevert(OutcomeSettlementVault.InvalidPayout.selector);
        vault.pay(1, 1, address(0), 1);
        vm.expectRevert(OutcomeSettlementVault.InvalidPayout.selector);
        vault.pay(1, 1, ALICE, 0);
        vm.expectRevert(OutcomeSettlementVault.InvalidPayout.selector);
        vault.pay(1, 8, ALICE, 1);
        vm.expectRevert(OutcomeSettlementVault.InvalidPayout.selector);
        vault.pay(1, 255, ALICE, 1);
        vm.expectRevert(OutcomeSettlementVault.TransferFailed.selector);
        vault.pay(1, 1, address(vault), 1);
        assertEq(vault.totalEscrowed(), 10e18);
        assertEq(vault.remaining(1, 1), 10e18);
        assertEq(token.balanceOf(address(vault)), 10e18);
    }

    function test_unsolicitedTokensCreateNoClaimsAndCannotBePaidAsRegisteredFunds() public {
        token.transfer(address(vault), 7e18);
        assertEq(vault.totalEscrowed(), 0);
        assertFalse(vault.registered(12));
        vm.expectRevert(OutcomeSettlementVault.InvalidPayout.selector);
        vault.pay(12, 0, ALICE, 1);
        _deposit(12, _single(0, 3e18));
        vault.pay(12, 0, ALICE, 3e18);
        assertEq(vault.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(vault)), 7e18);
        vm.expectRevert(OutcomeSettlementVault.InvalidPayout.selector);
        vault.pay(12, 0, ALICE, 1);
    }

    function test_authorizedMarketCanExplicitlyAllocateOtherwiseUnassignedCollateral() public {
        // Registration authorizes a liability; the vault enforces coverage, not
        // provenance. The engine must verify its own exact funding transfer.
        token.transfer(address(vault), 7e18);
        vault.register(12, _single(0, 7e18));
        vault.pay(12, 0, ALICE, 7e18);
        assertEq(vault.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_tokenCallbacksCannotRegisterOrPayAsMarket() public {
        _deposit(1, _single(0, 10e18));
        token.setCallback(address(vault), abi.encodeCall(vault.pay, (1, 0, BOB, 1e18)));
        vault.pay(1, 0, ALICE, 1e18);
        assertFalse(token.callbackSucceeded());
        assertEq(token.callbackError(), OutcomeSettlementVault.Unauthorized.selector);
        assertEq(token.callbackCount(), 1);
        assertEq(token.balanceOf(BOB), 0);
        token.setCallback(address(vault), abi.encodeCall(vault.register, (2, _single(0, 1))));
        vault.pay(1, 0, ALICE, 1e18);
        assertEq(token.callbackError(), OutcomeSettlementVault.Unauthorized.selector);
        assertFalse(vault.registered(2));
        assertEq(vault.remaining(1, 0), 8e18);
        assertEq(token.balanceOf(ALICE), 2e18);
    }

    function test_guardedMarketBlocksAuthorizedCallbackRelayDuringDepositAndPay() public {
        SettlementEngineProbe engine = new SettlementEngineProbe(token);
        OutcomeSettlementVault escrow = engine.vault();
        token.mint(address(engine), 20e18);
        uint256[8] memory amounts = _single(0, 10e18);
        token.setCallback(address(engine), abi.encodeCall(engine.depositAndRegister, (2, amounts)));
        engine.depositAndRegister(1, amounts);
        assertEq(token.callbackError(), SettlementEngineProbe.EngineReentrant.selector);
        assertFalse(escrow.registered(2));
        token.setCallback(address(engine), abi.encodeCall(engine.pay, (1, 0, BOB, 1e18)));
        engine.pay(1, 0, ALICE, 2e18);
        assertEq(token.callbackError(), SettlementEngineProbe.EngineReentrant.selector);
        assertEq(token.balanceOf(BOB), 0);
        assertEq(escrow.totalEscrowed(), 8e18);
        assertEq(token.balanceOf(address(escrow)), 8e18);
    }

    function test_maximumIntegerEscrowPaysExactlyAndOverflowRegistrationRollsBack() public {
        token.mint(address(vault), type(uint256).max);
        vault.register(type(uint256).max, _single(7, type(uint256).max - 1));
        vm.expectRevert(stdError.arithmeticError);
        vault.register(1, _single(0, 2));
        assertFalse(vault.registered(1));
        assertEq(vault.remaining(1, 0), 0);
        vault.pay(type(uint256).max, 7, ALICE, type(uint256).max - 1);
        assertEq(token.balanceOf(ALICE), type(uint256).max - 1);
        assertEq(token.balanceOf(address(vault)), 1);
        assertEq(vault.totalEscrowed(), 0);
    }

    function test_questionSumOverflowRestoresPartiallyWrittenRegistration() public {
        uint256[8] memory amounts;
        amounts[0] = type(uint256).max;
        amounts[1] = 1;
        vm.expectRevert(stdError.arithmeticError);
        vault.register(17, amounts);
        assertFalse(vault.registered(17));
        assertEq(vault.totalEscrowed(), 0);
        for (uint8 q; q < 8; ++q) {
            assertEq(vault.remaining(17, q), 0);
        }
    }

    function test_escrowAndPaymentEventsMatchActualAmounts() public {
        uint256[8] memory amounts = _single(6, 13e18);
        vm.recordLogs();
        _deposit(41, amounts);
        vault.pay(41, 6, ALICE, 5e18);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2);
        assertEq(logs[0].topics[0], keccak256("CycleEscrowed(uint256,uint256[8])"));
        assertEq(logs[0].topics[1], bytes32(uint256(41)));
        uint256[8] memory logged = abi.decode(logs[0].data, (uint256[8]));
        for (uint256 q; q < 8; ++q) {
            assertEq(logged[q], amounts[q]);
        }
        assertEq(logs[1].topics[0], keccak256("Paid(uint256,uint8,address,uint256)"));
        assertEq(logs[1].topics[1], bytes32(uint256(41)));
        assertEq(logs[1].topics[2], bytes32(uint256(6)));
        assertEq(logs[1].topics[3], bytes32(uint256(uint160(ALICE))));
        assertEq(abi.decode(logs[1].data, (uint256)), 5e18);
        assertEq(token.balanceOf(ALICE), 5e18);
        assertEq(vault.remaining(41, 6), 8e18);
    }

    function testFuzz_failedOrNonExactPayoutNeverDestroysClaims(uint8 rawMode, uint256 rawAmount, uint8 rawQ) public {
        uint8 mode = 1 + rawMode % 6;
        uint8 q = rawQ % 8;
        uint256 amount = bound(rawAmount, 2, MAX_AMOUNT);
        _deposit(1, _single(q, amount + 10));
        token.setFailure(mode);
        if (mode == 2) vm.expectRevert(SettlementTestToken.TokenRefused.selector);
        else vm.expectRevert(OutcomeSettlementVault.TransferFailed.selector);
        vault.pay(1, q, ALICE, amount);
        assertEq(vault.remaining(1, q), amount + 10);
        assertEq(vault.totalEscrowed(), amount + 10);
        assertEq(token.balanceOf(address(vault)), amount + 10);
        assertEq(token.balanceOf(ALICE), 0);
        token.setFailure(0);
        vault.pay(1, q, ALICE, amount + 10);
        assertEq(vault.totalEscrowed(), 0);
    }

    function testFuzz_atomicExactDepositRejectsTaxesEvenWhenOldSurplusCouldMaskThem(uint8 rawMode, uint256 rawAmount)
        public
    {
        SettlementEngineProbe engine = new SettlementEngineProbe(token);
        OutcomeSettlementVault escrow = engine.vault();
        uint256 amount = bound(rawAmount, 2, MAX_AMOUNT);
        token.mint(address(engine), amount + 10);
        token.transfer(address(escrow), 100);
        uint8 mode = 1 + rawMode % 6;
        token.setFailure(mode);
        if (mode == 2) vm.expectRevert(SettlementTestToken.TokenRefused.selector);
        else vm.expectRevert(SettlementEngineProbe.DepositFailed.selector);
        engine.depositAndRegister(1, _single(7, amount));
        assertFalse(escrow.registered(1));
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(escrow)), 100);
        assertEq(token.balanceOf(address(engine)), amount + 10);
    }

    function testFuzz_mixedEightEscrowsPayInArbitraryOrderAndDrainExactly(
        uint256 round,
        uint256[8] memory amounts,
        uint256 seed
    ) public {
        uint256 total;
        for (uint256 q; q < 8; ++q) {
            amounts[q] = bound(amounts[q], 0, MAX_AMOUNT);
            total += amounts[q];
        }
        _deposit(round, amounts);
        uint256 left = total;
        uint256[] memory order = _permutation(8, seed);
        for (uint256 i; i < 8; ++i) {
            // The permutation contains only values in0..7.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 q = uint8(order[i]);
            uint256 pattern = uint256(keccak256(abi.encode(seed, q)));
            uint256 first = amounts[q] * (pattern % 1001) / 1000;
            uint256 second = (amounts[q] - first) * ((pattern >> 10) % 1001) / 1000;
            uint256 third = amounts[q] - first - second;
            if (first != 0) vault.pay(round, q, ALICE, first);
            if (second != 0) vault.pay(round, q, BOB, second);
            if (third != 0) vault.pay(round, q, CAROL, third);
            left -= amounts[q];
            assertEq(vault.remaining(round, q), 0);
            assertEq(vault.totalEscrowed(), left);
            assertEq(token.balanceOf(address(vault)), left);
        }
        assertEq(token.balanceOf(ALICE) + token.balanceOf(BOB) + token.balanceOf(CAROL), total);
        assertEq(vault.totalEscrowed(), 0);
    }

    function testFuzz_fourCyclesInterleavePartialPaymentsWithoutCrossSpending(
        uint256 rawRound,
        uint256[32] memory amounts,
        uint256 seed
    ) public {
        uint256 base = rawRound % (type(uint256).max - 3);
        uint256 total;
        for (uint256 r; r < 4; ++r) {
            uint256[8] memory row;
            for (uint256 q; q < 8; ++q) {
                amounts[r * 8 + q] = bound(amounts[r * 8 + q], 0, MAX_AMOUNT);
                row[q] = amounts[r * 8 + q];
            }
            total += _deposit(base + r, row);
        }
        uint256[] memory order = _permutation(32, seed);
        for (uint256 pass; pass < 2; ++pass) {
            for (uint256 i; i < 32; ++i) {
                uint256 index = order[pass == 0 ? i : 31 - i];
                uint256 r = index / 8;
                // The modulo bounds the value to0..7.
                // forge-lint: disable-next-line(unsafe-typecast)
                uint8 q = uint8(index % 8);
                uint256 divisor = 2 + ((seed >> index) % 15);
                uint256 amount = pass == 0 ? amounts[index] / divisor : amounts[index];
                if (amount != 0) vault.pay(base + r, q, pass == 0 ? ALICE : BOB, amount);
                amounts[index] -= amount;
                total -= amount;
                assertEq(vault.totalEscrowed(), total);
                assertEq(token.balanceOf(address(vault)), total);
                for (uint256 cell; cell < 32; ++cell) {
                    // The modulo bounds the value to0..7.
                    // forge-lint: disable-next-line(unsafe-typecast)
                    assertEq(vault.remaining(base + cell / 8, uint8(cell % 8)), amounts[cell]);
                }
            }
        }
        assertEq(total, 0);
        assertEq(vault.totalEscrowed(), 0);
    }

    function testFuzz_unbackedRegistrationCannotBorrowAnotherCycle(uint256 existing, uint256 surplus, uint256 deficit)
        public
    {
        existing = bound(existing, 1, MAX_AMOUNT);
        surplus = bound(surplus, 0, MAX_AMOUNT);
        deficit = bound(deficit, 1, MAX_AMOUNT);
        _deposit(1, _single(4, existing));
        if (surplus != 0) token.transfer(address(vault), surplus);
        uint256[8] memory amounts = _single(0, surplus + deficit);
        vm.expectRevert(OutcomeSettlementVault.InvalidDeposit.selector);
        vault.register(2, amounts);
        assertEq(vault.totalEscrowed(), existing);
        assertEq(vault.remaining(1, 4), existing);
        assertFalse(vault.registered(2));
        for (uint8 q; q < 8; ++q) {
            assertEq(vault.remaining(2, q), 0);
        }
    }

    function _permutation(uint256 count, uint256 seed) private pure returns (uint256[] memory order) {
        order = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            order[i] = i;
        }
        for (uint256 i = count; i > 1; --i) {
            uint256 j = uint256(keccak256(abi.encode(seed, i))) % i;
            (order[i - 1], order[j]) = (order[j], order[i - 1]);
        }
    }
}
