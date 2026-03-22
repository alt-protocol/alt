import type { Instruction } from "@solana/kit";
import { address, createSolanaRpc } from "@solana/kit";
import type { ProtocolAdapter, BuildTxParams } from "./types";
import { HELIUS_RPC_URL } from "../constants";

// klend-sdk bundles its own @solana/kit@2.x while we use 6.x.
// The types are structurally identical at runtime (same JSON-RPC), so we
// cast through `any` at the SDK boundary to satisfy TypeScript.
//
// klend-sdk also has Node.js-only dependencies, so we use dynamic import()
// to avoid bundling it at compile time — it's only loaded when a user
// actually initiates a transaction.
/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadSdk() {
  const [sdk, decimalMod] = await Promise.all([
    import("@kamino-finance/klend-sdk"),
    import("decimal.js"),
  ]);
  return {
    KaminoVault: sdk.KaminoVault,
    KaminoMarket: sdk.KaminoMarket,
    KaminoAction: sdk.KaminoAction,
    VanillaObligation: sdk.VanillaObligation,
    PROGRAM_ID: sdk.PROGRAM_ID,
    BN: (await import("bn.js")).default,
    Decimal: decimalMod.default,
  };
}

function getRpc(): any {
  return createSolanaRpc(HELIUS_RPC_URL);
}

function addr(s: string): any {
  return address(s);
}

async function buildVaultDeposit(params: BuildTxParams): Promise<Instruction[]> {
  const { KaminoVault, Decimal } = await loadSdk();
  const vault = new KaminoVault(getRpc(), addr(params.depositAddress));
  const bundle = await vault.depositIxs(
    params.signer as any,
    new Decimal(params.amount),
  );
  return [
    ...bundle.depositIxs,
    ...bundle.stakeInFarmIfNeededIxs,
  ] as unknown as Instruction[];
}

async function buildVaultWithdraw(params: BuildTxParams): Promise<Instruction[]> {
  const { KaminoVault, Decimal } = await loadSdk();
  const vault = new KaminoVault(getRpc(), addr(params.depositAddress));
  const bundle = await vault.withdrawIxs(
    params.signer as any,
    new Decimal(params.amount),
  );
  return [
    ...bundle.unstakeFromFarmIfNeededIxs,
    ...bundle.withdrawIxs,
    ...bundle.postWithdrawIxs,
  ] as unknown as Instruction[];
}

async function buildLendingDeposit(params: BuildTxParams): Promise<Instruction[]> {
  const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID, BN } = await loadSdk();
  const marketAddress = params.extraData?.market as string | undefined;
  if (!marketAddress) throw new Error("Missing market address in extra_data");

  const tokenMint = params.extraData?.token_mint as string | undefined;
  if (!tokenMint) throw new Error("Missing token_mint in extra_data");

  const decimals = params.extraData?.decimals != null ? Number(params.extraData.decimals) : 6;
  const amountBase = new BN(Math.floor(parseFloat(params.amount) * 10 ** decimals));

  const market = await KaminoMarket.load(getRpc(), addr(marketAddress), 400);
  if (!market) throw new Error("Failed to load Kamino market");

  const action = await KaminoAction.buildDepositTxns(
    market,
    amountBase,
    addr(tokenMint),
    params.signer as any,
    new VanillaObligation(PROGRAM_ID),
    true,
    undefined,
  );

  return [
    ...action.computeBudgetIxs,
    ...action.setupIxs,
    ...action.lendingIxs,
    ...action.cleanupIxs,
  ] as unknown as Instruction[];
}

async function buildLendingWithdraw(params: BuildTxParams): Promise<Instruction[]> {
  const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID, BN } = await loadSdk();
  const marketAddress = params.extraData?.market as string | undefined;
  if (!marketAddress) throw new Error("Missing market address in extra_data");

  const tokenMint = params.extraData?.token_mint as string | undefined;
  if (!tokenMint) throw new Error("Missing token_mint in extra_data");

  const decimals = params.extraData?.decimals != null ? Number(params.extraData.decimals) : 6;
  const amountBase = new BN(Math.floor(parseFloat(params.amount) * 10 ** decimals));

  const market = await KaminoMarket.load(getRpc(), addr(marketAddress), 400);
  if (!market) throw new Error("Failed to load Kamino market");

  const action = await KaminoAction.buildWithdrawTxns(
    market,
    amountBase,
    addr(tokenMint),
    params.signer as any,
    new VanillaObligation(PROGRAM_ID),
    true,
    undefined,
  );

  return [
    ...action.computeBudgetIxs,
    ...action.setupIxs,
    ...action.lendingIxs,
    ...action.cleanupIxs,
  ] as unknown as Instruction[];
}

function isVaultCategory(category: string): boolean {
  return category === "vault" || category === "earn_vault";
}

export const kaminoAdapter: ProtocolAdapter = {
  async buildDepositTx(params) {
    if (isVaultCategory(params.category)) {
      return buildVaultDeposit(params);
    }
    return buildLendingDeposit(params);
  },

  async buildWithdrawTx(params) {
    if (isVaultCategory(params.category)) {
      return buildVaultWithdraw(params);
    }
    return buildLendingWithdraw(params);
  },
};
