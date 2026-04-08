import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

import { address, createSolanaRpc } from "@solana/kit";

async function main() {
  const rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);
  const sdk = await import("@kamino-finance/klend-sdk");
  const BN = (await import("bn.js")).default;

  const market = await sdk.KaminoMarket.load(
    rpc as any,
    address("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"),
    400,
  );

  const action = await sdk.KaminoAction.buildDepositTxns(
    market!,
    new BN(10000),
    address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    { address: address("L5pTcaF2fSbe1FwEtkN2KYsf6ayh5utPZbuegRi98RK") } as any,
    new sdk.LendingObligation(address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), sdk.PROGRAM_ID),
    true,
    undefined,
  );

  for (const [name, arr] of Object.entries({
    computeBudgetIxs: action.computeBudgetIxs,
    setupIxs: action.setupIxs,
    lendingIxs: action.lendingIxs,
    cleanupIxs: action.cleanupIxs,
  })) {
    console.log(`\n${name}: ${(arr as any[]).length} instructions`);
    for (let i = 0; i < (arr as any[]).length; i++) {
      const ix = (arr as any[])[i];
      const hasAccounts = ix.accounts !== undefined;
      const hasData = ix.data !== undefined;
      console.log(`  [${i}] accounts=${hasAccounts} data=${hasData} keys=${Object.keys(ix).join(",")}`);
    }
  }
}

main().catch(console.error);
