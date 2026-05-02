// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockToken
/// @notice Simple ERC20 used for testing ZamaDropCampaign escrow and claim flows.
contract MockToken is ERC20 {
    address public admin;

    constructor(
        string memory name,
        string memory symbol,
        uint64 initialSupply,
        address admin_
    ) ERC20(name, symbol) {
        admin = admin_;
        _mint(admin_, initialSupply);
    }

    /// @notice Mint additional tokens. Restricted to admin for test convenience.
    function mint(address to, uint256 amount) external {
        require(msg.sender == admin, "MockToken: not admin");
        _mint(to, amount);
    }

    /// @notice 覆盖 OpenZeppelin 默认的 18 位小数。
    ///         ZamaDrop 的所有金额都是 uint64 整数（受 FHE euint64 类型约束），
    ///         没有小数概念。设为 0 可让 MetaMask 等钱包直接显示原始数值，
    ///         避免出现 "1000 raw = 0.000000000000001 token" 的错觉。
    function decimals() public pure override returns (uint8) {
        return 0;
    }
}
