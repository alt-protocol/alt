# MVP Scope Document — Solana Yield Aggregator

> **Status:** Draft v1
> **Author:** Founder
> **Created:** March 15, 2026
> **Hackathon deadline:** TBD (6 weeks from start)
> **Time budget:** 60–90 hours total (10–15 hrs/week × 6 weeks)

---

## 1. One-Line Product Description

A curated, non-custodial Solana yield dashboard where DeFi natives discover, deposit, manage, and monitor yield positions across protocols — without leaving the app.

---

## 2. Target User (MVP)

**DeFi natives on Solana** who currently:
- Manually check 5+ protocol UIs to compare yield opportunities
- Lose track of positions scattered across protocols
- Waste time evaluating new yield products with no standardized risk view
- Want stable/USD-denominated yield primarily

**NOT targeting (yet):** crypto-curious beginners, institutional allocators, non-Solana users.

---

## 3. Yield Categories

| Category | Description | MVP Protocol (Full Integration) | Listed Only (Data, No Deposit) |
|---|---|---|---|
| Yield Tokenization | Fixed-rate yield via PT/YT stripping | **Exponent** | — |
| Delta Neutral | Market-neutral strategies, funding rate arb | — | **Solstice** (USX/eUSX) |
| Lending / Liquidity Vaults | Supply-side lending, automated liquidity | **Kamino** | — |
| Perps + Earn | Earn vaults on perp DEX infrastructure | **Drift** | — |
| Stable AMM LP | LP provision in stable-pair pools | — | **Jupiter LP** |

---

## 4. Feature Scope

### ✅ IN — Must ship for hackathon

**Discovery & Dashboard**
- [ ] Yield dashboard showing all supported opportunities in a single view
- [ ] Category filtering (5 categories above)
- [ ] Sort by: APY, TVL, protocol
- [ ] Basic risk indicators per opportunity (audit status, TVL size, protocol age)
- [ ] Real-time APY and TVL data (refreshed every 15 min minimum)

**Wallet & Deposit/Withdraw**
- [ ] Solana wallet connection (Phantom, Backpack, Solflare via wallet-adapter)
- [ ] Deposit flow for Kamino lending vaults (USDC at minimum)
- [ ] Deposit flow for Drift earn vaults
- [ ] Deposit flow for Exponent PT (fixed yield) purchase
- [ ] Withdraw flow for all three above
- [ ] Transaction status feedback (pending, confirmed, failed)

**Portfolio View (Basic)**
- [ ] Show user's active positions across supported protocols
- [ ] Current value and estimated yield per position
- [ ] Total portfolio value

**Landing Page**
- [ ] Clear value proposition
- [ ] Supported protocols and categories
- [ ] CTA to launch app

### ⏳ LATER — Post-hackathon v1 (weeks 7–12)

- Solstice full deposit/withdraw integration (USX mint → eUSX)
- Jupiter LP full integration
- Historical APY charts (data collection starts in MVP though)
- Risk scoring model (weighted: audit, TVL, age, exploit history)
- Yield alerts / notifications
- "Strategy Spotlight" — curated weekly yield analysis content
- Portfolio PnL tracking over time
- API endpoints for external consumers

### ❌ OUT — Not building

- Custom smart contracts (non-custodial, use protocol SDKs only)
- Auto-rebalancing or automated strategies
- Social features (discussions, upvotes, strategy sharing)
- Mobile app or Telegram bot
- Omnichain / non-Solana chains
- Token / governance
- On-chain referral tracking
- User accounts or login (wallet-only)

---

## 5. Time Budget Allocation

**Total available: ~75 hours** (midpoint estimate)

| Phase | Weeks | Hours | Deliverable |
|---|---|---|---|
| Data layer + Backend API | 1–2 | ~20 hrs | Yield data pipeline, PostgreSQL, REST API serving normalized data |
| Frontend + Wallet integration | 3–4 | ~25 hrs | Dashboard UI, category views, wallet connect, deposit/withdraw for 3 protocols |
| Portfolio view + Polish | 5 | ~15 hrs | Portfolio tracker, position display, UX polish |
| Landing page + Demo prep | 6 | ~15 hrs | Landing page, bug fixes, demo recording/rehearsal |

**Buffer strategy:** If behind schedule at end of week 4, drop one protocol integration to "listed only" (likely Exponent, since PT/YT is the most complex flow).

---

## 6. Protocol Integration Complexity Estimate

| Protocol | Integration Type | Estimated Effort | SDK Maturity | Notes |
|---|---|---|---|---|
| **Kamino** | Deposit/withdraw into lending vaults | 8–12 hrs | Good (`@kamino-finance/kliquidity-sdk`) | Most straightforward — standard supply/withdraw |
| **Drift** | Deposit/withdraw into earn vaults | 8–12 hrs | Good (`@drift-labs/sdk`) | Well-documented, active maintainers |
| **Exponent** | Purchase PT (fixed yield) via their AMM | 12–18 hrs | Newer, less battle-tested | Yield stripping is conceptually complex; AMM interaction adds tx complexity |
| **Solstice** (data only) | Pull APY/TVL for YieldVault | 2–3 hrs | N/A — API/on-chain read only | Just display eUSX yield data |
| **Jupiter LP** (data only) | Pull LP APY/TVL data | 2–3 hrs | N/A — DeFiLlama + Jupiter API | Display only |

**Total integration estimate: 32–48 hours** (this is why 3 full integrations is the right number)

---

## 7. What "Done" Looks Like — Hackathon Demo Script

The demo should flow like this (3–4 minutes):

1. **Open the app** → Show the yield dashboard with live data across all 5 categories
2. **Filter to "Lending Vaults"** → Show Kamino opportunities with APY, TVL, risk indicators
3. **Connect wallet** → Phantom connects in one click
4. **Deposit 100 USDC into Kamino** → Show the deposit flow, transaction confirms on-chain
5. **Switch to "Yield Tokenization"** → Show Exponent PT opportunities, purchase a fixed yield position
6. **Open Portfolio view** → Both positions visible, showing current value and estimated yield
7. **Show "Delta Neutral" and "Stable AMM" categories** → Data visible, "Deposit coming soon" badge

Key message: "One app to discover, deposit, and monitor all your Solana yield. No more jumping between 5 protocol websites."

---

## 8. Key Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Smart contracts | None — non-custodial, route through protocol SDKs | Solo founder, no Rust expertise, faster to ship |
| Auth system | Wallet-only, no accounts | Simplifies everything, standard for DeFi |
| Data storage | PostgreSQL for yield data, no user data stored | Only store market data, user positions read from chain |
| Initial chain | Solana only | Focus wins, omnichain is roadmap |
| Business model | Free app → referral rev + API monetization later | No paywall for hackathon, prove traction first |
| Protocol selection | Kamino, Drift, Exponent (full); Solstice, Jupiter LP (data) | Best category coverage with manageable complexity |

---

## 9. Open Questions

- [ ] Project name — decide before building landing page (week 5)
- [ ] Hackathon exact deadline — needed to finalize roadmap
- [ ] Exponent SDK access — verify public availability and documentation quality
- [ ] Solstice API — confirm data endpoints exist for YieldVault APY
- [ ] Hosting budget — estimate monthly costs for backend + DB
