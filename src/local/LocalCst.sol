// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Valueless development currency. This contract cannot be deployed on Arbitrum One.
contract LocalCst {
    string public constant name = "Local Cosmic Signature Token";
    string public constant symbol = "CST";
    uint8 public constant decimals = 18;
    uint256 public constant MAX_FAUCET_AMOUNT = 1_000_000 ether;
    address public immutable game;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error LocalChainOnly();
    error Unauthorized();
    error InvalidAmount();
    error InsufficientBalance();
    error InsufficientAllowance();
    error InvalidRecipient();
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address game_) {
        if (block.chainid != 31337) revert LocalChainOnly();
        if (game_ == address(0)) revert InvalidRecipient();
        game = game_;
    }

    function faucet(uint256 amount) external {
        if (amount == 0 || amount > MAX_FAUCET_AMOUNT) revert InvalidAmount();
        _mint(msg.sender, amount);
    }

    function mint(address account, uint256 amount) external {
        if (msg.sender != game) revert Unauthorized();
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external {
        if (msg.sender != game) revert Unauthorized();
        if (balanceOf[account] < amount) revert InsufficientBalance();
        balanceOf[account] -= amount;
        totalSupply -= amount;
        emit Transfer(account, address(0), amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount) revert InsufficientAllowance();
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidRecipient();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address account, uint256 amount) private {
        if (account == address(0)) revert InvalidRecipient();
        totalSupply += amount;
        balanceOf[account] += amount;
        emit Transfer(address(0), account, amount);
    }
}
