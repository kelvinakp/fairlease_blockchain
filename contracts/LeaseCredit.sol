// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/token/ERC20/ERC20.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/access/Ownable.sol";

contract LeaseCredit is ERC20, Ownable {
    mapping(address => bool) public minters;
    uint256 public minJurorBalance;

    event MinterUpdated(address indexed account, bool allowed);
    event MinJurorBalanceUpdated(uint256 oldValue, uint256 newValue);

    constructor(uint256 _minJurorBalance) ERC20("Lease Credit", "LCRED") Ownable(msg.sender) {
        minJurorBalance = _minJurorBalance;
    }

    modifier onlyMinter() {
        require(minters[msg.sender], "LeaseCredit: not minter");
        _;
    }

    function setMinter(address account, bool allowed) external onlyOwner {
        require(account != address(0), "LeaseCredit: zero address");
        minters[account] = allowed;
        emit MinterUpdated(account, allowed);
    }

    function setMinJurorBalance(uint256 newValue) external onlyOwner {
        uint256 oldValue = minJurorBalance;
        minJurorBalance = newValue;
        emit MinJurorBalanceUpdated(oldValue, newValue);
    }

    function mint(address to, uint256 amount) external onlyMinter {
        require(to != address(0), "LeaseCredit: mint to zero");
        require(amount > 0, "LeaseCredit: zero amount");
        _mint(to, amount);
    }

    function isEligibleJuror(address account) external view returns (bool) {
        return balanceOf(account) >= minJurorBalance;
    }
}
