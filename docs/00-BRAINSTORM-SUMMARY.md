# Brainstorm Summary — Solana Yield Aggregator

> **Date:** March 15, 2026
> **Participants:** Founder + Claude (AI brainstorm partner)
> **Output:** Strategic direction, MVP scope, architecture, and 6-week roadmap

---

## The Idea

A curated, non-custodial Solana yield dashboard where DeFi natives discover, deposit, manage, and monitor yield positions across protocols — without leaving the app. Think of it as a clean, opinionated alternative to manually checking 5+ protocol websites to find and manage yield.

---

## Founder Profile

- **Background:** Former founder of a yield tokenization protocol (Pendle-like) on TON blockchain — responsible for business side, had a dev team
- **Technical skills:** Python, TypeScript, SQL — hackathon-level experience, no Rust/smart contract ability
- **Time available:** 10–15 hours/week (evenings only) for 6 weeks = 60–90 total hours
- **Existing network:** Has relationships with Solana protocols and VCs, but needs a working product before approaching them
- **Key advantage:** Personally uses these DeFi products daily — building to solve own pain point

---

## Strategic Decisions Made

### Target User
DeFi natives on Solana who manually chase yield across protocols. NOT crypto beginners, NOT institutional (yet), NOT non-Solana users.

### Core Product Thesis
The pain is real: Solana's yield ecosystem is fragmented across dozens of protocols with no clean aggregator that lets you act. DeFiLlama shows data but doesn't let you deposit. Protocol-native UIs only show their own products. There's a gap for a curated, full-service yield app.

### Non-Custodial Architecture
Zero smart contracts. The app routes transactions through existing protocol SDKs — Kamino, Drift, Exponent. The user's wallet signs every transaction. The backend never touches funds. This is critical because:
- Solo founder with no Rust expertise
- Faster to ship (no audit needed for custom contracts)
- Lower regulatory exposure
- Trust model is simple: "we never touch your money"

### Business Model (Evolved During Brainstorm)

**Original idea:** Flat subscription
**Problem identified:** DeFi users expect free tools. A paywall before demonstrating value kills growth. Subscription for investment access has regulatory implications.

**Agreed model — Freemium + Referral Revenue + API:**
- **Free tier:** Full discovery, deposit/withdraw, portfolio view — this is the growth engine
- **Pro tier (later):** Advanced analytics, historical yield curves, risk-adjusted comparisons, yield alerts, portfolio rebalancing suggestions
- **Referral revenue:** Negotiate with protocols for a cut of TVL routed to them (some already have on-chain referral programs)
- **API monetization:** Sell normalized yield data to other DeFi apps, AI agents, and institutional desks — this is the best long-term revenue path

### Protocol Selection for MVP

| Category | Protocol | MVP Integration |
|---|---|---|
| Yield Tokenization | **Exponent** | Full (deposit/withdraw) |
| Delta Neutral | **Solstice** (USX/eUSX) | Data only |
| Lending / Liquidity Vaults | **Kamino** | Full (deposit/withdraw) |
| Perps + Earn | **Drift** | Full (deposit/withdraw) |
| Stable AMM LP | **Jupiter LP** | Data only |

3 full integrations, 2 data-only. This is the maximum feasible scope for 75 hours solo.

---

## Risks Identified and Mitigations

### 1. Defensibility — "Anyone can clone this"
**The problem:** A UI layer on top of other people's contracts has no technical moat. Protocols themselves (Jupiter, Kamino) could build the same thing with existing user bases.

**Mitigations agreed:**
- **Proprietary data layer:** Collect historical yield snapshots from day 1. Over time, build yield analytics, risk scoring, protocol health metrics that are genuinely hard to replicate.
- **AI layer on data:** Train recommendation models on proprietary data — "where should I put 10K USDC for stable 8%+ yield?" Nobody else has the data to answer this well.
- **API as infrastructure:** Become the data layer that other apps and AI agents consume. This shifts the product from "app" to "platform."
- **Omnichain expansion (later):** Once proven on Solana, expand to EVM chains. No single-chain protocol can replicate a cross-chain aggregator.
- **Brand and research:** Build in public, publish yield research, become the trusted voice. DeBank survived on trust alone despite doing nothing technically special.

### 2. Aggregator Graveyard — "Aggregators don't make money"
**The problem:** Zapper, Zerion, DeBank have been around for years with no great business model. Tulip on Solana is dead. Aggregators generate usage but struggle to capture value.

**Mitigation:** The portfolio monitoring layer is the retention hook, not discovery. Once users have positions tracked in one dashboard, switching cost is real. Design the portfolio view to be exceptional — that's what keeps users, discovery is just the acquisition funnel.

### 3. Referral Revenue Reality
**The problem:** Most Solana protocols don't have formalized referral programs. Solo founder has zero leverage pre-launch.

**Mitigation:** Launch free, track routing volume from day 1 even without earning. Use that data as a sales pitch to protocols after demonstrating TVL impact. Start with protocols that already have on-chain referral mechanics (Marginfi, Jupiter).

### 4. Solo Founder Execution Risk
**The problem:** Building data pipeline + REST API + full Next.js frontend + 5 protocol integrations + portfolio tracker + landing page in 75 hours alone.

**Mitigation:** Ruthless scope management. Tier 1 (must have): dashboard with real data, wallet connect, 2–3 working deposit flows. Tier 2 (strong to have): portfolio view. Tier 3 (cut if behind): historical charts, risk scoring, extra integrations. Clear "what to cut" contingency plan at each week checkpoint.

### 5. Smart Contract Risk Inheritance
**The problem:** When a protocol you integrated gets exploited, users blame your app. "Your app said it was low risk."

**Mitigation:** Never use terms like "safe" or "low risk." Use objective metrics: audit status, TVL history, time since launch, insurance coverage. Transparent methodology so users can see you showed data honestly.

### 6. Regulatory Ambiguity
**The problem:** Helping people deposit into yield products could be classified as operating an unregistered broker-dealer in some jurisdictions.

**Mitigation:** Not a hackathon problem but a fundraising problem. Need jurisdictional strategy before raising: where to incorporate, what geographies to block, framing subscription as "data and analytics" not "investment access." Talk to crypto-native lawyer before fundraising.

---

## Long-Term Product Vision (3 Layers)

### Layer 1: The App (Hackathon → Month 3)
Solana yield dashboard with deposit, withdraw, and portfolio management. Free, clean, works. This is the user acquisition funnel and proof of concept.

### Layer 2: The Data Engine (Month 1 → Month 12)
Proprietary historical yield data, risk scoring, protocol health metrics. Start collecting from week 1 but surface gradually. This becomes the competitive advantage and foundation for everything else.

### Layer 3: The Platform (Month 6 → Month 18+)
- API for developers and AI agents (best monetization path)
- Omnichain expansion (Solana → EVM chains)
- AI-powered yield recommendation engine
- Community features (strategy discussions, upvotes — only after reaching 1000+ active users)
- Enterprise/institutional API tier

**The hackathon shows Layer 1 with hints of Layer 2. The seed round pitch is about Layers 2 and 3. VCs fund the data and API vision, not the frontend.**

---

## Ideas Discussed but Deferred

### Social Features (Discussions, Upvotes, Strategy Sharing)
**Why it's interesting:** Network effects that compound and can't be cloned by copying code.
**Why it's deferred:** Cold start problem (empty social feed kills trust), incentive misalignment (best strategies are alpha that stops working when shared), and massive scope creep (moderation, spam, reputation systems).
**What to do instead for now:** Founder publishes one "Strategy Spotlight" analysis per week. Build personal brand as the editor, not a platform. Add community features only after reaching 1000+ active users to seed them.

### Omnichain
**Why it's the right long-term answer:** Makes the product impossible to replicate by any single-chain protocol.
**Why it's deferred:** Each chain means different wallets, SDKs, RPCs, and protocol ecosystems. Would go from 8 integrations to 40+ while solo. Ship and win on Solana first, expand chain by chain.
**Pitch framing:** "Solana-first, omnichain roadmap" — shows ambition with discipline.

### AI Agent / Recommendation Engine
**Why it matters:** "Where should I put 10K USDC?" answered with data-backed recommendations is a product nobody else has.
**Why it's deferred:** Needs months of historical data to be useful. Start collecting data now, build the AI layer in v2.

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, wallet-adapter-react, TanStack Query |
| Backend | Python, FastAPI, SQLAlchemy, APScheduler |
| Database | PostgreSQL (yield data only, no user data) |
| Hosting | Vercel (frontend), Railway (backend + Postgres) |
| RPC | Helius (free tier) |
| Protocol SDKs | @kamino-finance/kliquidity-sdk, @drift-labs/sdk, Exponent SDK (TBD) |

---

## 6-Week Roadmap Summary

| Week | Focus | Key Deliverable |
|---|---|---|
| 0 | Setup | Repo, local dev environment, DB seeded |
| 1 | Data Pipeline | Live yield data from all 5 protocols, API serving real data |
| 2 | Frontend + Dashboard | Deployed site with real data, category filters, wallet connect |
| 3 | Kamino + Drift | Working deposit/withdraw for 2 protocols |
| 4 | Exponent + Portfolio | 3rd protocol integrated, unified portfolio view |
| 5 | Polish + Landing | Professional UX, landing page, responsive design |
| 6 | Demo + Submit | Video recorded, submission written, app stable |

**Absolute minimum viable submission:** Dashboard with live data + 2 working deposit flows + landing page + demo video.

---

## Open Questions Still to Resolve

- [ ] **Project name** — needed before week 5 for landing page and branding
- [ ] **Exact hackathon deadline** — needed to date the roadmap
- [ ] **Exponent SDK maturity** — verify in week 1; if immature, swap to Solstice or downgrade to data-only
- [ ] **Solstice data endpoints** — confirm API exists for YieldVault APY
- [ ] **Hosting budget** — estimate monthly costs for backend + DB (likely <$20/month on Railway free/hobby tier)

---

## Next Steps (Immediate)

1. Review these three documents: MVP Scope, Architecture, Roadmap
2. Confirm hackathon deadline to date the roadmap
3. Set up Jira with epics and stories based on roadmap
4. Create wireframes for key screens (dashboard, vault detail, portfolio, deposit flow)
5. Start Pre-Week 0 setup tasks

---

## Key Quotes from the Brainstorm

> "The portfolio monitoring layer is the retention hook, not discovery. Once users have positions tracked in one dashboard, switching cost is real."

> "The hackathon shows Layer 1 with hints of Layer 2. The seed round pitch is about Layers 2 and 3. VCs fund the data and API vision, not the frontend."

> "Start collecting yield snapshots from day 1. By demo day you'll have 6 weeks of historical data — that's your proprietary asset."

> "Your biggest risk is execution speed as a solo founder. The projects that win hackathons are the ones that do one thing exceptionally well with a compelling vision for what's next."
