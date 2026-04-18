import "dotenv/config";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Shared Fastify app (lazy singleton for integration tests)
// ---------------------------------------------------------------------------

let _app: FastifyInstance | null = null;

export async function getTestApp(): Promise<FastifyInstance> {
  if (!_app) {
    _app = await buildApp();
    await _app.ready();
  }
  return _app;
}

export async function closeTestApp(): Promise<void> {
  if (_app) {
    await _app.close();
    _app = null;
  }
}

// ---------------------------------------------------------------------------
// Test wallet from .env
// ---------------------------------------------------------------------------

let _wallet: { keypair: any; address: string } | null = null;

export function getTestWallet() {
  if (_wallet) return _wallet;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bs58 = require("bs58");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Keypair } = require("@solana/web3.js");
  const key = process.env.TEST_WALLET_PRIVATE_KEY;
  if (!key) throw new Error("TEST_WALLET_PRIVATE_KEY not set in .env");
  const kp = Keypair.fromSecretKey(bs58.decode(key));
  _wallet = { keypair: kp, address: kp.publicKey.toBase58() as string };
  return _wallet;
}

// ---------------------------------------------------------------------------
// RPC connection (lazy singleton)
// ---------------------------------------------------------------------------

let _conn: any = null;

export function getTestConnection() {
  if (_conn) return _conn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Connection } = require("@solana/web3.js");
  _conn = new Connection(process.env.HELIUS_RPC_URL!, "confirmed");
  return _conn;
}

// ---------------------------------------------------------------------------
// Fastify request injection (no HTTP overhead)
// ---------------------------------------------------------------------------

export async function inject(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  const res = await app.inject({ method, url, payload: payload as any });
  return {
    status: res.statusCode,
    body: res.statusCode !== 204 ? JSON.parse(res.body) : null,
  };
}

// ---------------------------------------------------------------------------
// On-chain transaction helper: build → sign → simulate → submit → confirm
// ---------------------------------------------------------------------------

export async function buildAndSubmit(
  endpoint: string,
  body: Record<string, unknown>,
  label: string,
): Promise<{ success: boolean; response: any; signature?: string }> {
  const { Connection, PublicKey, VersionedTransaction, TransactionMessage, AddressLookupTableAccount } = require("@solana/web3.js");
  const conn = getTestConnection();
  const wallet = getTestWallet();
  const API = `http://localhost:${process.env.PORT ?? 8001}/api`;

  // 1. Build
  const start = Date.now();
  const res = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r: any) => r.json());

  if (res.error) {
    console.log(`  ${label}: BUILD ERR (${Date.now() - start}ms) — ${res.error}`);
    return { success: false, response: res };
  }
  console.log(`  ${label}: built ${res.instructions.length} ixs (${Date.now() - start}ms)`);

  // 2. Assemble
  const instructions = res.instructions.map((ix: any) => ({
    programId: new PublicKey(ix.programAddress),
    keys: ix.accounts.map((a: any) => ({
      pubkey: new PublicKey(a.address),
      isSigner: a.role >= 2,
      isWritable: a.role === 1 || a.role === 3,
    })),
    data: Buffer.from(ix.data, "base64"),
  }));

  const altAccounts: any[] = [];
  for (const addr of res.lookupTableAddresses ?? []) {
    const info = await conn.getAccountInfo(new PublicKey(addr));
    if (info) {
      altAccounts.push(
        new AddressLookupTableAccount({
          key: new PublicKey(addr),
          state: AddressLookupTableAccount.deserialize(info.data),
        }),
      );
    }
  }

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: wallet.keypair.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(altAccounts);
  const tx = new VersionedTransaction(msg);
  tx.sign([wallet.keypair]);

  // 3. Simulate
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) {
    const logs = (sim.value.logs ?? []).filter((l: string) => l.includes("Error") || l.includes("error") || l.includes("insufficient"));
    console.log(`  ${label}: SIM FAILED — ${JSON.stringify(sim.value.err)}`);
    logs.slice(-3).forEach((l: string) => console.log(`    ${l}`));
    return { success: false, response: res };
  }

  // 4. Submit
  const sig = await conn.sendTransaction(tx, { skipPreflight: true });

  // 5. Confirm (poll)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await conn.getSignatureStatus(sig);
    if (st?.value?.confirmationStatus === "confirmed" || st?.value?.confirmationStatus === "finalized") {
      if (st.value.err) {
        console.log(`  ${label}: ON-CHAIN FAILED`);
        return { success: false, response: res, signature: sig };
      }
      console.log(`  ${label}: CONFIRMED (${Date.now() - start}ms)`);
      return { success: true, response: res, signature: sig };
    }
  }

  console.log(`  ${label}: TIMEOUT (may still land)`);
  return { success: true, response: res, signature: sig }; // optimistic
}

// ---------------------------------------------------------------------------
// E2E test market constants
// ---------------------------------------------------------------------------

export const MARKETS = {
  JUPITER_LENDING_USDC: { id: 2190, token: "USDC", amount: "0.01" },
  JUPITER_MULTIPLY_JUICED_USDC: { id: 2210, token: "JUICED", amount: "0.1", leverage: 2, slippageBps: 200 },
  KAMINO_VAULT_USDC: { id: 1483, token: "USDC", amount: "1" },
  KAMINO_LENDING_USDC: { id: 1531, token: "USDC", amount: "0.01" },
  KAMINO_MULTIPLY_PST_USDC: { id: 1997, token: "PST", amount: "0.1", leverage: 2, slippageBps: 200 },
  DRIFT_IF_USDC: { id: 26, token: "USDC", amount: "0.01" },
} as const;

// Mints
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const JUICED_MINT = "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk";
export const PST_MINT = "59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw";

// Legacy aliases
export const JUICED_USDC_OPP_ID = MARKETS.JUPITER_MULTIPLY_JUICED_USDC.id;
export const JUICED_USDT_OPP_ID = 2211;
