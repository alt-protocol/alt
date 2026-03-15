# Week-by-Week Roadmap — 6-Week Hackathon Sprint

> **Time budget:** 10–15 hrs/week (~75 hrs total)
> **Start date:** TBD
> **Hackathon deadline:** TBD
> **Solo founder — no delegation available**

---

## Pre-Week 0: Setup (2–3 hours, do before week 1)

- [ ] Create GitHub repo with monorepo structure (`frontend/`, `backend/`, `docs/`)
- [ ] Set up Next.js project with TypeScript + Tailwind
- [ ] Set up FastAPI project with SQLAlchemy
- [ ] Create Helius account (free tier)
- [ ] Create Railway/Supabase account for Postgres
- [ ] Run initial DB migration with protocol + yield tables
- [ ] Seed database with protocol metadata (Kamino, Drift, Exponent, Solstice, Jupiter)

**Done when:** Both frontend and backend run locally, DB has protocol entries, `GET /api/protocols` returns data.

---

## Week 1: Data Pipeline (12–15 hrs)

### Goal: Live yield data flowing from protocols into your database

**Tasks:**
- [ ] Build DeFiLlama yield fetcher — pull Solana yields, match to known protocols (3 hrs)
- [ ] Build Kamino-specific data fetcher — vault APYs and TVLs (2 hrs)
- [ ] Build Drift-specific data fetcher — earn vault APYs (2 hrs)
- [ ] Research Exponent data availability — PT implied yields, check APIs/on-chain (2 hrs)
- [ ] Add Solstice + Jupiter LP data fetching (data-only, just APY/TVL) (1 hr)
- [ ] Set up APScheduler — run fetchers every 15 min (1 hr)
- [ ] Write yield_snapshots insertion — start collecting historical data NOW (1 hr)
- [ ] Build and test `GET /api/yields` endpoint with filtering (2 hrs)
- [ ] Deploy backend to Railway (1 hr)

**Done when:** `GET /api/yields` returns real yield data for all 5 protocols. Snapshots are being stored every 15 min. Backend is deployed and accessible.

**Risk:** Exponent data might be hard to get programmatically. Fallback: manually seed initial data, build proper fetcher in week 2.

---

## Week 2: Frontend Foundation + Dashboard (12–15 hrs)

### Goal: Working dashboard showing real yield data with filters

**Tasks:**
- [ ] Set up wallet adapter (Phantom, Backpack, Solflare) (2 hrs)
- [ ] Build app layout shell — sidebar navigation, wallet connect button (2 hrs)
- [ ] Build YieldCard component — displays one yield opportunity (2 hrs)
- [ ] Build Dashboard page — grid/table of YieldCards with real API data (3 hrs)
- [ ] Implement category filter tabs (5 categories) (1 hr)
- [ ] Implement sort (by APY, TVL, protocol) (1 hr)
- [ ] Build RiskBadge component — show audit status, TVL tier (1 hr)
- [ ] Add "Full Integration" vs "Coming Soon" badge on cards (0.5 hr)
- [ ] Deploy frontend to Vercel (0.5 hr)
- [ ] Connect frontend to deployed backend API (1 hr)

**Done when:** Live site shows real yield data across all categories. User can filter by category and sort. Wallet connects. Deployed to Vercel.

**Risk:** Styling takes longer than expected. Fallback: use shadcn/ui components to move faster.

---

## Week 3: Kamino + Drift Integration (10–12 hrs)

### Goal: User can deposit and withdraw USDC via Kamino and Drift

**Tasks:**
- [ ] Build KaminoAdapter — `buildDepositTx`, `buildWithdrawTx`, `getPosition` (4 hrs)
- [ ] Build DriftAdapter — same interface (4 hrs)
- [ ] Build DepositModal component — amount input, token selector, confirm button (2 hrs)
- [ ] Build WithdrawModal component — same pattern (1 hr)
- [ ] Build VaultDetail page — shows full opportunity info + deposit/withdraw UI (2 hrs)
- [ ] Test deposit/withdraw on devnet for both protocols (1 hr)

**Integration detail — Kamino:**
```
1. User selects Kamino USDC vault
2. Frontend calls KaminoAdapter.buildDepositTx()
3. SDK constructs: create ATA (if needed) → deposit instruction → build tx
4. Wallet signs → submit → confirm
5. UI shows receipt token balance
```

**Integration detail — Drift:**
```
1. User selects Drift earn vault
2. Frontend calls DriftAdapter.buildDepositTx()
3. SDK constructs: initialize user account (if first time) → deposit instruction
4. Wallet signs → submit → confirm
5. UI shows vault deposit balance
```

**Done when:** A user can connect wallet, deposit USDC into Kamino vault, deposit into Drift vault, and withdraw from both. Transactions confirm on-chain.

**Risk:** SDK quirks, account initialization edge cases. Budget 2 extra hours for debugging. If Drift takes too long, deprioritize and move to Exponent.

---

## Week 4: Exponent Integration + Portfolio View (10–12 hrs)

### Goal: Exponent PT purchase works. User sees all positions in one view.

**Tasks:**
- [ ] Build ExponentAdapter — PT purchase flow via their AMM (5 hrs)
- [ ] Build Portfolio page — reads wallet, shows positions across protocols (3 hrs)
- [ ] Build portfolio API endpoint — parse token accounts, match to known vaults (3 hrs)
- [ ] Add total portfolio value + estimated annual yield display (1 hr)

**Integration detail — Exponent:**
```
1. User selects Exponent market (e.g., "Kamino USDC PT — Jun 2026")
2. Frontend shows: fixed APY, maturity date, minimum purchase
3. User enters USDC amount
4. ExponentAdapter builds AMM swap tx: USDC → PT
5. Wallet signs → submit → confirm
6. PT tokens appear in wallet, tracked in portfolio
```

**Portfolio detection logic:**
```
1. Fetch all token accounts for wallet (Helius getTokenAccountsByOwner)
2. Match token mints against known protocol receipt tokens:
   - Kamino kTokens → lending vault position
   - Drift: parse DriftClient user account
   - Exponent PT mints → fixed yield position
3. Calculate current value for each position
4. Return structured response
```

**Done when:** All 3 deposit flows work. Portfolio page shows positions from all 3 protocols in a unified view with current value.

**Risk:** Exponent SDK may be immature or poorly documented. Fallback plan: if Exponent integration takes more than 8 hours, ship it as "data only + coming soon" and use remaining time for polish.

---

## Week 5: Polish + Landing Page (10–12 hrs)

### Goal: Production-quality UX, landing page ready

**Tasks:**
- [ ] Build landing page — hero, value prop, supported protocols, CTA (4 hrs)
- [ ] UX polish pass on dashboard — loading states, empty states, error handling (2 hrs)
- [ ] Transaction feedback — pending spinner, success toast, failure message with retry (1 hr)
- [ ] Mobile responsive pass (dashboard should work on tablet) (1 hr)
- [ ] Add protocol logos and polish YieldCard visual design (1 hr)
- [ ] Add basic data freshness indicator ("Data updated 2 min ago") (0.5 hr)
- [ ] Add category description headers (what is yield tokenization, etc.) (1 hr)
- [ ] SEO basics — title, meta description, OG image (0.5 hr)
- [ ] Fix bugs from weeks 3–4 testing (1 hr)

**Done when:** App looks professional. No broken states. Landing page clearly communicates the product. Responsive on tablet.

---

## Week 6: Demo Prep + Buffer (8–10 hrs)

### Goal: Hackathon submission ready

**Tasks:**
- [ ] Record demo video (3-4 min walkthrough) (3 hrs including rehearsal)
- [ ] Write hackathon submission — project description, tech stack, what's novel (2 hrs)
- [ ] Final bug fix pass — test every flow end-to-end (2 hrs)
- [ ] Prepare pitch deck (5-7 slides) if hackathon requires it (2 hrs)
- [ ] Deploy final version — frontend + backend stable (1 hr)

**Demo script:**
1. Show landing page (10 sec)
2. Open dashboard — "Here's every yield opportunity on Solana, organized by category" (20 sec)
3. Filter to Lending — show Kamino vaults with live APY (15 sec)
4. Connect Phantom wallet (10 sec)
5. Deposit 50 USDC into Kamino vault — show tx confirmation (30 sec)
6. Navigate to Yield Tokenization — show Exponent PT with fixed yield (15 sec)
7. Purchase PT — lock in fixed 9.2% yield (30 sec)
8. Open Portfolio — "Both positions visible in one view" (20 sec)
9. Show Delta Neutral + Stable AMM categories — "More protocols coming" (15 sec)
10. Close with vision: "One app for all Solana yield. Data layer for the ecosystem." (15 sec)

**Done when:** Demo video recorded, submission written, app deployed and stable.

---

## Contingency: What to Cut If Behind

**If behind after week 2:**
- Simplify dashboard — table view only, no card grid
- Drop sort functionality (filter only)

**If behind after week 3:**
- Drop Drift integration to "data only"
- Ship with Kamino + Exponent only (or Kamino + Drift if Exponent is the problem)

**If behind after week 4:**
- Drop portfolio view (biggest time save)
- Focus on perfect deposit flow for 2 protocols + polished dashboard

**Absolute minimum viable hackathon submission:**
- Dashboard with live yield data (all categories)
- 2 working deposit/withdraw flows
- Landing page
- Demo video

This still tells the story and demonstrates the product works.

---

## Milestone Summary

| Week | Key Milestone | Verification |
|---|---|---|
| 0 | Dev environment ready | Both apps run locally |
| 1 | Live data pipeline | API returns real yield data |
| 2 | Dashboard live | Deployed site with real data + filters |
| 3 | 2 protocols integrated | Deposit/withdraw works for Kamino + Drift |
| 4 | 3 protocols + portfolio | Exponent works, unified portfolio view |
| 5 | Production polish | Professional UX, landing page |
| 6 | Submission ready | Demo recorded, app stable |

---

## Daily Rhythm (for 10–15 hr weeks)

Given evening-only schedule:
- **Weekday evenings:** 1.5–2 hrs per session, 4 sessions per week = 6–8 hrs
- **Weekend:** One 4–6 hr block on Saturday or Sunday
- **Total:** 10–14 hrs/week

**Recommendation:** Use weekday evenings for focused coding tasks (one adapter, one component). Use weekend blocks for integration work that requires debugging across frontend + backend.
