// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/access/Ownable.sol";

interface ILeaseCreditView {
    function balanceOf(address account) external view returns (uint256);
    function minJurorBalance() external view returns (uint256);
    function mint(address to, uint256 amount) external;
}

interface IFairLeaseCallback {
    function applyRuling(uint256 agreementId, uint8 ruling) external;
}

contract LeaseCourt is Ownable {
    enum Ruling {
        None,
        TenantWins,
        LandlordWins,
        Split
    }

    struct Dispute {
        uint256 agreementId;
        address landlord;
        address tenant;
        uint256 deadline;
        uint256 tenantVotes;
        uint256 landlordVotes;
        uint256 splitVotes;
        bool finalized;
        Ruling ruling;
        mapping(address => bool) hasVoted;
    }

    ILeaseCreditView public credit;
    address public escrow;

    uint256 public votingPeriod = 1 days;
    uint256 public jurorReward = 10 ether;
    uint256 public nextDisputeId = 1;

    mapping(uint256 => Dispute) private _disputes;
    mapping(uint256 => uint256) public agreementToDispute;

    event EscrowUpdated(address indexed escrow);
    event CreditUpdated(address indexed credit);
    event VotingPeriodUpdated(uint256 seconds_);
    event JurorRewardUpdated(uint256 amount);
    event DisputeOpened(uint256 indexed disputeId, uint256 indexed agreementId, uint256 deadline);
    event VoteCast(uint256 indexed disputeId, address indexed juror, Ruling choice);
    event DisputeFinalized(uint256 indexed disputeId, Ruling ruling);

    constructor(address credit_) Ownable(msg.sender) {
        require(credit_ != address(0), "LeaseCourt: zero credit");
        credit = ILeaseCreditView(credit_);
    }

    modifier onlyEscrow() {
        require(msg.sender == escrow, "LeaseCourt: only escrow");
        _;
    }

    function setEscrow(address escrow_) external onlyOwner {
        require(escrow_ != address(0), "LeaseCourt: zero escrow");
        escrow = escrow_;
        emit EscrowUpdated(escrow_);
    }

    function setCredit(address credit_) external onlyOwner {
        require(credit_ != address(0), "LeaseCourt: zero credit");
        credit = ILeaseCreditView(credit_);
        emit CreditUpdated(credit_);
    }

    function setVotingPeriod(uint256 seconds_) external onlyOwner {
        require(seconds_ >= 1 minutes, "LeaseCourt: period too short");
        votingPeriod = seconds_;
        emit VotingPeriodUpdated(seconds_);
    }

    function setJurorReward(uint256 amount) external onlyOwner {
        jurorReward = amount;
        emit JurorRewardUpdated(amount);
    }

    function openDispute(uint256 agreementId, address landlord, address tenant)
        external
        onlyEscrow
        returns (uint256 disputeId)
    {
        require(agreementToDispute[agreementId] == 0, "LeaseCourt: already open");
        require(landlord != address(0) && tenant != address(0), "LeaseCourt: zero party");

        disputeId = nextDisputeId++;
        Dispute storage d = _disputes[disputeId];
        d.agreementId = agreementId;
        d.landlord = landlord;
        d.tenant = tenant;
        d.deadline = block.timestamp + votingPeriod;

        agreementToDispute[agreementId] = disputeId;
        emit DisputeOpened(disputeId, agreementId, d.deadline);
    }

    function vote(uint256 disputeId, Ruling choice) external {
        Dispute storage d = _disputes[disputeId];
        require(d.agreementId != 0, "LeaseCourt: unknown dispute");
        require(!d.finalized, "LeaseCourt: finalized");
        require(block.timestamp <= d.deadline, "LeaseCourt: voting closed");
        require(choice == Ruling.TenantWins || choice == Ruling.LandlordWins || choice == Ruling.Split, "LeaseCourt: bad choice");
        require(msg.sender != d.landlord && msg.sender != d.tenant, "LeaseCourt: party cannot vote");
        require(!d.hasVoted[msg.sender], "LeaseCourt: already voted");
        require(credit.balanceOf(msg.sender) >= credit.minJurorBalance(), "LeaseCourt: not eligible");

        d.hasVoted[msg.sender] = true;

        if (choice == Ruling.TenantWins) {
            d.tenantVotes += 1;
        } else if (choice == Ruling.LandlordWins) {
            d.landlordVotes += 1;
        } else {
            d.splitVotes += 1;
        }

        credit.mint(msg.sender, jurorReward);
        emit VoteCast(disputeId, msg.sender, choice);
    }

    function finalize(uint256 disputeId) external {
        Dispute storage d = _disputes[disputeId];
        require(d.agreementId != 0, "LeaseCourt: unknown dispute");
        require(!d.finalized, "LeaseCourt: finalized");
        require(block.timestamp > d.deadline, "LeaseCourt: too early");

        Ruling result = _tally(d);
        d.ruling = result;
        d.finalized = true;

        IFairLeaseCallback(escrow).applyRuling(d.agreementId, uint8(result));
        emit DisputeFinalized(disputeId, result);
    }

    function _tally(Dispute storage d) private view returns (Ruling) {
        uint256 t = d.tenantVotes;
        uint256 l = d.landlordVotes;
        uint256 s = d.splitVotes;

        if (t == 0 && l == 0 && s == 0) {
            return Ruling.Split;
        }

        if (t > l && t > s) return Ruling.TenantWins;
        if (l > t && l > s) return Ruling.LandlordWins;
        if (s > t && s > l) return Ruling.Split;

        return Ruling.Split;
    }

    function isDisputeFinalized(uint256 disputeId) external view returns (bool) {
        return _disputes[disputeId].finalized;
    }

    function getRuling(uint256 disputeId) external view returns (uint8) {
        return uint8(_disputes[disputeId].ruling);
    }

    function getDispute(uint256 disputeId)
        external
        view
        returns (
            uint256 agreementId,
            address landlord,
            address tenant,
            uint256 deadline,
            uint256 tenantVotes,
            uint256 landlordVotes,
            uint256 splitVotes,
            bool finalized,
            Ruling ruling
        )
    {
        Dispute storage d = _disputes[disputeId];
        return (
            d.agreementId,
            d.landlord,
            d.tenant,
            d.deadline,
            d.tenantVotes,
            d.landlordVotes,
            d.splitVotes,
            d.finalized,
            d.ruling
        );
    }

    function hasVoted(uint256 disputeId, address account) external view returns (bool) {
        return _disputes[disputeId].hasVoted[account];
    }
}
