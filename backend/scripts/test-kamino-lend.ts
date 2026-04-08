/**
 * E2E test: Kamino Lend deposit → withdraw cycle.
 *
 * Usage:
 *   npx tsx backend/scripts/test-kamino-lend.ts
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

const API = "http://localhost:8001";
const RPC_URL = process.env.HELIUS_RPC_URL!;
const SECRET = process.env.TEST_WALLET_PRIVATE_KEY!;

if (!SECRET) throw new Error("TEST_WALLET_PRIVATE_KEY not set");
if (!RPC_URL) throw new Error("HELIUS_RPC_URL not set");

const keypair = Keypair.fromSecretKey(bs58.decode(SECRET));
const wallet = keypair.publicKey.toBase58();
const connection = new Connection(RPC_URL, "confirmed");

console.log(`Wallet: ${wallet}`);

interface SerializableInstruction {
  programAddress: string;
  accounts: { address: string; role: number }[];
  data: string;
}

interface BuildResponse {
  instructions: SerializableInstruction[];
}

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

async function signAndSend(ixs: SerializableInstruction[], label: string): Promise<string> {
  const legacyIxs = ixs.map(deserializeIx);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions: legacyIxs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([keypair]);
  console.log(`[${label}] Sending...`);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  console.log(`[${label}] Sig: ${sig}`);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`[${label}] Confirmed!`);
  return sig;
}

async function main() {
  const solBalance = await connection.getBalance(keypair.publicKey);
  console.log(`SOL: ${(solBalance / 1e9).toFixed(4)}`);

  // Find Kamino USDC lending opportunity
  const yields = await api<{ data: any[] }>("GET", "/api/discover/yields?category=lending");
  const opp = yields.data.find((o: any) => o.protocol_name === "Kamino" && o.tokens?.includes("USDC"));
  if (!opp) throw new Error("No Kamino USDC lending opportunity found");

  const detail = await api<any>("GET", `/api/discover/yields/${opp.id}`);
  console.log(`\nUsing: ${detail.name} (id=${detail.id})`);

  const amount = "0.01";

  // Deposit
  console.log(`\n--- DEPOSIT ${amount} USDC ---`);
  const depositRes = await api<BuildResponse>("POST", "/api/manage/tx/build-deposit", {
    opportunity_id: detail.id, wallet_address: wallet, amount,
  });
  console.log(`Got ${depositRes.instructions.length} instructions`);
  const depositSig = await signAndSend(depositRes.instructions, "DEPOSIT");

  console.log("\nWaiting 8s...");
  await new Promise((r) => setTimeout(r, 8000));

  // Withdraw
  console.log(`\n--- WITHDRAW ${amount} USDC ---`);
  const withdrawRes = await api<BuildResponse>("POST", "/api/manage/tx/build-withdraw", {
    opportunity_id: detail.id, wallet_address: wallet, amount,
  });
  console.log(`Got ${withdrawRes.instructions.length} instructions`);
  const withdrawSig = await signAndSend(withdrawRes.instructions, "WITHDRAW");

  console.log("\n=== E2E TEST PASSED ===");
  console.log(`Deposit:  https://solscan.io/tx/${depositSig}`);
  console.log(`Withdraw: https://solscan.io/tx/${withdrawSig}`);
}

main().catch((err) => {
  console.error("\n=== E2E TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
