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
}
