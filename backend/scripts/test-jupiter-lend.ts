/**
 * E2E test: Jupiter Lend deposit → withdraw cycle.
 *
 * Usage:
 *   npx tsx backend/scripts/test-jupiter-lend.ts
 *
 * Requires: backend running on localhost:8001, TEST_WALLET_PRIVATE_KEY in backend/.env
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });
import {
  Connection,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API = "http://localhost:8001";
const RPC_URL = process.env.HELIUS_RPC_URL;
const SECRET = process.env.TEST_WALLET_PRIVATE_KEY;

if (!SECRET) throw new Error("TEST_WALLET_PRIVATE_KEY not set in .env");
if (!RPC_URL) throw new Error("HELIUS_RPC_URL not set in .env");

const keypair = Keypair.fromSecretKey(bs58.decode(SECRET));
const wallet = keypair.publicKey.toBase58();
const connection = new Connection(RPC_URL, "confirmed");

console.log(`Wallet: ${wallet}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${(json as any).error ?? JSON.stringify(json)}`);
  return json as T;
}

interface SerializableInstruction {
  programAddress: string;
  accounts: { address: string; role: number }[];
  data: string;
}

interface BuildResponse {
  instructions: SerializableInstruction[];
  lookupTableAddresses?: string[];
  setupInstructionSets?: SerializableInstruction[][];
}

function deserializeIx(ix: SerializableInstruction) {
  return {
    programId: new PublicKey(ix.programAddress),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner: a.role >= 2,
      isWritable: a.role === 1 || a.role === 3,
    })),
    data: Buffer.from(ix.data, "base64"),
  };
}

async function signAndSend(
  ixs: SerializableInstruction[],
  label: string,
): Promise<string> {
  const legacyIxs = ixs.map(deserializeIx);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions: legacyIxs,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([keypair]);

  console.log(`[${label}] Sending transaction...`);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  console.log(`[${label}] Signature: ${sig}`);

  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  console.log(`[${label}] Confirmed!`);
  return sig;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Check SOL balance
  const solBalance = await connection.getBalance(keypair.publicKey);
  console.log(`SOL balance: ${(solBalance / 1e9).toFixed(4)} SOL`);
  if (solBalance < 0.005 * 1e9) {
    throw new Error("Insufficient SOL for fees (need at least 0.005 SOL)");
  }

  // 2. Find a Jupiter Lend opportunity (prefer USDC)
  const yields = await api<{ data: any[] }>("GET", "/api/discover/yields?category=lending");
  const jupOpps = yields.data.filter((o: any) => o.protocol_name === "Jupiter");
  if (jupOpps.length === 0) throw new Error("No Jupiter Lend opportunities found");

  // Prefer USDC, then USDT, then SOL, then any
  const preferred = ["USDC", "USDT", "SOL"];
  let opp = null;
  for (const token of preferred) {
    opp = jupOpps.find((o: any) => o.tokens?.includes(token));
    if (opp) break;
  }
  opp = opp ?? jupOpps[0];

  // Fetch full detail (list endpoint doesn't include extra_data)
  const detail = await api<any>("GET", `/api/discover/yields/${opp.id}`);
  console.log(`\nUsing opportunity: ${detail.name} (id=${detail.id})`);
  console.log(`  mint: ${detail.extra_data?.mint}`);
  console.log(`  tokens: ${detail.tokens?.join(", ")}`);

  // 3. Determine deposit amount based on token
  const token = detail.tokens?.[0] ?? "USDC";
  // Use small amounts: 0.001 USDC/USDT, 0.0001 SOL
  const amount = token === "SOL" ? "0.0001" : "0.001";

  // 4. Build deposit
  console.log(`\n--- DEPOSIT ${amount} ${token} ---`);
  const depositRes = await api<BuildResponse>("POST", "/api/manage/tx/build-deposit", {
    opportunity_id: detail.id,
    wallet_address: wallet,
    amount,
  });
  console.log(`Got ${depositRes.instructions.length} instruction(s)`);

  // 5. Sign & send deposit
  const depositSig = await signAndSend(depositRes.instructions, "DEPOSIT");

  // 6. Wait for state to settle, then verify balance
  console.log("\nWaiting 8s for on-chain state to settle...");
  await new Promise((r) => setTimeout(r, 8000));

  const balRes = await api<{ balance: number }>("POST", "/api/manage/balance", {
    opportunity_id: detail.id,
    wallet_address: wallet,
  });
  console.log(`On-chain balance: ${balRes.balance} ${token}`);

  // 7. Build withdraw
  console.log(`\n--- WITHDRAW ${amount} ${token} ---`);
  const withdrawRes = await api<BuildResponse>("POST", "/api/manage/tx/build-withdraw", {
    opportunity_id: detail.id,
    wallet_address: wallet,
    amount,
  });
  console.log(`Got ${withdrawRes.instructions.length} instruction(s)`);

  // 8. Sign & send withdraw
  const withdrawSig = await signAndSend(withdrawRes.instructions, "WITHDRAW");

  // 9. Summary
  console.log("\n=== E2E TEST PASSED ===");
  console.log(`Deposit:  https://solscan.io/tx/${depositSig}`);
  console.log(`Withdraw: https://solscan.io/tx/${withdrawSig}`);
}

main().catch((err) => {
  console.error("\n=== E2E TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
