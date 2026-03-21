> ## Documentation Index
> Fetch the complete documentation index at: https://kamino.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Kamino Finance

> Solana DeFi protocol for automated yield optimization, borrowing and lending, leveraged positions, and concentrated liquidity vaults. Three product areas — Docs (end-user guides), Buildkit (developer APIs and SDK), and Curators (institutional vault management).

## Capabilities

Kamino Finance is the largest borrowing and lending protocol on Solana, offering four core product lines:

**Multiply** — One-click leveraged yield vaults. Users open positions with automated flash loan mechanics and eMode for capital-efficient exposure to yield-bearing assets (e.g. SOL).

**Borrow/Lend (K-Lend)** — Lending markets. Users supply collateral to borrow assets or earn interest on deposits. Supports Cross Mode and Isolated Mode, multiple asset tiers, and automated liquidations.

**Liquidity Vaults** — Automated concentrated liquidity strategies on Solana DEXes. Auto-compound, auto-rebalance, and auto-swap handle all position management.

**Earn Vaults (K-Vaults)** — Curated yield vaults that distribute capital across multiple K-Lend reserves to maximize returns. Accessible to both end users and institutional curators.

Developers integrate via REST API (language-agnostic) or TypeScript SDK (full on-chain control). Institutional operators use the Curators product to create and manage their own lending vaults.

## OpenAPI Specifications

* **Kamino Public API**: [https://api.kamino.finance/openapi/json?openapi=3.0.0](https://api.kamino.finance/openapi/json?openapi=3.0.0)
  * Vault data, market data, user positions, historical metrics, rewards
* **Kamino Transaction API (KTX)**: [https://api.kamino.finance/ktx/documentation/json](https://api.kamino.finance/ktx/documentation/json)
  * Transaction building for deposit, withdraw, borrow, repay — returns unsigned Solana transactions

## Skills

### Earn Vault Operations (Buildkit)

**Vault Data Queries**

* `GET /kvaults/vaults` — List all Kamino Earn vaults
* `GET /kvaults/vaults/{pubkey}` — Get single vault by address
* `GET /kvaults/vaults/{pubkey}/metrics` — Current vault metrics (APY, TVL, utilization)
* `GET /kvaults/vaults/{pubkey}/metrics/history` — Historical vault metrics
* SDK: `vault.getVaultHoldings()`, `vault.getAPYs()`, `vault.getExchangeRate()`

**User Vault Positions**

* `GET /kvaults/users/{pubkey}/positions` — All user vault positions
* `GET /kvaults/users/{userPubkey}/positions/{vaultPubkey}` — Single user position
* `GET /kvaults/users/{userPubkey}/vaults/{vaultPubkey}/pnl` — Current PnL and cost basis
* `GET /kvaults/users/{pubkey}/transactions` — All vault transactions for user

**Vault Deposit**

* `POST /ktx/kvault/deposit` — Build unsigned deposit transaction
* `POST /ktx/kvault/deposit-instructions` — Get deposit instructions with lookup tables
* SDK: `vault.depositIxs(signer, amount)`
* Tutorial: [https://kamino.com/docs/build/tutorials/earn/earn-and-withdraw](https://kamino.com/docs/build/tutorials/earn/earn-and-withdraw)

**Vault Withdraw**

* `POST /ktx/kvault/withdraw` — Build unsigned withdraw transaction
* `POST /ktx/kvault/withdraw-instructions` — Get withdraw instructions with lookup tables
* SDK: `vault.withdrawIxs(signer, shares)`

**Vault Creation (SDK only)**

* SDK: `KaminoManager.createVaultIxs(vaultConfig)` — Initialize new vault
* Tutorial: [https://kamino.com/docs/build/tutorials/earn/creating-a-vault](https://kamino.com/docs/build/tutorials/earn/creating-a-vault)

### Borrow Market Operations (Buildkit)

**Market Data Queries**

* `GET /v2/kamino-market` — All Kamino Lending markets
* `GET /kamino-market/{pubkey}/reserves/metrics` — Current reserve metrics (APY, TVL, LTV)
* `GET /kamino-market/{marketPubkey}/reserves/{reservePubkey}/metrics/history` — Historical reserve metrics
* SDK: `KaminoMarket.load(rpc, marketAddress)`, `market.getTotalDepositTVL()`

**User Loan Positions**

* `GET /kamino-market/{marketPubkey}/users/{userPubkey}/obligations` — All user obligations
* `GET /klend/loans/{pubkey}` — Specific loan details
* SDK: `market.getObligationByWallet(userAddress, new VanillaObligation(PROGRAM_ID))`

**Deposit Collateral**

* `POST /ktx/klend/deposit` — Build unsigned deposit transaction
* SDK: `KaminoAction.buildDepositTxns(market, amount, mint, signer, new VanillaObligation(PROGRAM_ID))`

**Borrow Assets**

* `POST /ktx/klend/borrow` — Build unsigned borrow transaction
* SDK: `KaminoAction.buildBorrowTxns(market, amount, mint, signer, new VanillaObligation(PROGRAM_ID))`

**Repay Debt**

* `POST /ktx/klend/repay` — Build unsigned repay transaction
* SDK: `KaminoAction.buildRepayTxns(market, amount, mint, signer, new VanillaObligation(PROGRAM_ID))`

**Withdraw Collateral**

* `POST /ktx/klend/withdraw` — Build unsigned withdraw transaction
* SDK: `KaminoAction.buildWithdrawTxns(market, amount, mint, signer, new VanillaObligation(PROGRAM_ID))`

### Advanced Operations (Buildkit)

**Flash Loans**

* Requires: `@kamino-finance/klend-sdk`
* SDK: `getFlashLoanInstructions({...})` — Returns `{ flashBorrowIx, flashRepayIx }` for an uncollateralized loan repaid in the same transaction
* Tutorial: [https://kamino.com/docs/build/tutorials/borrow/flash-loans](https://kamino.com/docs/build/tutorials/borrow/flash-loans)

**Repay with Collateral (KSwap)**

* Requires: `@kamino-finance/klend-sdk`, `@kamino-finance/kswap-sdk`, `@solana-program/address-lookup-table`
* SDK: `getRepayWithCollIxs()`, `getKswapQuoter()`, `getKswapSwapper()`
* Sequencing: (1) fetch pair LUTs from `cdn.kamino.finance/resources.json`, (2) run `getUserLutAddressAndSetupIxs()` and send any setup txs before main tx, (3) build and send main repay tx with LUT compression
* Tutorial: [https://kamino.com/docs/build/tutorials/borrow/repay-with-collateral-kswap](https://kamino.com/docs/build/tutorials/borrow/repay-with-collateral-kswap)

**Multiply Deposit (KSwap)**

* Requires: `@kamino-finance/klend-sdk`, `@kamino-finance/kswap-sdk`, `@kamino-finance/scope-sdk`, `@solana-program/address-lookup-table`
* SDK: `getDepositWithLeverageIxs()`, `getKswapQuoter()`, `getKswapSwapper()`, `getScopeRefreshIxForObligationAndReserves()`
* Sequencing: (1) fetch pair LUTs from `cdn.kamino.finance/resources.json`, (2) run `getUserLutAddressAndSetupIxs()` and send any setup txs before main tx, (3) fetch Scope prices, (4) build and send main multiply tx with LUT compression
* Tutorial: [https://kamino.com/docs/build/tutorials/borrow/multiply-deposit-kswap](https://kamino.com/docs/build/tutorials/borrow/multiply-deposit-kswap)

**Referral System**

* Requires: `@kamino-finance/klend-sdk`
* SDK: `getInitReferrerStateAndShortUrlIxs()`, `getReferrerForShortUrl()`
* Tutorial: [https://kamino.com/docs/build/tutorials/borrow/referrer-setup](https://kamino.com/docs/build/tutorials/borrow/referrer-setup)

### Curator Vault Management

**Creating and Configuring Vaults**

* Deploy new lending vaults via SDK: `KaminoManager.createVaultIxs(vaultConfig)`
* Configure token mint, performance fees, management fees, withdrawal penalties
* Transfer admin to multisig (Squads) after creation
* Guide: [https://kamino.com/docs/curators/vaults/creating-a-vault](https://kamino.com/docs/curators/vaults/creating-a-vault)

**Allocation Management**

* Set allocation weights and caps per reserve
* Standard allocations (always active) vs Conditional allocations (demand-only)
* Sync allocations to rebalance vault capital across reserves
* Guide: [https://kamino.com/docs/curators/vaults/allocations](https://kamino.com/docs/curators/vaults/allocations)

**Farms & Rewards**

* Requires: `@kamino-finance/farms-sdk`
* Configure vault farms for depositor reward distribution
* Set up First Loss Capital buffer for depositor protection
* Enable autocompounding of rewards
* Guide: [https://kamino.com/docs/curators/vaults/farms-and-rewards](https://kamino.com/docs/curators/vaults/farms-and-rewards)

**Curator Data Queries**

* `GET /kvaults/vaults/{pubkey}` — Vault details and current state
* `GET /kvaults/vaults/{pubkey}/metrics` — Vault performance metrics
* `GET /kvaults/users/{userPubkey}/positions/{vaultPubkey}` — Depositor positions
* `GET /kvaults/rewards` — Active vault reward programs

### Rewards & Yield

**KLend Rewards**

* `GET /klend/users/{pubkey}/rewards` — User claimable KLend rewards
* `GET /klend/rewards` — All active KLend reward metrics
* Requires (SDK reward calc): `@kamino-finance/farms-sdk` — `FarmState`, `calculateCurrentRewardPerToken()`
* Requires (SDK claim): `@kamino-finance/farms-sdk` — `Farms`, `farm.claimForUserForFarmAllRewardsIx()`
* Tutorial (APY calc): [https://kamino.com/docs/build/tutorials/borrow/calculate-reserve-reward-apy](https://kamino.com/docs/build/tutorials/borrow/calculate-reserve-reward-apy)
* Tutorial (claim): [https://kamino.com/docs/build/tutorials/borrow/claim-user-rewards](https://kamino.com/docs/build/tutorials/borrow/claim-user-rewards)

**KVault Rewards**

* `GET /kvaults/rewards` — All active vault rewards
* `GET /kvaults/users/{pubkey}/rewards` — User season points per vault

**Staking Yields**

* `GET /v2/staking-yields` — Latest staking yields for all LSTs
* `GET /yields/{yieldSource}/history` — Historical yield data

### Utility

**Oracle Prices**

* `GET /oracles/prices` — All oracle prices for Klend market assets

**Lookup Tables**

* `POST /luts/find-minimal` — Find minimal LUT set for transaction compression
* CDN resource (multiply/repay-with-collateral): `GET https://cdn.kamino.finance/resources.json` — Returns token-pair-specific LUT addresses under `mainnet-beta.multiplyLUTsPairs[collMint][debtMint]` and `mainnet-beta.repayWithCollLUTs[collMint-debtMint]`

**Solana Metadata**

* `GET /epochs` — Epoch start/end times and slot numbers
* `GET /slots/duration` — Median slot duration from last 3 epochs

## Workflows

### Deposit into Earn Vault (REST API)

1. List vaults: `GET /kvaults/vaults`
2. Get metrics: `GET /kvaults/vaults/{pubkey}/metrics`
3. Build deposit tx: `POST /ktx/kvault/deposit` with `{ wallet, vault, amount }`
4. Sign and send transaction client-side

### Borrow Against Collateral (TypeScript SDK)

1. Install: `npm install @kamino-finance/klend-sdk @solana/kit`
2. Load market: `KaminoMarket.load(rpc, marketAddress, slotDuration)`
3. Deposit collateral: `KaminoAction.buildDepositTxns(...)`
4. Check health: `obligation.loanToValue()`
5. Borrow: `KaminoAction.buildBorrowTxns(...)`

### Create a Curator Vault (TypeScript SDK)

1. Install: `npm install @kamino-finance/klend-sdk @solana/kit`
2. Configure: `new KaminoVaultConfig({ admin, tokenMint, performanceFeeRatePercentage, ... })`
3. Create: `KaminoManager.createVaultIxs(config)`
4. Set allocations, configure farm, transfer to multisig

## Integration

**REST API** — Language-agnostic HTTP endpoints

* Base URL: `https://api.kamino.finance`
* OpenAPI Spec (Data): [https://api.kamino.finance/openapi/json?openapi=3.0.0](https://api.kamino.finance/openapi/json?openapi=3.0.0)
* OpenAPI Spec (Transactions): [https://api.kamino.finance/ktx/documentation/json](https://api.kamino.finance/ktx/documentation/json)
* Guide: [https://kamino.com/docs/build/developers/api-vs-sdk](https://kamino.com/docs/build/developers/api-vs-sdk)

**TypeScript SDK** — On-chain transaction building

* GitHub: [https://github.com/Kamino-Finance/klend-sdk](https://github.com/Kamino-Finance/klend-sdk)
* Core: `npm install @kamino-finance/klend-sdk @solana/kit`
* KSwap routing (multiply, repay-with-collateral): `npm install @kamino-finance/kswap-sdk`
* Oracle prices (multiply): `npm install @kamino-finance/scope-sdk`
* Farm rewards (APY calc, claim): `npm install @kamino-finance/farms-sdk`
* LUT fetching (multiply, repay-with-collateral): `npm install @solana-program/address-lookup-table`

**Documentation**

* Product Docs: [https://kamino.com/docs](https://kamino.com/docs)
* Developer Docs: [https://kamino.com/docs/build](https://kamino.com/docs/build)
* Curator Docs: [https://kamino.com/docs/curators](https://kamino.com/docs/curators)

## Context

* Full page index: [https://kamino.com/docs/llms.txt](https://kamino.com/docs/llms.txt)
* API Reference: [https://kamino.com/docs/build/api-reference](https://kamino.com/docs/build/api-reference)
* Risk Dashboard: [https://risk.kamino.finance](https://risk.kamino.finance)
* Discord: [https://discord.com/invite/kamino](https://discord.com/invite/kamino)


Built with [Mintlify](https://mintlify.com).