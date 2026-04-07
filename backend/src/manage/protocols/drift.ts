import type { Instruction } from "@solana/kit";
import type {
  ProtocolAdapter,
  BuildTxParams,
  GetBalanceParams,
  WithdrawState,
} from "./types.js";
import { convertLegacyInstruction as convertIx } from "../services/instruction-converter.js";

// Drift SDK uses legacy @solana/web3.js and bn.js internally.
// We dynamically import everything to avoid loading at startup.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Cached SDK imports — resolved once, reused for all subsequent calls
// ---------------------------------------------------------------------------

let _sdk: { driftSdk: any; web3: any; BN: any } | undefined;
let _vaultsSdk: typeof import("@drift-labs/vaults-sdk") | undefined;

async function loadSdk() {
  if (!_sdk) {
    const [driftSdk, web3, bnMod] = await Promise.all([
      import("@drift-labs/sdk"),
      import("@solana/web3.js"),
      import("bn.js"),
    ]);
    _sdk = { driftSdk, web3, BN: bnMod.default };
  }
  return _sdk;
}

async function loadVaultsSdk() {
  if (!_vaultsSdk) _vaultsSdk = await import("@drift-labs/vaults-sdk");
  return _vaultsSdk;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

const dummyWallet = (pubkey: any) => ({
  publicKey: pubkey,
  signTransaction: async (t: any) => t,
  signAllTransactions: async (t: any) => t,
});

function getDecimals(extraData?: Record<string, unknown>): number {
  if (extraData?.decimals != null) return Number(extraData.decimals);
  return 6;
}

function getMarketIndex(extraData?: Record<string, unknown>): number {
  return extraData?.market_index != null ? Number(extraData.market_index) : 0;
}

/** Shared cooldown check for both vault redeem periods and IF unstaking. */
function checkCooldown(requestTs: number, cooldownSeconds: number) {
  const redeemableAtUnix = requestTs + cooldownSeconds;
  const now = Math.floor(Date.now() / 1000);
  if (now >= redeemableAtUnix) return { redeemable: true as const };
  return {
    redeemable: false as const,
    redeemableAt: new Date(redeemableAtUnix * 1000),
  };
}

/** Compute budget instructions — vault/IF operations need ~850k CU (SDK default). */
function computeBudgetIxs(web3: any) {
  return [
    web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 850_000 }),
    web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  ];
}

// ---------------------------------------------------------------------------
// Layered context: base (Drift) -> vault extension
// ---------------------------------------------------------------------------

type DriftContext = Awaited<ReturnType<typeof createDriftContext>>;
type VaultContext = Awaited<ReturnType<typeof createVaultContext>>;

async function createDriftContext(walletAddress: string) {
  const { driftSdk, web3, BN } = await loadSdk();
  const connection = new web3.Connection(process.env.HELIUS_RPC_URL!);
  const signerPubkey = new web3.PublicKey(walletAddress);
  const driftClient = new driftSdk.DriftClient({
    connection: connection as any,
    wallet: dummyWallet(signerPubkey) as any,
    env: "mainnet-beta" as any,
  });
  await driftClient.subscribe();
  return {
    driftSdk,
    web3,
    BN,
    connection,
    signerPubkey,
    driftClient,
    cleanup: () => driftClient.unsubscribe(),
  };
}

async function createVaultContext(
  walletAddress: string,
  vaultAddress: string,
) {
  const base = await createDriftContext(walletAddress);
  const vaultsSdk = await loadVaultsSdk();
  const vaultPubkey = new base.web3.PublicKey(vaultAddress);
  const vaultClient = vaultsSdk.getVaultClient(
    base.connection,
    dummyWallet(base.signerPubkey) as any,
    base.driftClient as any,
  );
  const vaultDepositor = vaultsSdk.getVaultDepositorAddressSync(
    vaultsSdk.VAULT_PROGRAM_ID,
    vaultPubkey,
    base.signerPubkey,
  );
  return { ...base, vaultsSdk, vaultPubkey, vaultClient, vaultDepositor };
}

// ---------------------------------------------------------------------------
// Insurance Fund — shared account reader
// ---------------------------------------------------------------------------

function deriveIfStakePda(ctx: DriftContext, marketIndex: number) {
  return ctx.driftSdk.getInsuranceFundStakeAccountPublicKey(
    ctx.driftClient.program.programId,
    ctx.signerPubkey,
    marketIndex,
  );
}

function deriveUserStatsPda(ctx: DriftContext) {
  return ctx.driftSdk.getUserStatsAccountPublicKey(
    ctx.driftClient.program.programId,
    ctx.signerPubkey,
  );
}

/** Read IF stake account and normalize fields. Returns null if account doesn't exist. */
async function readIfStake(ctx: DriftContext, marketIndex: number) {
  const pda = deriveIfStakePda(ctx, marketIndex);
  const info = await ctx.connection.getAccountInfo(pda);
  if (!info) return null;
  const raw: any =
    await ctx.driftClient.program.account.insuranceFundStake.fetch(pda);
  return {
    pda,
    shares: raw.ifShares as any,
    pendingShares: raw.lastWithdrawRequestShares as any,
    pendingValue: raw.lastWithdrawRequestValue as any,
    pendingTs: raw.lastWithdrawRequestTs as any,
    costBasis: raw.costBasis as any,
  };
}

// ---------------------------------------------------------------------------
// Insurance Fund — deposit
// ---------------------------------------------------------------------------

async function buildInsuranceFundDeposit(
  params: BuildTxParams,
): Promise<Instruction[]> {
  const ctx = await createDriftContext(params.walletAddress);
  try {
    const marketIndex = getMarketIndex(params.extraData);
    const decimals = getDecimals(params.extraData);
    const amount = new ctx.BN(
      Math.floor(parseFloat(params.amount) * 10 ** decimals),
    );

    const collateralAccount =
      await ctx.driftClient.getAssociatedTokenAccount(marketIndex);
    const ifStakePda = deriveIfStakePda(ctx, marketIndex);
    const existingAccount = await ctx.connection.getAccountInfo(ifStakePda);

    const cuIxs = computeBudgetIxs(ctx.web3);
    const ixs = await ctx.driftClient.getAddInsuranceFundStakeIxs({
      marketIndex,
      amount,
      collateralAccountPublicKey: collateralAccount,
      initializeStakeAccount: existingAccount === null,
    });
    return [...cuIxs, ...ixs.flat()].map(convertIx);
  } finally {
    await ctx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Insurance Fund — withdraw (state-aware 2-step)
// ---------------------------------------------------------------------------

async function buildInsuranceFundWithdraw(
  params: BuildTxParams,
): Promise<Instruction[]> {
  const ctx = await createDriftContext(params.walletAddress);
  try {
    const marketIndex = getMarketIndex(params.extraData);
    const stake = await readIfStake(ctx, marketIndex);
    if (!stake)
      throw Object.assign(
        new Error(
          "No insurance fund stake account found. The position may have been fully withdrawn.",
        ),
        { statusCode: 400 },
      );

    const cuIxs = computeBudgetIxs(ctx.web3);
    const spotMarket = ctx.driftClient.getSpotMarketAccount(marketIndex)!;
    const userStatsPda = deriveUserStatsPda(ctx);

    if (stake.pendingShares.isZero()) {
      // Step 1: Request unstaking.
      const decimals = getDecimals(params.extraData);
      const amount = new ctx.BN(
        Math.floor(parseFloat(params.amount) * 10 ** decimals),
      );
      const ix =
        await ctx.driftClient.program.instruction.requestRemoveInsuranceFundStake(
          marketIndex,
          amount,
          {
            accounts: {
              state: await ctx.driftClient.getStatePublicKey(),
              spotMarket: spotMarket.pubkey,
              insuranceFundStake: stake.pda,
              userStats: userStatsPda,
              authority: ctx.signerPubkey,
              insuranceFundVault: spotMarket.insuranceFund.vault,
            },
          },
        );
      return [...cuIxs, ix].map(convertIx);
    }

    // Check cooldown.
    const unstakingSeconds =
      (params.extraData?.unstaking_period_days != null
        ? Number(params.extraData.unstaking_period_days)
        : 13) * 86_400;
    const cooldown = checkCooldown(
      stake.pendingTs.toNumber(),
      unstakingSeconds,
    );
    if (!cooldown.redeemable) {
      throw Object.assign(
        new Error(
          `Unstaking pending — redeemable at ${cooldown.redeemableAt.toLocaleString()}. Please return then to complete.`,
        ),
        { statusCode: 400 },
      );
    }

    // Step 2: Execute removal — tokens transfer back to user.
    const spl = await import("@solana/spl-token");
    const isSolMarket = spotMarket.mint.equals(ctx.driftSdk.WRAPPED_SOL_MINT);

    const preIxs: any[] = [];
    const postIxs: any[] = [];
    let userTokenAccount: any;

    if (isSolMarket) {
      const { ixs, pubkey } =
        await ctx.driftClient.getWrappedSolAccountCreationIxs(
          ctx.driftSdk.ZERO,
          true,
        );
      userTokenAccount = pubkey;
      preIxs.push(...ixs);
      postIxs.push(
        spl.createCloseAccountInstruction(
          userTokenAccount,
          ctx.signerPubkey,
          ctx.signerPubkey,
          [],
        ),
      );
    } else {
      userTokenAccount = spl.getAssociatedTokenAddressSync(
        spotMarket.mint,
        ctx.signerPubkey,
        true,
      );
      if (!(await ctx.connection.getAccountInfo(userTokenAccount))) {
        preIxs.push(
          spl.createAssociatedTokenAccountInstruction(
            ctx.signerPubkey,
            userTokenAccount,
            ctx.signerPubkey,
            spotMarket.mint,
          ),
        );
      }
    }

    const remainingAccounts: any[] = [];
    ctx.driftClient.addTokenMintToRemainingAccounts(
      spotMarket,
      remainingAccounts,
    );

    const removeIx =
      await ctx.driftClient.program.instruction.removeInsuranceFundStake(
        marketIndex,
        {
          accounts: {
            state: await ctx.driftClient.getStatePublicKey(),
            spotMarket: spotMarket.pubkey,
            insuranceFundStake: stake.pda,
            userStats: userStatsPda,
            authority: ctx.signerPubkey,
            insuranceFundVault: spotMarket.insuranceFund.vault,
            driftSigner: ctx.driftClient.getSignerPublicKey(),
            userTokenAccount,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
          },
          remainingAccounts,
        },
      );
    return [...cuIxs, ...preIxs, removeIx, ...postIxs].map(convertIx);
  } finally {
    await ctx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Insurance Fund — balance + withdraw state
// ---------------------------------------------------------------------------

async function getIfBalance(
  params: GetBalanceParams,
): Promise<number | null> {
  let ctx: DriftContext | undefined;
  try {
    ctx = await createDriftContext(params.walletAddress);
    const marketIndex = getMarketIndex(params.extraData);
    const stake = await readIfStake(ctx, marketIndex);
    if (!stake) return 0;
    if (stake.shares.isZero() && stake.pendingShares.isZero()) return 0;

    const decimals = getDecimals(params.extraData);

    // If there's a pending withdrawal, return the pending value
    if (!stake.pendingShares.isZero())
      return stake.pendingValue.toNumber() / 10 ** decimals;

    // Calculate actual value from on-chain data:
    // userValue = (userShares / totalShares) * vaultTokenBalance
    // This is more reliable than costBasis which can be 0.
    try {
      const spotMarket = ctx.driftClient.getSpotMarketAccount(marketIndex);
      if (spotMarket) {
        const totalShares = spotMarket.insuranceFund.totalShares;
        if (!totalShares.isZero()) {
          const vaultInfo = await ctx.connection.getTokenAccountBalance(
            spotMarket.insuranceFund.vault,
          );
          const vaultBalance = Number(vaultInfo.value.amount);
          return (
            (stake.shares.toNumber() / totalShares.toNumber()) *
            (vaultBalance / 10 ** decimals)
          );
        }
      }
    } catch {
      // Fall through to costBasis
    }

    return stake.costBasis.toNumber() / 10 ** decimals;
  } catch {
    return null;
  } finally {
    await ctx?.cleanup();
  }
}

/** Read both current balance and cost basis from on-chain in one context. */
export async function getIfBalanceWithCostBasis(
  walletAddress: string,
  marketIndex: number,
): Promise<{ balance: number; costBasis: number; hasPendingWithdrawal: boolean } | null> {
  let ctx: DriftContext | undefined;
  try {
    ctx = await createDriftContext(walletAddress);
    const stake = await readIfStake(ctx, marketIndex);
    if (!stake) return null;
    if (stake.shares.isZero() && stake.pendingShares.isZero()) return null;

    const decimals = 6; // IF is always stablecoin (USDC)
    const costBasis = stake.costBasis.toNumber() / 10 ** decimals;
    const hasPendingWithdrawal = !stake.pendingShares.isZero();

    if (hasPendingWithdrawal) {
      return { balance: stake.pendingValue.toNumber() / 10 ** decimals, costBasis, hasPendingWithdrawal };
    }

    try {
      const spotMarket = ctx.driftClient.getSpotMarketAccount(marketIndex);
      if (spotMarket) {
        const totalShares = spotMarket.insuranceFund.totalShares;
        if (!totalShares.isZero()) {
          const vaultInfo = await ctx.connection.getTokenAccountBalance(
            spotMarket.insuranceFund.vault,
          );
          const vaultBalance = Number(vaultInfo.value.amount);
          const balance =
            (stake.shares.toNumber() / totalShares.toNumber()) *
            (vaultBalance / 10 ** decimals);
          return { balance, costBasis, hasPendingWithdrawal };
        }
      }
    } catch {
      // Fall through to costBasis as balance
    }

    return { balance: costBasis, costBasis, hasPendingWithdrawal };
  } catch {
    return null;
  } finally {
    await ctx?.cleanup();
  }
}

async function getIfWithdrawState(
  params: GetBalanceParams,
): Promise<WithdrawState> {
  let ctx: DriftContext | undefined;
  try {
    ctx = await createDriftContext(params.walletAddress);
    const stake = await readIfStake(ctx, getMarketIndex(params.extraData));
    if (!stake || stake.pendingShares.isZero()) return { status: "none" };

    const decimals = getDecimals(params.extraData);
    const requestedAmount =
      stake.pendingValue.toNumber() / 10 ** decimals;
    const unstakingSeconds =
      (params.extraData?.unstaking_period_days != null
        ? Number(params.extraData.unstaking_period_days)
        : 13) * 86_400;
    const cooldown = checkCooldown(
      stake.pendingTs.toNumber(),
      unstakingSeconds,
    );

    if (cooldown.redeemable) {
      return {
        status: "redeemable",
        message: "Your unstaking is ready to complete.",
        requestedAmount,
      };
    }
    return {
      status: "pending",
      message: `Unstaking requested. Redeemable at ${cooldown.redeemableAt.toLocaleString()}.`,
      requestedAmount,
    };
  } catch {
    return { status: "none" };
  } finally {
    await ctx?.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Vault — deposit
// ---------------------------------------------------------------------------

async function buildVaultDeposit(
  params: BuildTxParams,
): Promise<Instruction[]> {
  const ctx = await createVaultContext(
    params.walletAddress,
    params.depositAddress,
  );
  try {
    const existingAccount = await ctx.connection.getAccountInfo(
      ctx.vaultDepositor,
    );
    const decimals = getDecimals(params.extraData);
    const amount = new ctx.BN(
      Math.floor(parseFloat(params.amount) * 10 ** decimals),
    );

    const initParam =
      existingAccount === null
        ? { authority: ctx.signerPubkey, vault: ctx.vaultPubkey }
        : undefined;

    const { accounts, remainingAccounts, preIxs, postIxs } =
      await ctx.vaultClient.prepDepositTx(
        ctx.vaultDepositor,
        amount,
        initParam,
      );

    const cuIxs = computeBudgetIxs(ctx.web3);
    const ixs: any[] = [];
    if (existingAccount === null) {
      ixs.push(
        (ctx.vaultClient as any).createInitVaultDepositorIx(
          ctx.vaultPubkey,
          ctx.signerPubkey,
        ),
      );
    }

    // Defensive ATA guard for non-wSOL deposit tokens
    const spl = await import("@solana/spl-token");
    const vault = await ctx.vaultClient.getVault(ctx.vaultPubkey);
    const spotMarket = ctx.driftClient.getSpotMarketAccount(
      vault.spotMarketIndex,
    );
    if (
      spotMarket &&
      !spotMarket.mint.equals(ctx.driftSdk.WRAPPED_SOL_MINT)
    ) {
      const ata = spl.getAssociatedTokenAddressSync(
        spotMarket.mint,
        ctx.signerPubkey,
        true,
      );
      if (!(await ctx.connection.getAccountInfo(ata))) {
        ixs.push(
          spl.createAssociatedTokenAccountInstruction(
            ctx.signerPubkey,
            ata,
            ctx.signerPubkey,
            spotMarket.mint,
          ),
        );
      }
    }

    ixs.push(...preIxs);
    ixs.push(
      await ctx.vaultClient.program.methods
        .deposit(amount)
        .accounts({ authority: ctx.signerPubkey, ...accounts })
        .remainingAccounts(remainingAccounts)
        .instruction(),
    );
    ixs.push(...postIxs);
    return [...cuIxs, ...ixs].map(convertIx);
  } finally {
    await ctx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Vault — withdraw (state-aware 2-step)
// ---------------------------------------------------------------------------

async function buildVaultWithdraw(
  params: BuildTxParams,
): Promise<Instruction[]> {
  const ctx = await createVaultContext(
    params.walletAddress,
    params.depositAddress,
  );
  try {
    const depositorAccount = await ctx.connection.getAccountInfo(
      ctx.vaultDepositor,
    );
    if (!depositorAccount)
      throw Object.assign(
        new Error(
          "No vault depositor account found. The position may have been fully withdrawn.",
        ),
        { statusCode: 400 },
      );

    const depositor = await ctx.vaultClient.getVaultDepositor(
      ctx.vaultDepositor,
    );
    const cuIxs = computeBudgetIxs(ctx.web3);

    if (depositor.lastWithdrawRequest.shares.isZero()) {
      // Step 1: Request withdrawal.
      const decimals = getDecimals(params.extraData);
      const amount = new ctx.BN(
        Math.floor(parseFloat(params.amount) * 10 ** decimals),
      );
      const ixs = await ctx.vaultClient.getRequestWithdrawIx(
        ctx.vaultDepositor,
        amount,
        ctx.vaultsSdk.WithdrawUnit.TOKEN,
      );
      return [...cuIxs, ...ixs].map(convertIx);
    }

    // Check cooldown.
    const vault = await ctx.vaultClient.getVault(ctx.vaultPubkey);
    const cooldown = checkCooldown(
      depositor.lastWithdrawRequest.ts.toNumber(),
      vault.redeemPeriod.toNumber(),
    );
    if (!cooldown.redeemable) {
      throw Object.assign(
        new Error(
          `Withdrawal pending — redeemable at ${cooldown.redeemableAt.toLocaleString()}. Please return then to complete.`,
        ),
        { statusCode: 400 },
      );
    }

    // Step 2: Execute withdrawal.
    const ixs = await ctx.vaultClient.getWithdrawIx(ctx.vaultDepositor);
    return [...cuIxs, ...ixs].map(convertIx);
  } finally {
    await ctx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Vault — balance + withdraw state
// ---------------------------------------------------------------------------

async function getVaultBalance(
  params: GetBalanceParams,
): Promise<number | null> {
  let ctx: VaultContext | undefined;
  try {
    ctx = await createVaultContext(params.walletAddress, params.depositAddress);
    const depositorAccount = await ctx.connection.getAccountInfo(
      ctx.vaultDepositor,
    );
    if (!depositorAccount) return 0;

    const depositor = await ctx.vaultClient.getVaultDepositor(
      ctx.vaultDepositor,
    );
    if (
      depositor.vaultShares.isZero() &&
      depositor.lastWithdrawRequest.shares.isZero()
    )
      return 0;

    const decimals = getDecimals(params.extraData);

    if (!depositor.lastWithdrawRequest.shares.isZero()) {
      return (
        depositor.lastWithdrawRequest.value.toNumber() / 10 ** decimals
      );
    }
    try {
      const equity =
        await ctx.vaultClient.calculateWithdrawableVaultDepositorEquityInDepositAsset(
          {
            vaultDepositorAddress: ctx.vaultDepositor,
            vaultAddress: ctx.vaultPubkey,
          },
        );
      return equity.toNumber() / 10 ** decimals;
    } catch {
      return depositor.netDeposits.toNumber() / 10 ** decimals;
    }
  } catch {
    return null;
  } finally {
    await ctx?.cleanup();
  }
}

async function getVaultWithdrawState(
  params: GetBalanceParams,
): Promise<WithdrawState> {
  let ctx: VaultContext | undefined;
  try {
    ctx = await createVaultContext(params.walletAddress, params.depositAddress);
    const depositorAccount = await ctx.connection.getAccountInfo(
      ctx.vaultDepositor,
    );
    if (!depositorAccount) return { status: "none" };

    const depositor = await ctx.vaultClient.getVaultDepositor(
      ctx.vaultDepositor,
    );
    if (depositor.lastWithdrawRequest.shares.isZero())
      return { status: "none" };

    const vault = await ctx.vaultClient.getVault(ctx.vaultPubkey);
    const decimals = getDecimals(params.extraData);
    const requestedAmount =
      depositor.lastWithdrawRequest.value.toNumber() / 10 ** decimals;
    const cooldown = checkCooldown(
      depositor.lastWithdrawRequest.ts.toNumber(),
      vault.redeemPeriod.toNumber(),
    );

    if (cooldown.redeemable) {
      return {
        status: "redeemable",
        message: "Your withdrawal is ready to complete.",
        requestedAmount,
      };
    }
    return {
      status: "pending",
      message: `Withdrawal requested. Redeemable at ${cooldown.redeemableAt.toLocaleString()}.`,
      requestedAmount,
    };
  } catch {
    return { status: "none" };
  } finally {
    await ctx?.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const driftAdapter: ProtocolAdapter = {
  async buildDepositTx(params) {
    if (params.category === "insurance_fund")
      return buildInsuranceFundDeposit(params);
    if (params.category === "vault") return buildVaultDeposit(params);
    throw new Error(
      `Drift adapter does not yet support category "${params.category}"`,
    );
  },

  async buildWithdrawTx(params) {
    if (params.category === "insurance_fund")
      return buildInsuranceFundWithdraw(params);
    if (params.category === "vault") return buildVaultWithdraw(params);
    throw new Error(
      `Drift adapter does not yet support category "${params.category}"`,
    );
  },

  async getBalance(params) {
    if (params.category === "vault") return getVaultBalance(params);
    if (params.category === "insurance_fund") return getIfBalance(params);
    return null;
  },

  async getWithdrawState(params) {
    if (params.category === "vault") return getVaultWithdrawState(params);
    if (params.category === "insurance_fund")
      return getIfWithdrawState(params);
    return { status: "none" };
  },
};
