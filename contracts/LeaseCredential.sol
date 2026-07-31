// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/token/ERC721/ERC721.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/access/Ownable.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/utils/Strings.sol";

contract LeaseCredential is ERC721, Ownable {
    using Strings for uint256;

    enum CredentialStatus {
        Active,
        Disputed,
        Completed
    }

    struct CredentialData {
        uint256 agreementId;
        uint256 depositUsdCents;
        address landlord;
        address tenant;
        bytes32 leaseHash;
        uint256 activatedAt;
        CredentialStatus status;
    }

    mapping(address => bool) public minters;
    mapping(uint256 => CredentialData) private _credentials;

    uint256 private _nextTokenId = 1;
    string private _baseTokenURI;

    event MinterUpdated(address indexed account, bool allowed);
    event CredentialMinted(uint256 indexed tokenId, uint256 indexed agreementId, address landlord, address tenant);
    event CredentialStatusUpdated(uint256 indexed tokenId, CredentialStatus status);
    event BaseURIUpdated(string newBaseURI);

    constructor(string memory baseURI_) ERC721("FairLease Credential", "LEASE") Ownable(msg.sender) {
        _baseTokenURI = baseURI_;
    }

    modifier onlyMinter() {
        require(minters[msg.sender], "LeaseCredential: not minter");
        _;
    }

    function setMinter(address account, bool allowed) external onlyOwner {
        require(account != address(0), "LeaseCredential: zero address");
        minters[account] = allowed;
        emit MinterUpdated(account, allowed);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function mintCredential(
        address landlord,
        address tenant,
        uint256 agreementId,
        uint256 depositUsdCents,
        bytes32 leaseHash
    ) external onlyMinter returns (uint256 tokenId) {
        require(landlord != address(0) && tenant != address(0), "LeaseCredential: zero party");
        require(landlord != tenant, "LeaseCredential: same parties");

        tokenId = _nextTokenId++;
        _safeMint(tenant, tokenId);

        _credentials[tokenId] = CredentialData({
            agreementId: agreementId,
            depositUsdCents: depositUsdCents,
            landlord: landlord,
            tenant: tenant,
            leaseHash: leaseHash,
            activatedAt: block.timestamp,
            status: CredentialStatus.Active
        });

        emit CredentialMinted(tokenId, agreementId, landlord, tenant);
    }

    function markCompleted(uint256 tokenId) external onlyMinter {
        _requireOwned(tokenId);
        _credentials[tokenId].status = CredentialStatus.Completed;
        emit CredentialStatusUpdated(tokenId, CredentialStatus.Completed);
    }

    function markDisputed(uint256 tokenId) external onlyMinter {
        _requireOwned(tokenId);
        _credentials[tokenId].status = CredentialStatus.Disputed;
        emit CredentialStatusUpdated(tokenId, CredentialStatus.Disputed);
    }

    function getCredential(uint256 tokenId) external view returns (CredentialData memory) {
        _requireOwned(tokenId);
        return _credentials[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        CredentialData memory data = _credentials[tokenId];

        string memory statusLabel = _statusToString(data.status);
        return string(
            abi.encodePacked(
                "data:application/json,{",
                '"name":"FairLease #', tokenId.toString(), '",',
                '"description":"Soulbound lease credential",',
                '"agreementId":"', data.agreementId.toString(), '",',
                '"depositUsdCents":"', data.depositUsdCents.toString(), '",',
                '"landlord":"', _toAsciiHex(data.landlord), '",',
                '"tenant":"', _toAsciiHex(data.tenant), '",',
                '"status":"', statusLabel, '",',
                '"activatedAt":"', data.activatedAt.toString(), '",',
                '"image":"', _baseTokenURI, tokenId.toString(), '.png"',
                "}"
            )
        );
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert("LeaseCredential: soulbound");
        }
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert("LeaseCredential: soulbound");
    }

    function setApprovalForAll(address, bool) public pure override {
        revert("LeaseCredential: soulbound");
    }

    function _statusToString(CredentialStatus status) private pure returns (string memory) {
        if (status == CredentialStatus.Active) return "Active";
        if (status == CredentialStatus.Disputed) return "Disputed";
        return "Completed";
    }

    function _toAsciiHex(address account) private pure returns (string memory) {
        bytes16 hexSymbols = "0123456789abcdef";
        bytes memory buffer = new bytes(42);
        buffer[0] = "0";
        buffer[1] = "x";
        uint160 value = uint160(account);
        for (uint256 i = 41; i > 1; --i) {
            buffer[i] = hexSymbols[value & 0xf];
            value >>= 4;
        }
        return string(buffer);
    }
}
