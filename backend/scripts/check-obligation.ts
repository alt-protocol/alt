import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { address, createSolanaRpc } from "@solana/kit";

async function main() {
  const rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);
  const sdk = await import("@kamino-finance/klend-sdk");

  const market = await sdk.KaminoMarket.load(
    rpc as any,
    address("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"),
    400,
  );

  const wallet = address("D8E6t4oe1szSsDuwNmVTiSHFLFZY5sNBxQnuaCQ8FEHm");
  const usdcMint = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

  const vanilla = await market!.getObligationByWallet(wallet, new sdk.VanillaObligation(sdk.PROGRAM_ID));
  console.log("VanillaObligation exists:", vanilla != null);
  if (vanilla) {
    const deps = vanilla.state.deposits.filter((d: any) =>
      d.depositReserve.toString() !== "11111111111111111111111111111111"
    );
    console.log("  Active deposits:", deps.length);
    for (const d of deps) {
      console.log("    Reserve:", (d as any).depositReserve.toString().slice(0, 12) + "...");
    }
  }

  const lending = await market!.getObligationByWallet(wallet, new sdk.LendingObligation(usdcMint, sdk.PROGRAM_ID));
  console.log("LendingObligation (USDC) exists:", lending != null);
  if (lending) {
    const deps = lending.state.deposits.filter((d: any) =>
      d.depositReserve.toString() !== "11111111111111111111111111111111"
    );
    console.log("  Active deposits:", deps.length);
  }
}

main().catch((e) => console.error("Error:", e.message));
