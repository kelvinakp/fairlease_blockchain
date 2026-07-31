// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/access/Ownable.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/utils/ReentrancyGuard.sol";

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface ILeaseCredentialMint {
    function mintCredential(
        address landlord,
        address tenant,
        uint256 agreementId,
        uint256 depositUsdCents,
        bytes32 leaseHash
    ) external returns (uint256 tokenId);

    function markCompleted(uint256 tokenId) external;
    function markDisputed(uint256 tokenId) external;
}

interface ILeaseCourtOpen {
    function openDispute(uint256 agreementId, address landlord, address tenant) external returns (uint256 disputeId);
}

interface ILeaseCreditMint {
    function mint(address to, uint256 amount) external;
}

contract FairLease is Ownable, ReentrancyGuard {
    enum Status {
        Created,
        Funded,
        Active,
        SettlementProposed,
        Disputed,
        Completed,
        Cancelled
    }

    enum Ruling {
        None,
        TenantWins,
        LandlordWins,
        Split
    }

    struct Agreement {
        address landlord;
        address tenant;
        uint256 depositUsdCents;
        uint256 depositWei;
        uint256 landlordClaimWei;
        bytes32 leaseHash;
        uint256 credentialTokenId;
        uint256 disputeId;
        uint64 createdAt;
        uint64 fundedAt;
        uint64 activatedAt;
        Status status;
    }

    AggregatorV3Interface public priceFeed;
    ILeaseCredentialMint public credential;
    ILeaseCourtOpen public court;
    ILeaseCreditMint public credit;

    uint256 public maxPriceAge = 1 hours;
    uint256 public paymentToleranceBps = 100;
    uint256 public completionReward = 50 ether;
    uint256 public nextAgreementId = 1;
    mapping(uint256 => Agreement) public agreements;

    event PriceFeedUpdated(address indexed feed);
    event CredentialUpdated(address indexed credential);
    event CourtUpdated(address indexed court);
    event CreditUpdated(address indexed credit);
    event MaxPriceAgeUpdated(uint256 seconds_);
    event PaymentToleranceUpdated(uint256 bps);
    event CompletionRewardUpdated(uint256 amount);

    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed landlord,
        address indexed tenant,
        uint256 depositUsdCents,
        bytes32 leaseHash
    );
    event AgreementFunded(uint256 indexed agreementId, uint256 depositWei, int256 ethUsdPrice);
    event AgreementActivated(uint256 indexed agreementId, uint256 credentialTokenId);
    event SettlementProposed(uint256 indexed agreementId, uint256 landlordClaimWei);
    event SettlementAccepted(uint256 indexed agreementId);
    event DisputeRaised(uint256 indexed agreementId, uint256 disputeId);
    event RulingApplied(uint256 indexed agreementId, Ruling ruling, uint256 toLandlord, uint256 toTenant);
    event AgreementCancelled(uint256 indexed agreementId);
    event AgreementCompleted(uint256 indexed agreementId);

    constructor(address priceFeed_) Ownable(msg.sender) {
        require(priceFeed_ != address(0), "FairLease: zero feed");
        priceFeed = AggregatorV3Interface(priceFeed_);
    }

    function setPriceFeed(address feed) external onlyOwner {
        require(feed != address(0), "FairLease: zero feed");
        priceFeed = AggregatorV3Interface(feed);
        emit PriceFeedUpdated(feed);
    }

    function setCredential(address credential_) external onlyOwner {
        require(credential_ != address(0), "FairLease: zero credential");
        credential = ILeaseCredentialMint(credential_);
        emit CredentialUpdated(credential_);
    }

    function setCourt(address court_) external onlyOwner {
        require(court_ != address(0), "FairLease: zero court");
        court = ILeaseCourtOpen(court_);
        emit CourtUpdated(court_);
    }

    function setCredit(address credit_) external onlyOwner {
        require(credit_ != address(0), "FairLease: zero credit");
        credit = ILeaseCreditMint(credit_);
        emit CreditUpdated(credit_);
    }

    function setMaxPriceAge(uint256 seconds_) external onlyOwner {
        require(seconds_ >= 1 minutes, "FairLease: age too short");
        maxPriceAge = seconds_;
        emit MaxPriceAgeUpdated(seconds_);
    }

    function setPaymentToleranceBps(uint256 bps) external onlyOwner {
        require(bps <= 500, "FairLease: tolerance too high");
        paymentToleranceBps = bps;
        emit PaymentToleranceUpdated(bps);
    }

    function setCompletionReward(uint256 amount) external onlyOwner {
        completionReward = amount;
        emit CompletionRewardUpdated(amount);
    }

    function getLatestPrice() public view returns (int256 answer, uint8 decimals_, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 rawAnswer,
            ,
            uint256 rawUpdatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        require(rawAnswer > 0, "FairLease: invalid price");
        require(rawUpdatedAt > 0, "FairLease: round incomplete");
        require(answeredInRound >= roundId, "FairLease: stale round");
        require(block.timestamp - rawUpdatedAt <= maxPriceAge, "FairLease: price too old");

        return (rawAnswer, priceFeed.decimals(), rawUpdatedAt);
    }

    function quoteDepositWei(uint256 depositUsdCents) public view returns (uint256 weiAmount, int256 answer) {
        require(depositUsdCents > 0, "FairLease: zero deposit");
        uint8 decimals_;
        (answer, decimals_,) = getLatestPrice();

        uint256 scale = 10 ** uint256(decimals_);
        weiAmount = (depositUsdCents * 1e18 * scale) / (uint256(answer) * 100);
        require(weiAmount > 0, "FairLease: wei rounds to zero");
    }

    function createAgreement(address tenant, uint256 depositUsdCents, bytes32 leaseHash)
        external
        returns (uint256 agreementId)
    {
        require(tenant != address(0), "FairLease: zero tenant");
        require(tenant != msg.sender, "FairLease: self lease");
        require(depositUsdCents > 0, "FairLease: zero deposit");
        require(leaseHash != bytes32(0), "FairLease: empty hash");

        agreementId = nextAgreementId++;
        Agreement storage a = agreements[agreementId];
        a.landlord = msg.sender;
        a.tenant = tenant;
        a.depositUsdCents = depositUsdCents;
        a.leaseHash = leaseHash;
        a.createdAt = uint64(block.timestamp);
        a.status = Status.Created;

        emit AgreementCreated(agreementId, msg.sender, tenant, depositUsdCents, leaseHash);
    }

    function fundAgreement(uint256 agreementId) external payable nonReentrant {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Created, "FairLease: not Created");
        require(msg.sender == a.tenant, "FairLease: only tenant");

        (uint256 requiredWei, int256 answer) = quoteDepositWei(a.depositUsdCents);
        uint256 tolerance = (requiredWei * paymentToleranceBps) / 10_000;
        require(msg.value + tolerance >= requiredWei, "FairLease: underpaid");
        require(msg.value <= requiredWei + tolerance, "FairLease: overpaid");

        a.depositWei = msg.value;
        a.fundedAt = uint64(block.timestamp);
        a.status = Status.Funded;

        emit AgreementFunded(agreementId, msg.value, answer);
    }

    function activateAgreement(uint256 agreementId) external nonReentrant {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Funded, "FairLease: not Funded");
        require(msg.sender == a.landlord, "FairLease: only landlord");
        require(address(credential) != address(0), "FairLease: credential unset");

        uint256 tokenId = credential.mintCredential(
            a.landlord,
            a.tenant,
            agreementId,
            a.depositUsdCents,
            a.leaseHash
        );

        a.credentialTokenId = tokenId;
        a.activatedAt = uint64(block.timestamp);
        a.status = Status.Active;

        emit AgreementActivated(agreementId, tokenId);
    }

    function proposeSettlement(uint256 agreementId, uint256 landlordClaimWei) external {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Active, "FairLease: not Active");
        require(msg.sender == a.landlord, "FairLease: only landlord");
        require(landlordClaimWei <= a.depositWei, "FairLease: claim too high");

        a.landlordClaimWei = landlordClaimWei;
        a.status = Status.SettlementProposed;
        emit SettlementProposed(agreementId, landlordClaimWei);
    }

    function acceptSettlement(uint256 agreementId) external nonReentrant {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.SettlementProposed, "FairLease: not proposed");
        require(msg.sender == a.tenant, "FairLease: only tenant");

        _release(agreementId, a.landlordClaimWei, a.depositWei - a.landlordClaimWei);
        emit SettlementAccepted(agreementId);
    }

    function raiseDispute(uint256 agreementId) external nonReentrant {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Active || a.status == Status.SettlementProposed, "FairLease: bad status");
        require(msg.sender == a.landlord || msg.sender == a.tenant, "FairLease: not party");
        require(address(court) != address(0), "FairLease: court unset");

        uint256 disputeId = court.openDispute(agreementId, a.landlord, a.tenant);
        a.disputeId = disputeId;
        a.status = Status.Disputed;

        if (a.credentialTokenId != 0) {
            credential.markDisputed(a.credentialTokenId);
        }

        emit DisputeRaised(agreementId, disputeId);
    }

    function applyRuling(uint256 agreementId, uint8 rulingRaw) external nonReentrant {
        require(msg.sender == address(court), "FairLease: only court");
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Disputed, "FairLease: not Disputed");

        Ruling ruling = Ruling(rulingRaw);
        uint256 toLandlord;
        uint256 toTenant;

        if (ruling == Ruling.TenantWins) {
            toTenant = a.depositWei;
        } else if (ruling == Ruling.LandlordWins) {
            toLandlord = a.depositWei;
        } else {
            toLandlord = a.depositWei / 2;
            toTenant = a.depositWei - toLandlord;
        }

        _release(agreementId, toLandlord, toTenant);
        emit RulingApplied(agreementId, ruling, toLandlord, toTenant);
    }

    function cancelAgreement(uint256 agreementId) external {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Created, "FairLease: not Created");
        require(msg.sender == a.landlord, "FairLease: only landlord");
        a.status = Status.Cancelled;
        emit AgreementCancelled(agreementId);
    }

    function _release(uint256 agreementId, uint256 toLandlord, uint256 toTenant) private {
        Agreement storage a = agreements[agreementId];
        require(toLandlord + toTenant == a.depositWei, "FairLease: bad split");

        a.status = Status.Completed;
        a.depositWei = 0;

        if (toLandlord > 0) {
            (bool okL, ) = a.landlord.call{value: toLandlord}("");
            require(okL, "FairLease: landlord pay fail");
        }
        if (toTenant > 0) {
            (bool okT, ) = a.tenant.call{value: toTenant}("");
            require(okT, "FairLease: tenant pay fail");
        }

        if (a.credentialTokenId != 0) {
            credential.markCompleted(a.credentialTokenId);
        }

        if (address(credit) != address(0) && completionReward > 0) {
            credit.mint(a.landlord, completionReward);
            credit.mint(a.tenant, completionReward);
        }

        emit AgreementCompleted(agreementId);
    }

    function getAgreement(uint256 agreementId) external view returns (Agreement memory) {
        return agreements[agreementId];
    }

    function previewFund(uint256 agreementId)
        external
        view
        returns (uint256 requiredWei, int256 ethUsdAnswer, uint8 decimals_, uint256 updatedAt)
    {
        Agreement storage a = agreements[agreementId];
        require(a.depositUsdCents > 0, "FairLease: unknown agreement");
        (requiredWei, ethUsdAnswer) = quoteDepositWei(a.depositUsdCents);
        (, decimals_, updatedAt) = getLatestPrice();
    }
}
