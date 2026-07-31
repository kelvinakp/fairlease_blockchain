const STATUS_LABELS = [
  "Created",
  "Funded",
  "Active",
  "SettlementProposed",
  "Disputed",
  "Completed",
  "Cancelled"
];

const RULING_LABELS = ["None", "TenantWins", "LandlordWins", "Split"];
const CRED_STATUS = ["Active", "Disputed", "Completed"];

function shortAddr(a) {
  if (!a) return "-";
  return a.slice(0, 6) + "..." + a.slice(-4);
}

function explorerTx(hash) {
  return `${window.FAIRLEASE_CONFIG.explorerBase}/tx/${hash}`;
}

function explorerAddress(addr) {
  return `${window.FAIRLEASE_CONFIG.explorerBase}/address/${addr}`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${secs}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function fairLeaseApp() {

  let walletProvider = null;
  let walletSigner = null;
  let countdownTimer = null;

  return {
    shortAddr,
    explorerTx,
    explorerAddress,
    formatDuration,
    get FAIRLEASE_CONFIG() { return window.FAIRLEASE_CONFIG; },
    get currentRole() {
      if (!this.account) return "Not connected";
      const account = this.account.toLowerCase();
      if (this.agreement?.tenant?.toLowerCase() === account) return "Tenant";
      if (this.agreement?.landlord?.toLowerCase() === account) return "Landlord";
      if (this.dispute && this.isPartyInDispute) return "Dispute party (cannot vote)";
      if (this.eligibleJuror) return "Can vote as juror";
      if (window.FAIRLEASE_CONFIG.deployer?.toLowerCase() === account) return "Contract owner";
      return "Connected user";
    },

    get isPartyInDispute() {
      if (!this.account || !this.dispute) return false;
      const account = this.account.toLowerCase();
      return this.dispute.landlord?.toLowerCase() === account ||
        this.dispute.tenant?.toLowerCase() === account;
    },

    get isPartyInAgreement() {
      if (!this.account || !this.agreement) return false;
      const account = this.account.toLowerCase();
      return this.agreement.landlord?.toLowerCase() === account ||
        this.agreement.tenant?.toLowerCase() === account;
    },

    get jurorStatusLabel() {
      if (!this.account) return "Connect wallet";
      if (!this.eligibleJuror) return "Not enough LCRED";
      if (this.isPartyInDispute) return "Has LCRED (can't vote on this case)";
      if (this.isPartyInAgreement && !this.dispute) return "Has LCRED (party on loaded agreement)";
      return "Can vote as juror";
    },

    get jurorStatusClass() {
      if (!this.account || !this.eligibleJuror) return "";
      if (this.isPartyInDispute || this.isPartyInAgreement) return "warn";
      return "ok";
    },

    get isPastDeadline() {
      return Boolean(this.dispute?.deadline && this.nowTs > Number(this.dispute.deadline));
    },

    get votingOpen() {
      return Boolean(this.dispute && !this.dispute.finalized && !this.isPastDeadline);
    },

    get votingClosed() {
      return Boolean(this.dispute && !this.dispute.finalized && this.isPastDeadline);
    },

    get countdownLabel() {
      if (!this.dispute) return "Load a dispute to see the voting timer.";
      if (this.dispute.finalized) return "Voting finished — dispute finalized.";
      if (this.isPastDeadline) return "Voting closed — finalize to release the deposit.";
      if (this.secondsLeft <= 0) {
        return "Deadline reached — wait 1 more second, then finalize (chain needs time > deadline).";
      }
      return `Voting ends in ${formatDuration(this.secondsLeft)}`;
    },

    get countdownClass() {
      if (!this.dispute || this.dispute.finalized) return "";
      if (this.isPastDeadline) return "closed";
      if (this.secondsLeft <= 30) return "urgent";
      return "open";
    },

    get countdownProgress() {
      if (!this.dispute || !this.votingPeriodSeconds) return 0;
      const used = Math.max(0, this.votingPeriodSeconds - this.secondsLeft);
      return Math.min(100, Math.round((used / this.votingPeriodSeconds) * 100));
    },

    get canVoteOnDispute() {
      return Boolean(
        this.account &&
        this.chainOk &&
        !this.busy &&
        this.eligibleJuror &&
        this.dispute &&
        !this.dispute.finalized &&
        !this.isPartyInDispute &&
        !this.isPastDeadline
      );
    },

    get canFinalizeDispute() {
      return Boolean(
        this.account &&
        this.chainOk &&
        !this.busy &&
        this.dispute &&
        !this.dispute.finalized &&
        this.isPastDeadline
      );
    },

    get voteBlockReason() {
      if (!this.account) return "Connect MetaMask first.";
      if (!this.chainOk) return "Switch MetaMask to Sepolia.";
      if (!this.dispute) return "Load a dispute first.";
      if (this.dispute.finalized) return "This dispute is already finalized.";
      if (this.isPastDeadline) {
        return "Voting time is over. Click Finalize result to release the deposit.";
      }
      if (!this.eligibleJuror) return "Need at least 10 LCRED to vote as a juror.";
      if (this.isPartyInDispute) {
        return "You are the landlord or tenant in this dispute, so you cannot vote. Switch to a separate juror wallet.";
      }
      return "";
    },

    get finalizeBlockReason() {
      if (!this.account) return "Connect MetaMask first.";
      if (!this.chainOk) return "Switch MetaMask to Sepolia.";
      if (!this.dispute) return "Load a dispute first.";
      if (this.dispute.finalized) return "This dispute is already finalized.";
      if (!this.isPastDeadline) {
        if (this.secondsLeft > 0) {
          return `Finalize is locked for ${formatDuration(this.secondsLeft)}. Jurors can still vote.`;
        }
        return "Wait 1 more second — contract requires block time strictly after the deadline.";
      }
      return "";
    },

    account: "",
    chainOk: false,
    connecting: false,
    busy: false,
    walletAvailable: false,
    tab: "landlord",
    statusMsg: "Connect MetaMask (Sepolia) to begin.",
    statusKind: "",
    ethUsdDisplay: "-",
    creditBalance: "-",
    eligibleJuror: false,
    nowTs: Math.floor(Date.now() / 1000),
    secondsLeft: 0,
    votingPeriodSeconds: 0,

    tenantAddress: "",
    depositUsd: "100",
    leaseTerms: "Demo apartment — Room 101, 1 month, no pets",
    agreementId: "1",
    landlordClaimEth: "0",
    disputeId: "1",
    voteChoice: "1",
    credentialId: "1",

    agreement: null,
    dispute: null,
    credential: null,
    quoteWei: null,
    lastTx: "",

    abis: {
      fairLease: null,
      leaseCourt: null,
      leaseCredit: null,
      leaseCredential: null
    },

    async init() {
      try {
        const [fl, court, credit, cred] = await Promise.all([
          fetch("./abi/FairLease.json").then((r) => r.json()),
          fetch("./abi/LeaseCourt.json").then((r) => r.json()),
          fetch("./abi/LeaseCredit.json").then((r) => r.json()),
          fetch("./abi/LeaseCredential.json").then((r) => r.json())
        ]);
        this.abis.fairLease = fl;
        this.abis.leaseCourt = court;
        this.abis.leaseCredit = credit;
        this.abis.leaseCredential = cred;
      } catch (e) {
        this.setStatus("Failed to load ABIs. Serve this folder with npx serve.", "error");
      }

      const ethereum = this.getEthereumProvider();
      this.walletAvailable = Boolean(ethereum);
      if (ethereum) {
        ethereum.on("accountsChanged", (accounts) => this.handleAccountsChanged(accounts));
        ethereum.on("chainChanged", () => this.handleChainChanged());

        try {
          const accounts = await ethereum.request({ method: "eth_accounts" });
          if (accounts.length > 0) await this.setupWallet(ethereum, accounts[0]);
        } catch (error) {
          console.warn("Could not restore wallet connection", error);
        }
      }

      await this.refreshVotingPeriod();
    },

    stopCountdown() {
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    },

    updateCountdown() {
      this.nowTs = Math.floor(Date.now() / 1000);
      if (!this.dispute || !this.dispute.deadline) {
        this.secondsLeft = 0;
        return;
      }
      this.secondsLeft = Math.max(0, Number(this.dispute.deadline) - this.nowTs);
    },

    startCountdown() {
      this.stopCountdown();
      this.updateCountdown();
      if (!this.dispute || this.dispute.finalized) return;
      countdownTimer = setInterval(() => this.updateCountdown(), 1000);
    },

    async refreshVotingPeriod() {
      if (!this.contractsConfigured() || !walletSigner) return;
      try {
        const court = this.getContract("leaseCourt");
        const period = await court.votingPeriod();
        this.votingPeriodSeconds = Number(period);
      } catch {
        this.votingPeriodSeconds = 0;
      }
    },

    getEthereumProvider() {
      const { ethereum } = window;
      if (!ethereum) return null;

      if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
        return ethereum.providers.find((p) => p.isMetaMask) || ethereum.providers[0];
      }
      return ethereum;
    },

    clearWalletState(message = "Wallet disconnected. Connect MetaMask to continue.") {
      this.account = "";
      walletSigner = null;
      walletProvider = null;
      this.chainOk = false;
      this.creditBalance = "-";
      this.eligibleJuror = false;
      this.ethUsdDisplay = "-";
      this.setStatus(message);
    },

    async disconnect() {
      const ethereum = this.getEthereumProvider();
      try {

        if (ethereum?.request) {
          await ethereum.request({
            method: "wallet_revokePermissions",
            params: [{ eth_accounts: {} }]
          });
        }
      } catch (error) {
        console.info("Wallet permission could not be revoked; clearing local session.", error);
      } finally {
        this.clearWalletState();
      }
    },

    async handleAccountsChanged(accounts) {
      if (!accounts || accounts.length === 0) {
        this.clearWalletState("MetaMask disconnected. Connect a wallet to continue.");
        return;
      }
      await this.setupWallet(this.getEthereumProvider(), accounts[0]);
    },

    async handleChainChanged() {
      const ethereum = this.getEthereumProvider();
      if (!ethereum) return;
      const accounts = await ethereum.request({ method: "eth_accounts" });
      if (accounts.length > 0) await this.setupWallet(ethereum, accounts[0]);
    },

    async setupWallet(ethereum, selectedAccount) {
      walletProvider = new ethers.BrowserProvider(ethereum, "any");
      const network = await walletProvider.getNetwork();
      const wanted = BigInt(window.FAIRLEASE_CONFIG.chainId);
      this.chainOk = network.chainId === wanted;

      if (!this.chainOk) {
        this.account = selectedAccount || "";
        walletSigner = null;
        this.setStatus("Wallet connected, but MetaMask must be switched to Sepolia.", "error");
        return false;
      }

      walletSigner = await walletProvider.getSigner();
      this.account = await walletSigner.getAddress();
      this.setStatus(`Connected ${shortAddr(this.account)} on Sepolia.`, "success");
      await Promise.all([this.refreshOracle(), this.refreshCredit(), this.refreshVotingPeriod()]);
      return true;
    },

    async ensureSepoliaNetwork(ethereum) {
      const chainId = window.FAIRLEASE_CONFIG.chainId;
      const currentChainId = await ethereum.request({ method: "eth_chainId" });
      if (currentChainId?.toLowerCase() === chainId.toLowerCase()) return;

      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId }]
        });
      } catch (err) {

        if (err?.code === 4902) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId,
                chainName: window.FAIRLEASE_CONFIG.chainName || "Sepolia",
                nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://rpc.sepolia.org"],
                blockExplorerUrls: [window.FAIRLEASE_CONFIG.explorerBase]
              }
            ]
          });
          return;
        }
        throw err;
      }
    },

    contractsConfigured() {
      const c = window.FAIRLEASE_CONFIG.contracts;
      return c.fairLease && c.leaseCourt && c.leaseCredit && c.leaseCredential;
    },

    getContract(name) {
      if (!walletSigner) throw new Error("Wallet not connected");
      const addr = window.FAIRLEASE_CONFIG.contracts[name];
      if (!addr) throw new Error(`Missing address for ${name} in config.js`);
      const abiKey = name;

      return new ethers.Contract(addr.toLowerCase(), this.abis[abiKey], walletSigner);
    },

    setStatus(msg, kind = "") {
      this.statusMsg = msg;
      this.statusKind = kind;
    },

    async connect() {
      if (this.connecting) return;
      this.connecting = true;
      try {
        if (window.location.protocol === "file:") {
          this.setStatus(
            "Open via a local server, not file://. Run: cd web && npx serve",
            "error"
          );
          return;
        }

        const ethereum = this.getEthereumProvider();
        if (!ethereum) {
          this.setStatus("MetaMask not found. Install MetaMask browser extension.", "error");
          return;
        }

        this.setStatus("Waiting for MetaMask approval…");
        const accounts = await ethereum.request({ method: "eth_requestAccounts" });
        await this.ensureSepoliaNetwork(ethereum);
        await this.setupWallet(ethereum, accounts[0]);
      } catch (e) {
        if (e?.code === 4001) {
          this.setStatus("MetaMask request rejected. Click Connect and approve.", "error");
          return;
        }
        const msg = e?.reason || e?.shortMessage || e?.message || String(e);
        this.setStatus(msg, "error");
      } finally {
        this.connecting = false;
      }
    },

    async withTx(label, fn) {
      if (this.busy) return null;
      this.busy = true;
      try {
        this.setStatus(`${label}… pending signature`);
        const tx = await fn();
        this.setStatus(`${label}… waiting for confirmation\n${explorerTx(tx.hash)}`);
        const receipt = await tx.wait();
        this.lastTx = tx.hash;
        this.setStatus(`${label} confirmed in block ${receipt.blockNumber}\n${explorerTx(tx.hash)}`, "success");
        return receipt;
      } catch (e) {
        const msg = e?.reason || e?.shortMessage || e?.message || String(e);
        this.setStatus(msg, "error");
        throw e;
      } finally {
        this.busy = false;
      }
    },

    usdToCents(usdStr) {
      const n = Number(usdStr);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Deposit USD must be > 0");
      return Math.round(n * 100);
    },

    async refreshOracle() {
      if (!this.contractsConfigured() || !walletSigner) return;
      try {
        const fl = this.getContract("fairLease");
        const [answer, decimals] = await fl.getLatestPrice();
        const price = Number(ethers.formatUnits(answer, decimals));
        this.ethUsdDisplay = `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      } catch (e) {
        this.ethUsdDisplay = "unavailable";
      }
    },

    async refreshCredit() {
      if (!this.contractsConfigured() || !walletSigner || !this.account) return;
      try {
        const credit = this.getContract("leaseCredit");

        if (walletProvider) {
          await walletProvider.getBlockNumber();
        }
        const bal = await credit.balanceOf(this.account);
        const formatted = ethers.formatEther(bal);

        const nice = formatted.includes(".")
          ? formatted.replace(/\.?0+$/, "")
          : formatted;
        this.creditBalance = `${nice} LCRED`;
        this.eligibleJuror = await credit.isEligibleJuror(this.account);
        return bal;
      } catch {
        this.creditBalance = "-";
        this.eligibleJuror = false;
        return null;
      }
    },

    async getJurorRewardLabel() {
      try {
        const court = this.getContract("leaseCourt");
        const reward = await court.jurorReward();
        const formatted = ethers.formatEther(reward).replace(/\.?0+$/, "");
        return `${formatted} LCRED`;
      } catch {
        return "10 LCRED";
      }
    },

    async createAgreement() {
      const fl = this.getContract("fairLease");
      const cents = this.usdToCents(this.depositUsd);
      const hash = ethers.id(this.leaseTerms.trim() || "fairlease-demo");
      await this.withTx("createAgreement", () =>
        fl.createAgreement(this.tenantAddress.trim(), cents, hash)
      );
      const nextId = await fl.nextAgreementId();
      this.agreementId = String(Number(nextId) - 1);
      await this.loadAgreement();
    },

    async quoteFund() {
      const fl = this.getContract("fairLease");
      const [requiredWei, answer, decimals] = await fl.previewFund(BigInt(this.agreementId));
      this.quoteWei = requiredWei;
      const eth = ethers.formatEther(requiredWei);
      const price = Number(ethers.formatUnits(answer, decimals));
      this.setStatus(
        `Oracle ETH/USD ≈ $${price.toFixed(2)}\nRequired deposit ≈ ${eth} ETH (${requiredWei.toString()} wei)`,
        "success"
      );
    },

    async fundAgreement() {
      const fl = this.getContract("fairLease");
      const [requiredWei] = await fl.previewFund(BigInt(this.agreementId));
      await this.withTx("fundAgreement", () =>
        fl.fundAgreement(BigInt(this.agreementId), { value: requiredWei })
      );
      await this.loadAgreement();
    },

    async activateAgreement() {
      const fl = this.getContract("fairLease");
      await this.withTx("activateAgreement", () => fl.activateAgreement(BigInt(this.agreementId)));
      await this.loadAgreement();
      if (this.agreement?.credentialTokenId) {
        this.credentialId = String(this.agreement.credentialTokenId);
        await this.loadCredential();
      }
    },

    setClaimShare(basisPoints) {
      if (!this.agreement) {
        this.setStatus("Load the agreement first to see its locked deposit.", "error");
        return;
      }
      const depositWei = BigInt(this.agreement.depositWei);
      const claimWei = (depositWei * BigInt(basisPoints)) / 10_000n;
      this.landlordClaimEth = ethers.formatEther(claimWei);
    },

    getClaimWei() {
      try {
        return ethers.parseEther(String(this.landlordClaimEth || "0"));
      } catch {
        return null;
      }
    },

    getTenantRefundEth() {
      if (!this.agreement) return "-";
      const claimWei = this.getClaimWei();
      const depositWei = BigInt(this.agreement.depositWei);
      if (claimWei === null || claimWei < 0n || claimWei > depositWei) return "Invalid claim";
      return ethers.formatEther(depositWei - claimWei);
    },

    isSettlementClaimValid() {
      if (!this.agreement) return false;
      const claimWei = this.getClaimWei();
      return claimWei !== null &&
        claimWei >= 0n &&
        claimWei <= BigInt(this.agreement.depositWei);
    },

    async proposeSettlement() {

      await this.loadAgreement();
      if (!this.agreement) {
        this.setStatus("Agreement could not be loaded.", "error");
        return;
      }

      const fl = this.getContract("fairLease");
      const claimWei = this.getClaimWei();
      if (claimWei === null || claimWei < 0n) {
        this.setStatus("Enter a valid non-negative ETH claim.", "error");
        return;
      }
      if (claimWei > BigInt(this.agreement.depositWei)) {
        this.setStatus(
          `Claim exceeds the locked deposit of ${this.agreement.depositEth} ETH.`,
          "error"
        );
        return;
      }

      await this.withTx("proposeSettlement", () =>
        fl.proposeSettlement(BigInt(this.agreementId), claimWei)
      );
      await this.loadAgreement();
    },

    async acceptSettlement() {
      const fl = this.getContract("fairLease");
      const receipt = await this.withTx("acceptSettlement", () =>
        fl.acceptSettlement(BigInt(this.agreementId))
      );
      if (!receipt) return;
      await this.refreshCredit();
      await this.loadAgreement();
      this.setStatus(
        `Settlement accepted. Completion reward applied if configured. Balance: ${this.creditBalance}\n${explorerTx(receipt.hash)}`,
        "success"
      );
    },

    async raiseDispute() {
      const fl = this.getContract("fairLease");
      await this.withTx("raiseDispute", () => fl.raiseDispute(BigInt(this.agreementId)));
      await this.loadAgreement();
      if (this.agreement?.disputeId) {
        this.disputeId = String(this.agreement.disputeId);
        this.tab = "court";
        await this.refreshVotingPeriod();
        await this.loadDispute();
        const windowLabel = this.votingPeriodSeconds
          ? formatDuration(this.votingPeriodSeconds)
          : "the voting window";
        this.setStatus(
          `Dispute #${this.disputeId} opened. Jurors can vote for the next ${windowLabel}.`,
          "success"
        );
      }
    },

    async cancelAgreement() {
      const fl = this.getContract("fairLease");
      await this.withTx("cancelAgreement", () => fl.cancelAgreement(BigInt(this.agreementId)));
      await this.loadAgreement();
    },

    async vote() {
      if (!this.dispute) {
        await this.loadDispute();
      }
      if (!this.canVoteOnDispute) {
        this.setStatus(this.voteBlockReason || "Cannot vote on this dispute.", "error");
        return;
      }

      const balanceBefore = await this.refreshCredit();
      const rewardLabel = await this.getJurorRewardLabel();
      const court = this.getContract("leaseCourt");
      const receipt = await this.withTx("vote", () =>
        court.vote(BigInt(this.disputeId), Number(this.voteChoice))
      );
      if (!receipt) return;

      const balanceAfter = await this.refreshCredit();
      try {
        await this.loadDispute();
      } catch (e) {
        console.warn("Dispute reload after vote failed", e);
      }

      const gained =
        balanceBefore != null && balanceAfter != null
          ? ethers.formatEther(balanceAfter - balanceBefore).replace(/\.?0+$/, "")
          : null;
      const rewardNote = gained != null
        ? `+${gained} LCRED juror reward`
        : `+${rewardLabel} juror reward`;

      this.setStatus(
        `Vote confirmed in block ${receipt.blockNumber}. ${rewardNote}. Balance: ${this.creditBalance}\n${explorerTx(receipt.hash)}`,
        "success"
      );
    },

    async finalizeDispute() {
      if (!this.dispute) {
        await this.loadDispute();
      }
      if (!this.canFinalizeDispute) {
        this.setStatus(this.finalizeBlockReason || "Cannot finalize yet.", "error");
        return;
      }
      const court = this.getContract("leaseCourt");
      const receipt = await this.withTx("finalize", () => court.finalize(BigInt(this.disputeId)));
      if (!receipt) return;
      await this.refreshCredit();
      await this.loadDispute();
      await this.loadAgreement();
      this.setStatus(
        `Finalize confirmed. Parties received completion LCRED if configured. Your balance: ${this.creditBalance}\n${explorerTx(receipt.hash)}`,
        "success"
      );
    },

    async loadAgreement() {
      try {
        const fl = this.getContract("fairLease");
        const a = await fl.getAgreement(BigInt(this.agreementId));
        this.agreement = {
          landlord: a.landlord,
          tenant: a.tenant,
          depositUsdCents: a.depositUsdCents.toString(),
          depositUsd: (Number(a.depositUsdCents) / 100).toFixed(2),
          depositWei: a.depositWei.toString(),
          depositEth: ethers.formatEther(a.depositWei),
          landlordClaimWei: a.landlordClaimWei.toString(),
          leaseHash: a.leaseHash,
          credentialTokenId: a.credentialTokenId.toString(),
          disputeId: a.disputeId.toString(),
          createdAt: Number(a.createdAt),
          fundedAt: Number(a.fundedAt),
          activatedAt: Number(a.activatedAt),
          status: Number(a.status),
          statusLabel: STATUS_LABELS[Number(a.status)] || String(a.status)
        };
        if (Number(a.disputeId) > 0) {
          this.disputeId = String(a.disputeId);
        }
        if (Number(a.credentialTokenId) > 0) {
          this.credentialId = String(a.credentialTokenId);
        }
      } catch (e) {
        this.agreement = null;
        this.setStatus(e.message || String(e), "error");
      }
    },

    async loadDispute() {
      try {
        const court = this.getContract("leaseCourt");
        await this.refreshVotingPeriod();
        const d = await court.getDispute(BigInt(this.disputeId));
        this.dispute = {
          agreementId: d.agreementId.toString(),
          landlord: d.landlord,
          tenant: d.tenant,
          deadline: Number(d.deadline),
          deadlineLocal: new Date(Number(d.deadline) * 1000).toLocaleString(),
          tenantVotes: d.tenantVotes.toString(),
          landlordVotes: d.landlordVotes.toString(),
          splitVotes: d.splitVotes.toString(),
          finalized: d.finalized,
          ruling: Number(d.ruling),
          rulingLabel: RULING_LABELS[Number(d.ruling)] || String(d.ruling)
        };
        this.startCountdown();
      } catch (e) {
        this.dispute = null;
        this.secondsLeft = 0;
        this.stopCountdown();
        this.setStatus(e.message || String(e), "error");
      }
    },

    async loadCredential() {
      try {
        const nft = this.getContract("leaseCredential");
        const c = await nft.getCredential(BigInt(this.credentialId));
        const owner = await nft.ownerOf(BigInt(this.credentialId));
        const uri = await nft.tokenURI(BigInt(this.credentialId));
        this.credential = {
          agreementId: c.agreementId.toString(),
          depositUsdCents: c.depositUsdCents.toString(),
          landlord: c.landlord,
          tenant: c.tenant,
          leaseHash: c.leaseHash,
          activatedAt: Number(c.activatedAt),
          status: Number(c.status),
          statusLabel: CRED_STATUS[Number(c.status)] || String(c.status),
          owner,
          uri
        };
      } catch (e) {
        this.credential = null;
        this.setStatus(e.message || String(e), "error");
      }
    }
  };
}
