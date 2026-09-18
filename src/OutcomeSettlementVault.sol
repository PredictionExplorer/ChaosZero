// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

interface ISettlementCollateral {
    function balanceOf(address user) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Keeps closed-cycle claims separate from the active trading pools.
/// @dev Only the deploying market can register or pay claims. There is no sweep,
/// owner, expiry, or reuse of another question's outstanding collateral.
contract OutcomeSettlementVault {
    ISettlementCollateral public immutable cst;
    address public immutable market;
    uint256 public totalEscrowed;
    mapping(uint256 => bool) public registered;
    mapping(uint256 => mapping(uint8 => uint256)) public remaining;

    error Unauthorized();
    error InvalidDeposit();
    error InvalidPayout();
    error TransferFailed();

    event CycleEscrowed(uint256 indexed roundId, uint256[8] amounts);
    event Paid(uint256 indexed roundId, uint8 indexed question, address indexed recipient, uint256 amount);

    constructor(ISettlementCollateral token) {
        if (address(token).code.length == 0) revert InvalidDeposit();
        cst = token;
        market = msg.sender;
    }

    modifier onlyMarket() {
        if (msg.sender != market) revert Unauthorized();
        _;
    }

    /// @dev The market must transfer the exact sum before registering, in the
    /// same guarded transaction. Unsolicited CST never automatically creates a claim.
    function register(uint256 roundId, uint256[8] calldata amounts) external onlyMarket {
        if (registered[roundId]) revert InvalidDeposit();
        registered[roundId] = true;
        uint256 total;
        for (uint8 q; q < 8; ++q) {
            remaining[roundId][q] = amounts[q];
            total += amounts[q];
        }
        totalEscrowed += total;
        if (cst.balanceOf(address(this)) < totalEscrowed) revert InvalidDeposit();
        emit CycleEscrowed(roundId, amounts);
    }

    function pay(uint256 roundId, uint8 question, address recipient, uint256 amount) external onlyMarket {
        if (question >= 8 || recipient == address(0) || amount == 0 || amount > remaining[roundId][question]) {
            revert InvalidPayout();
        }
        remaining[roundId][question] -= amount;
        totalEscrowed -= amount;
        uint256 beforeVault = cst.balanceOf(address(this));
        uint256 beforeRecipient = cst.balanceOf(recipient);
        if (
            !cst.transfer(recipient, amount) || beforeVault - cst.balanceOf(address(this)) != amount
                || cst.balanceOf(recipient) - beforeRecipient != amount
        ) revert TransferFailed();
        emit Paid(roundId, question, recipient, amount);
    }
}
