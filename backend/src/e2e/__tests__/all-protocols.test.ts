/**
 * E2E on-chain tests for ALL protocol/category combinations.
 *
 * Every test builds, signs, simulates, and submits REAL transactions.
 * Tests run sequentially. The wallet should end with the same balances.
 *
 * Requires: Docker Postgres, Helius RPC, TEST_WALLET_PRIVATE_KEY with:
 *   - 0.1+ SOL (for rent + fees)
 *   - 1+ USDC
 *   - 1+ JUICED
 *   - 1+ PST
 */
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { getTestWallet, buildAndSubmit, MARKETS } from "../../__tests__/helpers.js";

const wallet = getTestWallet();
const API = "/manage/tx";

// ---------------------------------------------------------------------------
// Jupiter Lending (Earn): USDC deposit → withdraw
// ---------------------------------------------------------------------------

describe("Jupiter Lending — USDC", () => {
  const m = MARKETS.JUPITER_LENDING_USDC;

  it("deposit → withdraw", async () => {
    // Deposit
    const deposit = await buildAndSubmit(`${API}/build-deposit`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: m.amount,
      extra_data: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    }, "JUP LEND deposit");
    expect(deposit.success).toBe(true);

    await new Promise((r) => setTimeout(r, 5000)); // on-chain propagation

    // Withdraw
    const withdraw = await buildAndSubmit(`${API}/build-withdraw`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: m.amount,
      extra_data: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    }, "JUP LEND withdraw");
    expect(withdraw.success).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Jupiter Multiply: JUICED/USDC open → stats → close
// ---------------------------------------------------------------------------

describe("Jupiter Multiply — JUICED/USDC", () => {
  const m = MARKETS.JUPITER_MULTIPLY_JUICED_USDC;
  let nftId: number | undefined;

  it("open → stats → close", async () => {
    // Open
    const open = await buildAndSubmit(`${API}/build-deposit`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: m.amount,
      extra_data: { leverage: m.leverage, slippageBps: m.slippageBps },
    }, "JUP MULT open");
    expect(open.success).toBe(true);
    nftId = open.response.metadata?.nft_id;
    expect(nftId).toBeTypeOf("number");

    await new Promise((r) => setTimeout(r, 15000)); // wait for finalization (~13s)

    // Stats
    if (nftId) {
      const statsRes = await fetch(`http://localhost:${process.env.PORT ?? 8001}/api${API}/position-stats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: m.id, wallet_address: wallet.address, extra_data: { position_id: nftId } }),
      }).then((r) => r.json());
      console.log(`  JUP MULT stats: lev=${(statsRes as any)?.leverage?.toFixed(1)}x bal=$${(statsRes as any)?.balance?.toFixed(2)}`);
      expect(statsRes).toBeTruthy();
      expect((statsRes as any).leverage).toBeGreaterThan(1);
    }

    // Close
    const close = await buildAndSubmit(`${API}/build-withdraw`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: "0",
      extra_data: { position_id: nftId, isClosingPosition: true },
    }, "JUP MULT close");
    expect(close.success).toBe(true);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// Kamino Vault: USDC deposit → withdraw
// ---------------------------------------------------------------------------

describe("Kamino Vault — USDC", () => {
  const m = MARKETS.KAMINO_VAULT_USDC;

  it("deposit → withdraw", async () => {
    const deposit = await buildAndSubmit(`${API}/build-deposit`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: m.amount,
    }, "KAMINO VAULT deposit");
    expect(deposit.success).toBe(true);

    await new Promise((r) => setTimeout(r, 5000));

    const withdraw = await buildAndSubmit(`${API}/build-withdraw`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: m.amount,
    }, "KAMINO VAULT withdraw");
    expect(withdraw.success).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Kamino Lending: USDC deposit → withdraw
// ---------------------------------------------------------------------------

describe("Kamino Lending — USDC", () => {
  const m = MARKETS.KAMINO_LENDING_USDC;

  it("deposit → withdraw", async () => {
    const deposit = await buildAndSubmit(`${API}/build-deposit`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: m.amount,
    }, "KAMINO LEND deposit");
    expect(deposit.success).toBe(true);

    await new Promise((r) => setTimeout(r, 5000));

    const withdraw = await buildAndSubmit(`${API}/build-withdraw`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: m.amount,
    }, "KAMINO LEND withdraw");
    expect(withdraw.success).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Kamino Multiply: PST/USDC open → stats → close
// ---------------------------------------------------------------------------

describe("Kamino Multiply — PST/USDC", () => {
  const m = MARKETS.KAMINO_MULTIPLY_PST_USDC;

  it("open → stats → close", async () => {
    // Open
    const open = await buildAndSubmit(`${API}/build-deposit`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: m.amount,
      extra_data: { leverage: m.leverage, slippageBps: m.slippageBps },
    }, "KAMINO MULT open");
    expect(open.success).toBe(true);

    await new Promise((r) => setTimeout(r, 5000));

    // Stats (Kamino uses obligation_address, not nft_id — stats endpoint handles this)
    const statsRes = await fetch(`http://localhost:${process.env.PORT ?? 8001}/api${API}/position-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunity_id: m.id, wallet_address: wallet.address }),
    }).then((r) => r.json());
    if (statsRes && (statsRes as any).leverage) {
      console.log(`  KAMINO MULT stats: lev=${(statsRes as any).leverage?.toFixed(1)}x`);
    }

    // Close
    const close = await buildAndSubmit(`${API}/build-withdraw`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: "0",
      extra_data: { slippageBps: m.slippageBps, isClosingPosition: true },
    }, "KAMINO MULT close");
    expect(close.success).toBe(true);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// Drift Insurance Fund: USDC deposit → (check state) → withdraw
// ---------------------------------------------------------------------------

describe.skip("Drift Insurance Fund — USDC", () => {
  const m = MARKETS.DRIFT_IF_USDC;

  it("deposit → check state → withdraw if redeemable", async () => {
    // Deposit
    const deposit = await buildAndSubmit(`${API}/build-deposit`, {
      opportunity_id: m.id,
      wallet_address: wallet.address,
      amount: m.amount,
    }, "DRIFT IF deposit");
    expect(deposit.success).toBe(true);

    await new Promise((r) => setTimeout(r, 5000));

    // Check withdraw state (Drift has a cooldown/redeem period)
    const stateRes = await fetch(`http://localhost:${process.env.PORT ?? 8001}/api/manage/withdraw-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunity_id: m.id, wallet_address: wallet.address }),
    }).then((r) => r.json());
    const state = stateRes as any;
    console.log(`  DRIFT IF state: ${state?.status ?? "unknown"}`);

    if (state?.status === "redeemable" || state?.status === "none") {
      // Withdraw (only if no cooldown)
      const withdraw = await buildAndSubmit(`${API}/build-withdraw`, {
        opportunity_id: m.id,
        wallet_address: wallet.address,
        amount: m.amount,
      }, "DRIFT IF withdraw");
      expect(withdraw.success).toBe(true);
    } else {
      console.log("  DRIFT IF: position in cooldown, skipping withdraw (will auto-close later)");
    }
  }, 120_000);
});
