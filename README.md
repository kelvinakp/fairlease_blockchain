# FairLease

Trustless rental-deposit escrow on **Ethereum Sepolia**.

FairLease locks a security deposit in a smart contract so neither landlord nor tenant can take the funds alone. The landlord sets the deposit in USD; the tenant funds the matching ETH using a Chainlink price feed. Parties can settle together, or a community court of LCRED jurors decides the outcome. Each activated lease also mints a soulbound NFT receipt.

---

## Team

| Name | Student ID | Focus |
|------|------------|--------|
| Aung Kyaw Phyo | 6708142 | `FairLease.sol`, `LeaseCredit.sol` |
| Nyi Min Hein | 6709560 | DApp (`web/`), Chainlink oracle integration |
| Swan Htet Naing | 6708128 | `LeaseCredential.sol`, `LeaseCourt.sol` |

Course project: Rangsit University · CSC445 Blockchain

---

## Features

- **Escrow** — ETH deposit locked until settlement or court ruling
- **Chainlink ETH/USD** — USD deposit intent, ETH payment at live price
- **LeaseCredit (LCRED)** — ERC-20 reputation for juror eligibility and rewards
- **LeaseCourt** — community voting (TenantWins / LandlordWins / Split)
- **LeaseCredential** — soulbound ERC-721 lease receipt
- **Web DApp** — MetaMask + Alpine.js + ethers.js

---

## How it works

```text
Create → Fund → Activate (NFT)
              ↘ Settle together → Complete
              ↘ Dispute → Vote → Finalize → Complete
```

1. Landlord creates an agreement (tenant address, USD deposit, lease-terms hash).
2. Tenant funds the oracle-quoted ETH into FairLease (±1% tolerance).
3. Landlord activates; tenant receives a soulbound NFT.
4. Either settle amicably, or raise a dispute for LCRED jurors.
5. On completion, ETH is released and both parties receive LCRED.

---

## Repository structure

```text
contracts/
  FairLease.sol          Escrow + lifecycle + oracle quotes
  LeaseCredit.sol        ERC-20 reputation (LCRED)
  LeaseCourt.sol         Dispute voting
  LeaseCredential.sol    Soulbound ERC-721 receipt
web/
  index.html             UI
  app.js                 MetaMask / ethers logic
  config.js              Sepolia addresses
  styles.css
  abi/                   Contract ABIs for the DApp
```

---

## Deployed Sepolia contracts

| Contract | Address |
|----------|---------|
| LeaseCredit | [`0x191bddc33fb9363cbd8adb80c06e9105eb370717`](https://sepolia.etherscan.io/address/0x191bddc33fb9363cbd8adb80c06e9105eb370717) |
| LeaseCredential | [`0x423c40a5349abdaa8609109e727e3ad9dc138699`](https://sepolia.etherscan.io/address/0x423c40a5349abdaa8609109e727e3ad9dc138699) |
| LeaseCourt | [`0x14331c125b90509c8cdab5db2548da26ca55bb71`](https://sepolia.etherscan.io/address/0x14331c125b90509c8cdab5db2548da26ca55bb71) |
| FairLease | [`0xc60f4be18ae7acefac2711849887ec01ed52cb9e`](https://sepolia.etherscan.io/address/0xc60f4be18ae7acefac2711849887ec01ed52cb9e) |
| Chainlink ETH/USD | [`0x694AA1769357215DE4FAC081bf1f309aDC325306`](https://sepolia.etherscan.io/address/0x694AA1769357215DE4FAC081bf1f309aDC325306) |

Addresses are also listed in [`web/config.js`](web/config.js).

---

## Run the DApp

Requirements: MetaMask, Sepolia ETH, Node.js (for a local static server).

```bash
cd web
npm start
```

Or:

```bash
cd web
npx serve .
```

Open the printed local URL (not `file://`), connect MetaMask to **Sepolia**, then use the Landlord / Tenant / Juror / NFT tabs.

---

## Contracts (Remix)

1. Open each file under `contracts/` in [Remix](https://remix.ethereum.org).
2. Compile with Solidity `0.8.20+` (FairLease may use `^0.8.29` — match the pragma).
3. Deploy order:
   1. `LeaseCredit` (constructor: min juror balance, e.g. `10000000000000000000` = 10 LCRED)
   2. `LeaseCredential` (constructor: base URI string, can be `""`)
   3. `LeaseCourt` (constructor: LeaseCredit address)
   4. `FairLease` (constructor: Chainlink ETH/USD feed)
4. Wire with owner calls:
   - LeaseCredit: `setMinter(FairLease, true)`, `setMinter(LeaseCourt, true)`
   - LeaseCredential: `setMinter(FairLease, true)`
   - LeaseCourt: `setEscrow(FairLease)`, optional `setVotingPeriod(60)` for demos
   - FairLease: `setCredential`, `setCourt`, `setCredit`

OpenZeppelin imports use GitHub URLs suitable for Remix.

---

## Tech stack

- Solidity ^0.8.20 / OpenZeppelin v5 (Ownable, ReentrancyGuard, ERC-20, ERC-721)
- Chainlink AggregatorV3 (ETH/USD)
- ethers.js v6 + Alpine.js + MetaMask
- Network: Ethereum Sepolia

---

## License

MIT.
